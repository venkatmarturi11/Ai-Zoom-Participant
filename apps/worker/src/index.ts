import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'bullmq';
import { QUEUE_NAMES, createLogger } from '@zoom-assistant/shared';
import { getRedisConnection, closeRedisConnection, queueProducers } from '@zoom-assistant/queue';
import type { MeetingStartPayload, MeetingStopPayload, RecordingCheckPayload } from '@zoom-assistant/queue';
import { decryptToken } from '@zoom-assistant/crypto';
import { meetingRepo, zoomAccountRepo, userRepo } from '@zoom-assistant/database';
import { getMeetingRecordings, getValidAccessToken } from '@zoom-assistant/zoom';
import { WorkerManager } from './worker-manager.js';
import type { MeetingWorkerConfig } from './worker-context.js';

export { WorkerStateMachine, type WorkerState } from './state/state-machine.js';
export { MeetingWorker } from './meeting-worker.js';
export { WorkerManager } from './worker-manager.js';
export { type MeetingWorkerConfig, type WorkerContext } from './worker-context.js';
export { ReconnectManager } from './monitoring/reconnect.js';
export { Watchdog } from './monitoring/watchdog.js';

const log = createLogger({ module: 'worker-daemon' });

// Backoff schedule for RECORDING_CHECK retries: Zoom cloud recordings commonly
// take anywhere from a few minutes to over an hour to finish processing.
const RECORDING_CHECK_DELAYS_MS = [5, 10, 15, 30, 60].map((min) => min * 60 * 1000);
const RECORDING_CHECK_MAX_ATTEMPTS = RECORDING_CHECK_DELAYS_MS.length;

/**
 * Sends a message to a Telegram chat directly via the Bot API HTTP endpoint.
 * The worker daemon doesn't run a grammy Bot instance (that lives in apps/api),
 * so a plain fetch call is the simplest way to deliver a notification from here.
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN not set; cannot deliver recording notification');
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: false },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn({ status: res.status, body }, 'Telegram sendMessage failed');
    }
  } catch (err: any) {
    log.warn({ error: err?.message }, 'Telegram sendMessage request failed');
  }
}

/**
 * Sends a video file directly to a Telegram chat via multipart/form-data.
 */
async function sendTelegramVideo(chatId: string, videoPath: string, caption: string): Promise<boolean> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN not set; cannot deliver video recording');
    return false;
  }

  if (!fs.existsSync(videoPath)) {
    log.warn({ videoPath }, 'Video file does not exist for upload');
    return false;
  }

  const stats = fs.statSync(videoPath);
  if (stats.size === 0) {
    log.warn({ videoPath }, 'Video file is empty (0 bytes); skipping upload');
    return false;
  }

  // Telegram Bot API maximum file upload size is 50MB (52428800 bytes)
  const MAX_TELEGRAM_SIZE = 50 * 1024 * 1024;
  if (stats.size > MAX_TELEGRAM_SIZE) {
    log.warn({ sizeBytes: stats.size, maxSize: MAX_TELEGRAM_SIZE }, 'Video file exceeds Telegram 50MB upload limit');
    await sendTelegramMessage(
      chatId,
      `⚠️ <b>Meeting Screen Recording Ready</b>\n\n` +
        `The recorded video file is ${(stats.size / (1024 * 1024)).toFixed(1)}MB, which exceeds Telegram's 50MB bot upload limit.\n` +
        `Please check if Zoom Cloud Recording processed your video link above.`,
    );
    return false;
  }

  try {
    log.info({ videoPath, sizeBytes: stats.size, chatId }, 'Uploading screen recording video to Telegram...');
    const fileBuffer = fs.readFileSync(videoPath);
    const blob = new Blob([fileBuffer], { type: 'video/mp4' });
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');
    formData.append('supports_streaming', 'true');
    formData.append('video', blob, path.basename(videoPath));

    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error({ status: res.status, body }, 'Failed to upload video to Telegram');
      return false;
    }

    log.info({ videoPath, chatId }, '🎬 Successfully delivered meeting screen recording video to Telegram!');
    return true;
  } catch (err: any) {
    log.error({ error: err?.message, videoPath }, 'Exception during Telegram video upload');
    return false;
  }
}

