import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { meetingActionsKeyboard } from '../keyboards/inline.js';
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
  const telegramUserId = BigInt(ctx.from!.id);

  let user = await userRepo.findByTelegramId(telegramUserId).catch(() => null);
  if (!user) {
    user = await userRepo.upsert(telegramUserId, ctx.from?.username).catch(() => null);
  }

  // Automatically complete any prior active session so new session starts cleanly
  if (user) {
    const activeMeetings = await meetingRepo.findActiveByUserId(user.id).catch(() => []);
    for (const oldMeeting of activeMeetings) {
      await meetingRepo.updateStatus(oldMeeting.id, 'COMPLETED').catch(() => {});
    }
  }

  // If no passcode in URL, ask for it
  if (!meeting.passcode) {
    ctx.session.step = 'awaiting_passcode';
    ctx.session.pendingMeetingUrl = meeting.originalUrl;
    ctx.session.pendingMeetingId = meeting.meetingId;
    await ctx.reply(messages.meetingNeedsPasscode, { parse_mode: 'HTML' });
    return;
  }

  // Store pending data and show confirmation
  ctx.session.step = 'idle';

  // Delegate to MeetingService for meeting creation and BullMQ enqueueing
  try {
    const userDisplayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username || undefined;

    const initialStatusMsg = await ctx.reply(
      `🚀 <b>Connecting to Zoom Meeting:</b> <code>${meeting.meetingId}</code>...\n\n` +
      `⚡ Launching browser assistant & joining meeting room...\n` +
      `👤 <b>Display Name:</b> <code>${userDisplayName ?? 'Meeting Assistant'}</code>\n\n` +
      `<i>Please ensure the assistant is admitted if a waiting room is enabled.</i>`,
      { parse_mode: 'HTML' },
    );

    let meetingRecordId = '';

    const onStatusChange = async (status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM', detail?: string) => {
      try {
        if (status === 'CONNECTED') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            `✅ <b>Assistant is now IN the Zoom Meeting!</b>\n\n` +
            `📌 <b>Meeting ID:</b> <code>${meeting.meetingId}</code>\n` +
            `👤 <b>Display Name:</b> <code>${userDisplayName ?? 'Meeting Assistant'}</code>\n` +
            `🎥 <b>Screen Recording:</b> 🟢 <b>Active & Recording</b>\n\n` +
            `The assistant is attending and capturing the meeting session.\n` +
            `Send <code>/status</code> to check duration or <code>/stop</code> to finish and receive your video!`,
            {
              parse_mode: 'HTML',
              reply_markup: meetingRecordId ? meetingActionsKeyboard(meetingRecordId) : undefined,
            },
          );
        } else if (status === 'WAITING_ROOM') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            `⏳ <b>Bot is in the Zoom Waiting Room</b>\n\n` +
            `📌 <b>Meeting ID:</b> <code>${meeting.meetingId}</code>\n` +
            `👤 <b>Display Name:</b> <code>${userDisplayName ?? 'Meeting Assistant'}</code>\n\n` +
            `<i>Please ask the meeting host to admit <b>${userDisplayName ?? 'Meeting Assistant'}</b> to the meeting! The bot will automatically enter and start recording once admitted.</i>`,
            { parse_mode: 'HTML' },
          );
        } else if (status === 'FAILED') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            `❌ <b>Could not join Zoom meeting:</b>\n\n<code>${detail || 'Connection failed'}</code>\n\n` +
            `<i>Please check that the meeting is currently live and the passcode is correct.</i>`,
            { parse_mode: 'HTML' },
          );
        }
      } catch (err: any) {
        log.warn({ error: err?.message }, 'Failed to update join status message in Telegram');
      }
    };

    const res = await meetingService.createAndQueueMeeting({
      telegramUserId,
      meetingUrl: meeting.originalUrl,
      meetingId: meeting.meetingId,
      passcode: meeting.passcode ?? undefined,
      displayName: userDisplayName,
      onStatusChange,
    });

    meetingRecordId = res.meeting.id;

    log.info(
      { meetingId: meeting.meetingId, userId: user?.id, recordId: res.meeting.id, capability: res.capability.capability },
      'Meeting created and queued via MeetingService',
    );
  } catch (err: any) {
    ctx.session.step = 'idle';
    log.error({ error: err.message }, 'Error in /join handler');
    await ctx.reply(`⚠️ ${err.message}`, { parse_mode: 'HTML' });
  }
}

/**
 * Handle passcode input after a meeting link without ?pwd= parameter.
 */
export async function handlePasscodeInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const telegramUserId = BigInt(ctx.from!.id);
  let user = await userRepo.findByTelegramId(telegramUserId).catch(() => null);
  if (!user) {
    user = await userRepo.upsert(telegramUserId, ctx.from?.username).catch(() => null);
  }

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

  try {
    const userDisplayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username || undefined;

    const initialStatusMsg = await ctx.reply(
      `🚀 <b>Connecting to Zoom Meeting:</b> <code>${meetingId}</code>...\n\n` +
      `⚡ Launching browser assistant & joining meeting room...\n` +
      `👤 <b>Display Name:</b> <code>${userDisplayName ?? 'Meeting Assistant'}</code>\n\n` +
      `<i>Please ensure the assistant is admitted if a waiting room is enabled.</i>`,
      { parse_mode: 'HTML' },
    );

    let meetingRecordId = '';

    const onStatusChange = async (status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM', detail?: string) => {
      try {
        if (status === 'CONNECTED') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            `✅ <b>Assistant is now IN the Zoom Meeting!</b>\n\n` +
            `📌 <b>Meeting ID:</b> <code>${meetingId}</code>\n` +
            `👤 <b>Display Name:</b> <code>${userDisplayName ?? 'Meeting Assistant'}</code>\n` +
            `🎥 <b>Screen Recording:</b> 🟢 <b>Active & Recording</b>\n\n` +
            `The assistant is attending and capturing the meeting session.\n` +
            `Send <code>/status</code> to check duration or <code>/stop</code> to finish and receive your video!`,
            {
              parse_mode: 'HTML',
              reply_markup: meetingRecordId ? meetingActionsKeyboard(meetingRecordId) : undefined,
            },
          );
        } else if (status === 'WAITING_ROOM') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            `⏳ <b>Bot is in the Zoom Waiting Room</b>\n\n` +
            `📌 <b>Meeting ID:</b> <code>${meetingId}</code>\n` +
            `👤 <b>Display Name:</b> <code>${userDisplayName ?? 'Meeting Assistant'}</code>\n\n` +
            `<i>Please ask the meeting host to admit <b>${userDisplayName ?? 'Meeting Assistant'}</b> to the meeting! The bot will automatically enter and start recording once admitted.</i>`,
            { parse_mode: 'HTML' },
          );
        } else if (status === 'FAILED') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            initialStatusMsg.message_id,
            `❌ <b>Could not join Zoom meeting:</b>\n\n<code>${detail || 'Connection failed'}</code>\n\n` +
            `<i>Please check that the meeting is currently live and the passcode is correct.</i>`,
            { parse_mode: 'HTML' },
          );
        }
      } catch (err: any) {
        log.warn({ error: err?.message }, 'Failed to update passcode join status message in Telegram');
      }
    };

    const res = await meetingService.createAndQueueMeeting({
      telegramUserId,
      meetingUrl,
      meetingId,
      passcode: text,
      displayName: userDisplayName,
      onStatusChange,
    });

    meetingRecordId = res.meeting.id;
  } catch (err: any) {
    await ctx.reply(`⚠️ ${err.message}`, { parse_mode: 'HTML' });
  }
}
