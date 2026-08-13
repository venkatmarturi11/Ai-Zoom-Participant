import type { BotContext } from '../bot.js';
import { userRepo, meetingRepo, auditRepo } from '@zoom-assistant/database';
import { messages } from '../formatters/messages.js';
import { stopConfirmKeyboard } from '../keyboards/inline.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'stop-command' });

/**
 * /stop — Confirm and stop active meeting bot session
 */
export async function stopCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) {
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
  }

  const activeMeetings = await meetingRepo.findActiveByUserId(user.id);
  if (activeMeetings.length === 0) {
    await ctx.reply('ℹ️ No active meeting session to stop.', { parse_mode: 'HTML' });
    return;
  }

  const active = activeMeetings[0]!;
  const duration = active.actualStart
    ? formatDuration(Date.now() - active.actualStart.getTime())
    : '00:00:00';

  await ctx.reply(messages.stopConfirm(active.topic, duration), {
    parse_mode: 'HTML',
    reply_markup: stopConfirmKeyboard(active.id),
  });
}

/**
 * Handle confirmation callback for stopping a meeting
 */
export async function handleStopConfirm(ctx: BotContext, meetingId: string): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);
  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) return;

  // Update meeting status in DB to STOPPING / CANCELLED
  await meetingRepo.updateStatus(meetingId, 'STOPPING');

  // TODO: Signal Redis / Worker queue to terminate the meeting worker process

  await meetingRepo.updateStatus(meetingId, 'COMPLETED');

  await auditRepo.log({
    userId: user.id,
    action: 'MEETING_STOPPED_MANUALLY',
    metadata: { meetingId },
  });

  log.info({ meetingId, userId: user.id }, 'Meeting session stopped by user');

  await ctx.editMessageText(messages.meetingStopped, { parse_mode: 'HTML' });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
