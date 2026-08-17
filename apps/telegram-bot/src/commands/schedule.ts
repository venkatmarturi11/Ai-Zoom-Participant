import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { parseMeetingUrl, extractZoomUrl } from '@zoom-assistant/meeting-parser';
import { meetingService } from '@zoom-assistant/orchestrator';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'schedule-command' });

/**
 * /schedule — Schedule a future meeting join
 */
export async function scheduleCommand(ctx: BotContext): Promise<void> {
  // Start the scheduling flow — prompt for the meeting link
  ctx.session.step = 'awaiting_schedule_link';
  ctx.session.pendingMeetingUrl = undefined;
  ctx.session.pendingMeetingId = undefined;
  ctx.session.pendingPasscode = undefined;

  await ctx.reply(
    '📹 <b>Schedule a Zoom Meeting</b>\n\nPlease send your Zoom meeting invite link.\n\n<i>After sending the link, I will ask what time to join.</i>',
    { parse_mode: 'HTML' },
  );
}

/**
 * Handle meeting link input during schedule flow.
 */
export async function handleScheduleMeetingLinkInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const url = extractZoomUrl(text) ?? text;
  const result = parseMeetingUrl(url);

  if (!result.success) {
    await ctx.reply(messages.invalidMeetingUrl(result.error), { parse_mode: 'HTML' });
    return;
  }

  const { meeting } = result;

  ctx.session.pendingMeetingId = meeting.meetingId;
  ctx.session.pendingMeetingUrl = meeting.originalUrl;
  ctx.session.pendingPasscode = meeting.passcode ?? undefined;

  if (!meeting.passcode) {
    ctx.session.step = 'awaiting_schedule_passcode';
    await ctx.reply(messages.meetingNeedsPasscode, { parse_mode: 'HTML' });
    return;
  }

  ctx.session.step = 'awaiting_schedule_time';
  await promptForScheduleTime(ctx);
}

/**
 * Handle passcode input during schedule flow.
 */
export async function handleSchedulePasscodeInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  ctx.session.pendingPasscode = text;
  ctx.session.step = 'awaiting_schedule_time';
  await promptForScheduleTime(ctx);
}

async function promptForScheduleTime(ctx: BotContext): Promise<void> {
  const tz = process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata';
  await ctx.reply(
    `⏰ <b>When should the bot join?</b> (${tz})\n\nPlease enter the time, for example:\n• <code>18:30</code> (today)\n• <code>18:30 tomorrow</code>\n• <code>2026-08-20 14:00</code>`,
    { parse_mode: 'HTML' },
  );
}

/**
 * Handle time input for scheduling and create scheduled meeting job.
 */
export async function handleScheduleTimeInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const timezone = process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata';
  const scheduledTime = parseTimeInput(text, timezone);

  if (!scheduledTime) {
    await ctx.reply(
      '❌ Could not understand that time.\n\nPlease enter a time like:\n• <code>18:30</code>\n• <code>18:30 tomorrow</code>\n• <code>2026-08-20 14:00</code>',
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (scheduledTime.getTime() <= Date.now() + 30000) {
    await ctx.reply('❌ The scheduled time must be at least 1 minute in the future.', { parse_mode: 'HTML' });
    return;
  }

  const telegramUserId = BigInt(ctx.from!.id);
  const meetingId = ctx.session.pendingMeetingId;
  const meetingUrl = ctx.session.pendingMeetingUrl;
  const passcode = ctx.session.pendingPasscode;

  if (!meetingId) {
    ctx.session.step = 'idle';
    await ctx.reply('❌ Session expired. Please send <code>/schedule</code> again.', { parse_mode: 'HTML' });
    return;
  }

  try {
    const result = await meetingService.scheduleMeeting({
      telegramUserId,
      meetingId,
      meetingUrl: meetingUrl ?? `https://zoom.us/j/${meetingId}`,
      passcode,
      scheduledAt: scheduledTime,
      timezone,
    });

    ctx.session.step = 'idle';
    ctx.session.pendingMeetingUrl = undefined;
    ctx.session.pendingMeetingId = undefined;
    ctx.session.pendingPasscode = undefined;

    const formattedTime = scheduledTime.toLocaleString('en-IN', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    log.info({ meetingDbId: result.meeting.id, scheduledTime: scheduledTime.toISOString() }, 'Meeting scheduled successfully');

    await ctx.reply(
      messages.meetingScheduled(result.meeting.zoomMeetingId, formattedTime),
      { parse_mode: 'HTML' },
    );
  } catch (err: any) {
    log.error({ error: err?.message }, 'Failed to schedule meeting');
    await ctx.reply(`❌ Failed to schedule meeting: ${err?.message || 'Unknown error'}`, { parse_mode: 'HTML' });
  }
}

// ============================================================
// Time parsing helper with IANA Timezone support
// ============================================================

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  return {
    year: map['year']!,
    month: map['month']!,
    day: map['day']!,
    hour: map['hour'] === 24 ? 0 : map['hour']!,
    minute: map['minute']!,
    second: map['second']!,
  };
}

function createZonedDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  const targetIso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  let guess = new Date(`${targetIso}Z`);

  for (let i = 0; i < 3; i++) {
    const zoned = getZonedParts(guess, timeZone);
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = desiredAsUtc - zonedAsUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

export function parseTimeInput(input: string, timezone: string = 'Asia/Kolkata'): Date | null {
  const trimmed = input.trim();
  const now = new Date();
  const currentZoned = getZonedParts(now, timezone);

  // 1. "YYYY-MM-DD HH:MM"
  const fullMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (fullMatch) {
    const [, y, m, d, h, min] = fullMatch;
    return createZonedDate(Number(y), Number(m), Number(d), Number(h), Number(min), timezone);
  }

  // 2. "HH:MM tomorrow"
  const tomorrowMatch = /^(\d{1,2}):(\d{2})\s+tomorrow$/i.exec(trimmed);
  if (tomorrowMatch) {
    const [, h, min] = tomorrowMatch;
    // Advance day by 1
    const tomorrowApprox = new Date(now.getTime() + 24 * 3600 * 1000);
    const tomorrowZoned = getZonedParts(tomorrowApprox, timezone);
    return createZonedDate(tomorrowZoned.year, tomorrowZoned.month, tomorrowZoned.day, Number(h), Number(min), timezone);
  }

  // 3. "HH:MM today" or just "HH:MM"
  const timeOnlyMatch = /^(\d{1,2}):(\d{2})(?:\s+today)?$/i.exec(trimmed);
  if (timeOnlyMatch) {
    const [, h, min] = timeOnlyMatch;
    let target = createZonedDate(currentZoned.year, currentZoned.month, currentZoned.day, Number(h), Number(min), timezone);
    // If the time already passed today, assume tomorrow
    if (target.getTime() <= now.getTime()) {
      const tomorrowApprox = new Date(now.getTime() + 24 * 3600 * 1000);
      const tomorrowZoned = getZonedParts(tomorrowApprox, timezone);
      target = createZonedDate(tomorrowZoned.year, tomorrowZoned.month, tomorrowZoned.day, Number(h), Number(min), timezone);
    }
    return target;
  }

  return null;
}
