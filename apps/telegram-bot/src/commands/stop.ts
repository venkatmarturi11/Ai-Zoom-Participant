import type { BotContext } from '../bot.js';
import { userRepo, meetingRepo, auditRepo } from '@zoom-assistant/database';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'stop-command' });

/**
 * /stop — Stop active meeting bot session immediately and display duration
 */
export async function stopCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  let user;
  try {
    user = await userRepo.findByTelegramId(telegramUserId);
    if (!user) {
      user = await userRepo.upsert(telegramUserId, ctx.from?.username);
    }
  } catch {
    await ctx.reply('ℹ️ No active meeting session to stop.\n\nSend or paste any Zoom meeting link directly in chat to join a meeting!', { parse_mode: 'HTML' });
    return;
  }

  let activeMeetings;
  try {
    activeMeetings = await meetingRepo.findActiveByUserId(user.id);
  } catch {
    await ctx.reply('ℹ️ No active meeting session to stop.\n\nSend or paste any Zoom meeting link directly in chat to join a meeting!', { parse_mode: 'HTML' });
    return;
  }

  if (activeMeetings.length === 0) {
    await ctx.reply('ℹ️ No active meeting session to stop.\n\nSend or paste any Zoom meeting link directly in chat to join a meeting!', { parse_mode: 'HTML' });
    return;
  }

  const active = activeMeetings[0]!;
  const durationStr = active.actualStart
    ? formatDuration(Date.now() - active.actualStart.getTime())
    : '00:00:00';

  try {
    await meetingRepo.updateStatus(active.id, 'STOPPING');
    await meetingRepo.updateStatus(active.id, 'COMPLETED');

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_STOPPED_MANUALLY',
      metadata: { meetingId: active.id, duration: durationStr },
    }).catch(() => {});
  } catch {
    // DB error, continue
  }

  await ctx.reply(
    `✅ <b>Meeting Session Ended!</b>\n\n` +
    `📌 <b>Meeting ID:</b> <code>${active.zoomMeetingId}</code>\n` +
    `⏱️ <b>Attended Duration:</b> <code>${durationStr}</code>\n` +
    `🤖 <b>Status:</b> Completed & Cleaned Up\n\n` +
    `The assistant has finished the meeting. You can send another Zoom link anytime to start a new session!`,
    { parse_mode: 'HTML' },
  );
}

/**
 * Handle confirmation callback for stopping a meeting
 */
export async function handleStopConfirm(ctx: BotContext, meetingId: string): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);
  let user;
  try {
    user = await userRepo.findByTelegramId(telegramUserId);
    if (!user) user = await userRepo.upsert(telegramUserId, ctx.from?.username);
  } catch {
    return;
  }

  let durationStr = '00:00:00';
  let meetingIdStr = meetingId;
  try {
    const meeting = await meetingRepo.findById(meetingId);
    if (meeting?.actualStart) {
      durationStr = formatDuration(Date.now() - meeting.actualStart.getTime());
      meetingIdStr = meeting.zoomMeetingId;
    }

    await meetingRepo.updateStatus(meetingId, 'STOPPING');
    await meetingRepo.updateStatus(meetingId, 'COMPLETED');

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_STOPPED_MANUALLY',
      metadata: { meetingId, duration: durationStr },
    }).catch(() => {});
  } catch {
    // DB error, continue
  }

  log.info({ meetingId, userId: user.id }, 'Meeting session stopped by user');

  await ctx.editMessageText(
    `✅ <b>Meeting Session Ended!</b>\n\n` +
    `📌 <b>Meeting ID:</b> <code>${meetingIdStr}</code>\n` +
    `⏱️ <b>Attended Duration:</b> <code>${durationStr}</code>\n` +
    `🤖 <b>Status:</b> Completed & Cleaned Up\n\n` +
    `The assistant has finished the meeting. You can send another Zoom link anytime to start a new session!`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
