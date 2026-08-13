import type { BotContext } from '../bot.js';
import { userRepo, meetingRepo } from '@zoom-assistant/database';
import { activeSessionKeyboard } from '../keyboards/inline.js';

/**
 * /meetings — List active and recent meetings
 */
export async function meetingsCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) {
    await ctx.reply('⚠️ No Zoom account connected.\n\nUse /connect_zoom to link your Zoom account.', {
      parse_mode: 'HTML',
    });
    return;
  }

  const meetings = await meetingRepo.listByUserId(user.id, { limit: 5 });

  if (meetings.length === 0) {
    await ctx.reply('ℹ️ No meetings found.\n\nUse /join to join a meeting or /schedule to schedule one.', {
      parse_mode: 'HTML',
    });
    return;
  }

  let text = '📋 <b>Recent & Active Meetings</b>\n\n';

  for (const m of meetings) {
    const statusIcon = getStatusIcon(m.status);
    text += `${statusIcon} <b>ID:</b> <code>${m.zoomMeetingId}</code>\n`;
    text += `   <b>Status:</b> ${m.status}\n`;
    if (m.topic) text += `   <b>Topic:</b> ${m.topic}\n`;
    text += `   <b>Created:</b> ${m.createdAt.toLocaleTimeString('en-IN', { timeZone: m.timezone })}\n\n`;
  }

  const activeMeeting = meetings.find((m) =>
    ['CREATED', 'SCHEDULED', 'STARTING', 'AUTHENTICATING', 'SDK_INITIALIZING', 'JOINING', 'WAITING_ROOM', 'CONNECTED', 'RECONNECTING'].includes(m.status),
  );

  if (activeMeeting) {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: activeSessionKeyboard(activeMeeting.id),
    });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML' });
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'CONNECTED':
      return '🟢';
    case 'WAITING_ROOM':
      return '🟡';
    case 'COMPLETED':
      return '✅';
    case 'FAILED':
      return '🔴';
    case 'CANCELLED':
      return '❌';
    default:
      return '⚙️';
  }
}
