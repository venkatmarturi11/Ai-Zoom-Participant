import { Worker } from 'bullmq';
import { QUEUE_NAMES, createLogger } from '@zoom-assistant/shared';
import { getRedisConnection, closeRedisConnection } from '@zoom-assistant/queue';
import type { MeetingStartPayload, MeetingStopPayload } from '@zoom-assistant/queue';
import { decryptToken } from '@zoom-assistant/crypto';
import { meetingRepo, zoomAccountRepo } from '@zoom-assistant/database';
import { WorkerManager } from './worker-manager.js';
import type { MeetingWorkerConfig } from './worker-context.js';

export { WorkerStateMachine, type WorkerState } from './state/state-machine.js';
export { MeetingWorker } from './meeting-worker.js';
export { WorkerManager } from './worker-manager.js';
export { type MeetingWorkerConfig, type WorkerContext } from './worker-context.js';
export { ReconnectManager } from './monitoring/reconnect.js';
export { Watchdog } from './monitoring/watchdog.js';

const log = createLogger({ module: 'worker-daemon' });

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

  // 2. Queue Worker for meeting:control queue
  const controlWorker = new Worker<MeetingStopPayload>(
    'meeting:control',
    async (job) => {
      const payload = job.data;
      log.info({ meetingId: payload.meetingId, jobId: job.id, name: job.name }, 'Processing meeting control job');

      if (job.name === 'MEETING_STOP') {
        await workerManager.stopWorker(payload.meetingId, payload.reason ?? 'STOP_REQUESTED');
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

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received in worker daemon');
    await joinWorker.close();
    await controlWorker.close();
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
