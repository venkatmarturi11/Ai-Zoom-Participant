import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { meetingActionsKeyboard, activeSessionKeyboard } from '../keyboards/inline.js';
import { parseMeetingUrl, extractZoomUrl } from '@zoom-assistant/meeting-parser';
import { userRepo, zoomAccountRepo, meetingRepo } from '@zoom-assistant/database';
import { meetingService } from '@zoom-assistant/orchestrator';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'join-command' });

/**
 * /join — Start the meeting join flow
 *
 * Flow:
 *   1. Check Zoom account is connected
 *   2. Check no duplicate active session
 *   3. Prompt for meeting link
 *   4. Parse and validate
 *   5. Show meeting info + action buttons
 */
export async function joinCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  // Check Zoom account
  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) {
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
  }

  const zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id);
  if (!zoomAccount) {
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
  }

  // Check for existing active session (duplicate prevention)
  const activeMeetings = await meetingRepo.findActiveByUserId(user.id);
  if (activeMeetings.length > 0) {
    const active = activeMeetings[0]!;
    const duration = active.actualStart
      ? formatDuration(Date.now() - active.actualStart.getTime())
      : '00:00:00';

    await ctx.reply(
      messages.duplicateSession(active.topic, duration),
      {
        parse_mode: 'HTML',
        reply_markup: activeSessionKeyboard(active.id),
      },
    );
    return;
  }

  // Set conversation state to await meeting link
  ctx.session.step = 'awaiting_meeting_link';
  await ctx.reply(messages.sendMeetingLink, { parse_mode: 'HTML' });
}

/**
 * Handle text input when awaiting a meeting link.
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

  // Fetch user + zoom account
  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) return;

  const zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id);
  if (!zoomAccount) {
    ctx.session.step = 'idle';
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
  }

  // If this is a vanity URL, we note it but still proceed
  if (meeting.isVanityUrl) {
    log.info({ vanityName: meeting.meetingId }, 'Vanity URL received');
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

    const result = await meetingService.createAndQueueMeeting({
      telegramUserId,
      meetingUrl: meeting.originalUrl,
      meetingId: meeting.meetingId,
      passcode: meeting.passcode ?? undefined,
      displayName: userDisplayName,
    });

    log.info(
      { meetingId: meeting.meetingId, userId: user.id, recordId: result.meeting.id, capability: result.capability.capability },
      'Meeting created and queued via MeetingService',
    );

    await ctx.reply(
      `🔎 <b>Meeting detected</b>\n\nMeeting ID: <code>${meeting.meetingId}</code>\nZoom account: <code>${zoomAccount.zoomEmail}</code>\nCapability: <code>${result.capability.capability}</code>\nStatus: 🟡 QUEUED`,
      {
        parse_mode: 'HTML',
        reply_markup: meetingActionsKeyboard(result.meeting.id),
      },
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
  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) return;

  const zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id);
  if (!zoomAccount) {
    ctx.session.step = 'idle';
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
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

    const result = await meetingService.createAndQueueMeeting({
      telegramUserId,
      meetingUrl,
      meetingId,
      passcode: text,
      displayName: userDisplayName,
    });

    await ctx.reply(
      `🔎 <b>Meeting detected</b>\n\nMeeting ID: <code>${meetingId}</code>\nZoom account: <code>${zoomAccount.zoomEmail}</code>\nCapability: <code>${result.capability.capability}</code>\nStatus: 🟡 QUEUED`,
      {
        parse_mode: 'HTML',
        reply_markup: meetingActionsKeyboard(result.meeting.id),
      },
    );
  } catch (err: any) {
    await ctx.reply(`⚠️ ${err.message}`, { parse_mode: 'HTML' });
  }

}

// ============================================================
// Helpers
// ============================================================

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