async function main() {
  log.info('Starting Zoom Meeting Worker Daemon...');

  const connection = getRedisConnection();
  const workerManager = WorkerManager.getInstance();

  // 1. Queue Worker for MEETING_JOIN queue
  const joinWorker = new Worker<MeetingStartPayload>(
    QUEUE_NAMES.MEETING_JOIN,
    async (job) => {
      const payload = job.data;
      log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Processing MEETING_START job');

      const meeting = await meetingRepo.findById(payload.meetingId);
      if (!meeting) {
        log.error({ meetingId: payload.meetingId }, 'Meeting not found in database');
        return;
      }

      const zoomAccount = await zoomAccountRepo.findActiveByUserId(payload.userId);
      const encryptionKey = process.env['ENCRYPTION_KEY'];

      let accessToken = '';
      if (zoomAccount?.accessTokenEncrypted && encryptionKey) {
        try {
          accessToken = decryptToken(zoomAccount.accessTokenEncrypted, encryptionKey);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ meetingId: payload.meetingId, error: message }, 'Failed to decrypt access token');
        }
      }

      let passcode: string | undefined = undefined;
      if (meeting.passcodeEncrypted && encryptionKey) {
        try {
          passcode = decryptToken(meeting.passcodeEncrypted, encryptionKey);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ meetingId: payload.meetingId, error: message }, 'Failed to decrypt meeting passcode');
        }
      }

      const config: MeetingWorkerConfig = {
        meetingId: meeting.id,
        userId: meeting.userId,
        zoomMeetingId: meeting.zoomMeetingId,
        zoomEmail: zoomAccount?.zoomEmail ?? 'bot@zoom.local',
        accessToken,
        passcode,
        displayName: meeting.displayName ?? undefined,
      };

      const worker = workerManager.getOrCreateWorker(config);
      await worker.start();
    },
    { connection },
  );

  // 2. Queue Worker for meeting control queue
  const controlWorker = new Worker<MeetingStopPayload>(
    QUEUE_NAMES.MEETING_CONTROL,
    async (job) => {
      const payload = job.data;
      log.info({ meetingId: payload.meetingId, jobId: job.id, name: job.name }, 'Processing meeting control job');

      if (job.name === 'MEETING_STOP') {
        const worker = workerManager.getWorker(payload.meetingId);
        let recordingFilePath: string | undefined;

        if (worker?.adapter) {
          try {
            const status = await worker.adapter.getStatus();
            recordingFilePath = status.details?.['recordingFilePath'] as string | undefined;
          } catch {
            // ignore
          }
        }

        await workerManager.stopWorker(payload.meetingId, payload.reason ?? 'STOP_REQUESTED');

        // Deliver screen recording if captured
        if (recordingFilePath && fs.existsSync(recordingFilePath)) {
          try {
            const user = await userRepo.findById(payload.userId);
            if (user?.telegramUserId) {
              const chatId = String(user.telegramUserId);
              const caption =
                `🎬 <b>Meeting Screen Recording</b>\n\n` +
                `📌 <b>Meeting ID:</b> <code>${payload.zoomMeetingId}</code>\n` +
                `📹 <b>Format:</b> High Definition MP4 Video\n` +
                `🤖 <b>Status:</b> Captured directly by headless bot`;

              await sendTelegramVideo(chatId, recordingFilePath, caption);
            }
          } catch (delivErr: any) {
            log.warn({ error: delivErr?.message }, 'Failed to deliver screen recording to Telegram');
          } finally {
            try {
              if (fs.existsSync(recordingFilePath)) {
                fs.unlinkSync(recordingFilePath);
                log.info({ recordingFilePath }, 'Cleaned up temporary screen recording file');
              }
            } catch {
              // ignore
            }
          }
        }
      }
    },
    { connection },
  );

  // 3. Queue Worker for delayed recording-availability checks
  const recordingWorker = new Worker<RecordingCheckPayload>(
    QUEUE_NAMES.RECORDING_CHECK,
    async (job) => {
      const payload = job.data;
      log.info({ meetingId: payload.meetingId, attempt: payload.attempt, jobId: job.id }, 'Processing RECORDING_CHECK job');

      try {
        const tokens = await getValidAccessToken(payload.userId).catch(() => null);
        if (!tokens?.accessToken) {
          log.warn({ meetingId: payload.meetingId }, 'No valid Zoom access token; abandoning recording check');
          return;
        }

        const recordings = await getMeetingRecordings(payload.zoomMeetingId, tokens.accessToken);
        const mp4Files = recordings?.recordingFiles.filter((f) => f.fileType === 'MP4') ?? [];

        if (mp4Files.length > 0 || recordings?.shareUrl) {
          const mainVideo = mp4Files[0];
          const text =
            `🎬 <b>Your meeting recording is ready!</b>\n\n` +
            `📌 <b>Meeting ID:</b> <code>${payload.zoomMeetingId}</code>\n` +
            (mainVideo?.playUrl ? `▶️ <a href="${mainVideo.playUrl}">Watch Recording Online</a>\n` : '') +
            (mainVideo?.downloadUrl ? `💾 <a href="${mainVideo.downloadUrl}">Download MP4 Video</a>\n` : '') +
            (!mainVideo && recordings?.shareUrl ? `🔗 <a href="${recordings.shareUrl}">View Meeting Recording</a>\n` : '');

          await sendTelegramMessage(payload.telegramChatId, text);
          log.info({ meetingId: payload.meetingId }, 'Recording delivered to user');
          return;
        }

        // Not ready yet — re-enqueue with backoff, or give up gracefully.
        if (payload.attempt < RECORDING_CHECK_MAX_ATTEMPTS) {
          const nextDelay = RECORDING_CHECK_DELAYS_MS[payload.attempt]!;
          await queueProducers.enqueueRecordingCheck({ ...payload, attempt: payload.attempt + 1 }, nextDelay);
          log.info({ meetingId: payload.meetingId, nextAttempt: payload.attempt + 1 }, 'Recording not ready yet; rescheduled check');
        } else {
          await sendTelegramMessage(
            payload.telegramChatId,
            `📹 <b>Recording still processing</b>\n\n` +
              `Meeting <code>${payload.zoomMeetingId}</code>'s cloud recording is taking longer than usual. ` +
              `Please check your Zoom account's Cloud Recordings page directly — it should appear there once Zoom finishes processing it.`,
          );
          log.warn({ meetingId: payload.meetingId }, 'Recording check attempts exhausted; notified user to check manually');
        }
      } catch (err: any) {
        log.error({ meetingId: payload.meetingId, error: err?.message }, 'Error during recording check');
        throw err;
      }
    },
    { connection },
  );


  joinWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'MEETING_JOIN job failed');
  });

  controlWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'meeting:control job failed');
  });

  recordingWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'recording-check job failed');
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received in worker daemon');
    await joinWorker.close();
    await controlWorker.close();
    await recordingWorker.close();
    await workerManager.stopAllWorkers('DAEMON_SHUTDOWN');
    await closeRedisConnection();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.info('Zoom Meeting Worker Daemon is running and listening to queues');
}

if (process.env['NODE_ENV'] !== 'test') {
  main().catch((err) => {
    log.fatal({ error: err }, 'Fatal error in Zoom Meeting Worker Daemon');
    process.exit(1);
  });
}
