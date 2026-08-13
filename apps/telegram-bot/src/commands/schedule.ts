import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { userRepo, zoomAccountRepo } from '@zoom-assistant/database';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'schedule-command' });

/**
 * /schedule — Schedule a future meeting join
 *
 * Flow:
 *   1. Check Zoom account connected
 *   2. Prompt for meeting link (reuses /join link parsing)
 *   3. Prompt for desired join time
 *   4. Create scheduled meeting record + BullMQ delayed job
 */
export async function scheduleCommand(ctx: BotContext): Promise<void> {
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

  // Start the scheduling flow — first ask for the meeting link
  ctx.session.step = 'awaiting_meeting_link';
  await ctx.reply(
    '📹 Send your Zoom meeting link to schedule.\n\n<i>After sending the link, I\'ll ask when to join.</i>',
    { parse_mode: 'HTML' },
  );
}

/**
 * Handle time input for scheduling.
 * Called after the meeting link has been parsed and the user sends a time.
 */
export async function handleScheduleTimeInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  // Parse time input — supports formats like "18:30", "18:30 today", "18:30 tomorrow", "2026-08-14 09:00"
  const scheduledTime = parseTimeInput(text);

  if (!scheduledTime) {
    await ctx.reply(
      '❌ Could not parse the time.\n\nPlease use a format like:\n• <code>18:30</code>\n• <code>18:30 tomorrow</code>\n• <code>2026-08-14 09:00</code>',
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (scheduledTime.getTime() <= Date.now()) {
    await ctx.reply('❌ The scheduled time must be in the future.', { parse_mode: 'HTML' });
    return;
  }

  ctx.session.step = 'idle';

  // TODO: In Phase 7, create the BullMQ delayed job here
  const formattedTime = scheduledTime.toLocaleString('en-IN', {
    timeZone: process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  log.info({ scheduledTime: scheduledTime.toISOString() }, 'Meeting scheduled');

  await ctx.reply(
    messages.meetingScheduled('(pending)', formattedTime),
    { parse_mode: 'HTML' },
  );
}

// ============================================================
// Time parsing helper
// ============================================================

function parseTimeInput(input: string): Date | null {
  const timezone = process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata';
  const now = new Date();

  // Try "HH:MM" — assumes today
  const timeOnlyMatch = /^(\d{1,2}):(\d{2})$/.exec(input);
  if (timeOnlyMatch) {
    const [, hours, minutes] = timeOnlyMatch;
    const date = new Date(now.toLocaleDateString('en-US', { timeZone: timezone }));
    date.setHours(Number(hours), Number(minutes), 0, 0);
    return date;
  }

  // Try "HH:MM tomorrow"
  const tomorrowMatch = /^(\d{1,2}):(\d{2})\s+tomorrow$/i.exec(input);
  if (tomorrowMatch) {
    const [, hours, minutes] = tomorrowMatch;
    const date = new Date(now.toLocaleDateString('en-US', { timeZone: timezone }));
    date.setDate(date.getDate() + 1);
    date.setHours(Number(hours), Number(minutes), 0, 0);
    return date;
  }

  // Try "YYYY-MM-DD HH:MM"
  const fullMatch = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/.exec(input);
  if (fullMatch) {
    const [, dateStr, hours, minutes] = fullMatch;
    const date = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${minutes}:00`);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}
