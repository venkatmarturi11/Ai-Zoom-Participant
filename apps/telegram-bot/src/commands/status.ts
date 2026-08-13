import type { BotContext } from '../bot.js';
import { userRepo, zoomAccountRepo, meetingRepo } from '@zoom-assistant/database';
import { messages } from '../formatters/messages.js';
import { activeSessionKeyboard } from '../keyboards/inline.js';

/**
 * /status — View current active meeting status
 */
export async function statusCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

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

  const activeMeetings = await meetingRepo.findActiveByUserId(user.id);

  if (activeMeetings.length === 0) {
    await ctx.reply(messages.statusNoActive, { parse_mode: 'HTML' });
    return;
  }

  const active = activeMeetings[0]!;
  const duration = active.actualStart
    ? formatDuration(Date.now() - active.actualStart.getTime())
    : '00:00:00';

  await ctx.reply(
    messages.statusConnected({
      topic: active.topic,
      meetingId: active.zoomMeetingId,
      email: zoomAccount.zoomEmail,
      duration,
      connection: active.status === 'CONNECTED' ? '🟢 Stable' : `🟡 ${active.status}`,
    }),
    {
      parse_mode: 'HTML',
      reply_markup: activeSessionKeyboard(active.id),
    },
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
