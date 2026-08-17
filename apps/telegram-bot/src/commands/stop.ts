import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { userRepo, meetingRepo, auditRepo } from '@zoom-assistant/database';
import { meetingService } from '@zoom-assistant/orchestrator';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'stop-command' });

/**
 * /stop — Stop active meeting bot session, finalize recording, save to DB, send download link
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
    await ctx.reply('ℹ️ No active recording session to stop.\n\nSend a Zoom meeting link to start recording!', { parse_mode: 'HTML' });
    return;
  }

  let activeMeetings;
  try {
    activeMeetings = await meetingRepo.findActiveByUserId(user.id);
  } catch {
    await ctx.reply('ℹ️ No active recording session to stop.\n\nSend a Zoom meeting link to start recording!', { parse_mode: 'HTML' });
    return;
  }

  if (activeMeetings.length === 0) {
    await ctx.reply('ℹ️ No active recording session to stop.\n\nSend a Zoom meeting link to start recording!', { parse_mode: 'HTML' });
    return;
  }

  const active = activeMeetings[0]!;
  const durationStr = active.actualStart
    ? formatDuration(Date.now() - active.actualStart.getTime())
    : '00:00:00';

  // Show "Stopping..." message
  const stoppingMsg = await ctx.reply(
    '⏳ <b>Stopping recording & saving video...</b>\n\n<i>Please wait while the recording is finalized and saved to database.</i>',
    { parse_mode: 'HTML' },
  );

  // Stop meeting session and capture recording
  let downloadUrl: string | undefined;

  try {
    const stopResult = await meetingService.stopMeeting(telegramUserId, active.id);
    downloadUrl = stopResult.downloadUrl;

    log.info(
      { meetingId: active.id, downloadUrl, hasVideo: Boolean(stopResult.videoBuffer) },
      'Meeting stopped and recording saved',
    );
  } catch (err: any) {
    log.warn({ error: err?.message }, 'MeetingService.stopMeeting warning');
  }

  // Log the stop action
  try {
    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_STOPPED_MANUALLY',
      metadata: { meetingId: active.id, duration: durationStr, downloadUrl },
    }).catch(() => {});
  } catch {
    // ignore
  }

  // Delete the "stopping" message
  await ctx.api.deleteMessage(ctx.chat!.id, stoppingMsg.message_id).catch(() => {});

  // Send final result with download link
  if (downloadUrl) {
    await ctx.reply(
      messages.recordingSaved({
        meetingId: active.zoomMeetingId,
        duration: durationStr,
        downloadUrl,
      }),
      { parse_mode: 'HTML', link_preview_options: { is_disabled: false } },
    );
  } else {
    await ctx.reply(
      messages.recordingNoVideo(active.zoomMeetingId, durationStr),
      { parse_mode: 'HTML' },
    );
  }
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
  let downloadUrl: string | undefined;

  try {
    const meeting = await meetingRepo.findById(meetingId);
    if (meeting?.actualStart) {
      durationStr = formatDuration(Date.now() - meeting.actualStart.getTime());
      meetingIdStr = meeting.zoomMeetingId;
    }

    const stopResult = await meetingService.stopMeeting(telegramUserId, meetingId);
    downloadUrl = stopResult.downloadUrl;

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_STOPPED_MANUALLY',
      metadata: { meetingId, duration: durationStr, downloadUrl },
    }).catch(() => {});

    log.info({ meetingId, userId: user.id, downloadUrl }, 'Meeting session stopped by user');
  } catch {
    // DB error, continue
  }

  // Send result with download link
  if (downloadUrl) {
    await ctx.editMessageText(
      messages.recordingSaved({
        meetingId: meetingIdStr,
        duration: durationStr,
        downloadUrl,
      }),
      { parse_mode: 'HTML' },
    ).catch(() => {});
  } else {
    await ctx.editMessageText(
      messages.recordingNoVideo(meetingIdStr, durationStr),
      { parse_mode: 'HTML' },
    ).catch(() => {});
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
