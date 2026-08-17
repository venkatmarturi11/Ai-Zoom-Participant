import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { liveControlKeyboard } from '../keyboards/inline.js';
import { parseMeetingUrl, extractZoomUrl } from '@zoom-assistant/meeting-parser';
import { userRepo, meetingRepo } from '@zoom-assistant/database';
import { meetingService } from '@zoom-assistant/orchestrator';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'join-command' });

/**
 * /join — Start the meeting join flow
 */
export async function joinCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  let user = await userRepo.findByTelegramId(telegramUserId).catch(() => null);
  if (!user) {
    user = await userRepo.upsert(telegramUserId, ctx.from?.username).catch(() => null);
  }

  // Set conversation state to await meeting link
  ctx.session.step = 'awaiting_meeting_link';
  await ctx.reply(messages.sendMeetingLink, { parse_mode: 'HTML' });
}

/**
 * Handle text input when a meeting link is received.
 *
 * Flow:
 * 1. Parse the Zoom URL
 * 2. Send user login + join links so they can join on their device
 * 3. Bot independently joins via headless browser and starts recording
 * 4. User sends /stop → bot stops recording and sends download link
 */
export async function handleMeetingLinkInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  // Try to extract a Zoom URL from the message (handles pasted invitation blocks)
  const url = extractZoomUrl(text) ?? text;
  const result = parseMeetingUrl(url);

  if (!result.success) {
    await ctx.reply(messages.invalidMeetingUrl(result.error), { parse_mode: 'HTML' });
    return;
  }

  const { meeting } = result;

  // If no passcode in URL, ask for it
  if (!meeting.passcode) {
    ctx.session.step = 'awaiting_passcode';
    ctx.session.pendingMeetingUrl = meeting.originalUrl;
    ctx.session.pendingMeetingId = meeting.meetingId;
    await ctx.reply(messages.meetingNeedsPasscode, { parse_mode: 'HTML' });
    return;
  }

  // Ready to join — execute the join flow immediately
  ctx.session.step = 'idle';
  await executeJoinFlow(ctx, meeting.meetingId, meeting.originalUrl, meeting.passcode);
}

/**
 * Handle passcode input after a meeting link without ?pwd= parameter.
 */
export async function handlePasscodeInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const meetingId = ctx.session.pendingMeetingId;
  const meetingUrl = ctx.session.pendingMeetingUrl;
  if (!meetingId || !meetingUrl) {
    ctx.session.step = 'idle';
    await ctx.reply(messages.genericError, { parse_mode: 'HTML' });
    return;
  }

  ctx.session.step = 'idle';
  ctx.session.pendingMeetingId = undefined;
  ctx.session.pendingMeetingUrl = undefined;

  await executeJoinFlow(ctx, meetingId, meetingUrl, text);
}

/**
 * Core join logic — sends the user login/join links, then bot joins independently.
 */
async function executeJoinFlow(
  ctx: BotContext,
  meetingId: string,
  meetingUrl: string,
  passcode?: string,
): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);
  const userDisplayName =
    ctx.session.pendingDisplayName ||
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ||
    ctx.from?.username ||
    'Meeting Assistant';

  const liveMonitorUrl =
    process.env['RENDER_EXTERNAL_URL'] || `http://localhost:${process.env['API_PORT'] || 3000}`;

  // Step 1: Send user the login page + direct join link + live screen button IMMEDIATELY (<50ms)
  const initialStatusMsg = await ctx.reply(
    messages.botJoining(meetingId, userDisplayName, meetingUrl),
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: liveControlKeyboard(liveMonitorUrl),
    },
  );

  // Background user/session cleanup (non-blocking)
  userRepo.findByTelegramId(telegramUserId).then(async (user) => {
    if (user) {
      const activeMeetings = await meetingRepo.findActiveByUserId(user.id).catch(() => []);
      for (const oldMeeting of activeMeetings) {
        await meetingRepo.updateStatus(oldMeeting.id, 'COMPLETED').catch(() => {});
      }
    }
  }).catch(() => {});

  try {

    // Step 2: Status callback — updates the user's message in real time
    const onStatusChange = async (
      status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM' | 'NEEDS_HUMAN',
      detail?: string,
    ) => {
      try {
        if (status === 'CONNECTED') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            messages.botConnected(meetingId, userDisplayName),
            {
              parse_mode: 'HTML',
              reply_markup: liveControlKeyboard(liveMonitorUrl),
            },
          );
        } else if (status === 'NEEDS_HUMAN') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            messages.botNeedsHuman(meetingId),
            {
              parse_mode: 'HTML',
              reply_markup: liveControlKeyboard(liveMonitorUrl),
            },
          );
        } else if (status === 'WAITING_ROOM') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            messages.botWaitingRoom(meetingId, userDisplayName),
            {
              parse_mode: 'HTML',
              reply_markup: liveControlKeyboard(liveMonitorUrl),
            },
          );
        } else if (status === 'FAILED') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            messages.botFailed(detail || 'Connection failed'),
            { parse_mode: 'HTML' },
          );
        }
      } catch (err: any) {
        log.warn({ error: err?.message }, 'Failed to update join status message in Telegram');
      }
    };

    // Step 3: Bot joins the meeting via headless browser
    const res = await meetingService.createAndQueueMeeting({
      telegramUserId,
      meetingUrl,
      meetingId,
      passcode: passcode ?? undefined,
      displayName: userDisplayName,
      onStatusChange,
    });

    log.info(
      { meetingId, telegramUserId: String(telegramUserId), recordId: res.meeting.id, capability: res.capability.capability },
      'Meeting created — bot joining & recording',
    );
  } catch (err: any) {
    ctx.session.step = 'idle';
    log.error({ error: err.message }, 'Error in join flow');
    await ctx.reply(`⚠️ ${err.message}`, { parse_mode: 'HTML' });
  }
}
