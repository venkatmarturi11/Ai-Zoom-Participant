import { getMeetingJoinQueue, getMeetingControlQueue, getMeetingCleanupQueue } from './queues.js';
import type { MeetingStartPayload, MeetingStopPayload, MeetingCleanupPayload } from './jobs.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'queue-producer' });

export const queueProducers = {
  /**
   * Enqueue a meeting start job.
   */
  async enqueueMeetingStart(payload: MeetingStartPayload): Promise<string> {
    if (!process.env['REDIS_URL']) {
      log.info({ meetingId: payload.meetingId }, 'REDIS_URL not configured; skipping BullMQ enqueue');
      return `local-start-${payload.meetingId}`;
    }

    try {
      const queue = getMeetingJoinQueue();
      const jobId = `meeting-start-${payload.meetingId}`;

      const job = await queue.add('MEETING_START', payload, {
        jobId,
      });

      log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Enqueued MEETING_START job');
      return job.id!;
    } catch (err: any) {
      log.warn({ error: err?.message }, 'Queue enqueue error (continuing)');
      return `local-start-${payload.meetingId}`;
    }
  },

  /**
   * Enqueue a delayed meeting start job for scheduled joins.
   */
  async enqueueScheduledMeetingStart(payload: MeetingStartPayload, delayMs: number): Promise<string> {
    if (!process.env['REDIS_URL']) {
      log.info({ meetingId: payload.meetingId }, 'REDIS_URL not configured; skipping BullMQ delayed enqueue');
      return `local-sched-${payload.meetingId}`;
    }

    try {
      const queue = getMeetingJoinQueue();
      const jobId = `meeting-schedule-${payload.meetingId}`;

      const job = await queue.add('MEETING_START', payload, {
        jobId,
        delay: delayMs,
      });

      log.info({ meetingId: payload.meetingId, delayMs, jobId: job.id }, 'Enqueued scheduled MEETING_START job');
      return job.id!;
    } catch (err: any) {
      log.warn({ error: err?.message }, 'Queue enqueue error (continuing)');
      return `local-sched-${payload.meetingId}`;
    }
  },

  /**
   * Enqueue a meeting stop control job.
   */
  async enqueueMeetingStop(payload: MeetingStopPayload): Promise<string> {
    if (!process.env['REDIS_URL']) {
      return `local-stop-${payload.meetingId}`;
    }

    try {
      const queue = getMeetingControlQueue();
      const jobId = `meeting-stop-${payload.meetingId}`;

      const job = await queue.add('MEETING_STOP', payload, {
        jobId,
      });

      log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Enqueued MEETING_STOP job');
      return job.id!;
    } catch (err: any) {
      log.warn({ error: err?.message }, 'Queue enqueue error (continuing)');
      return `local-stop-${payload.meetingId}`;
    }
  },

  /**
   * Enqueue a cleanup job.
   */
  async enqueueMeetingCleanup(payload: MeetingCleanupPayload): Promise<string> {
    if (!process.env['REDIS_URL']) {
      return `local-clean-${payload.meetingId}`;
    }

    try {
      const queue = getMeetingCleanupQueue();
      const jobId = `meeting-cleanup-${payload.meetingId}-${Date.now()}`;

      const job = await queue.add('MEETING_CLEANUP', payload, {
        jobId,
      });

      log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Enqueued MEETING_CLEANUP job');
      return job.id!;
    } catch (err: any) {
      log.warn({ error: err?.message }, 'Queue enqueue error (continuing)');
      return `local-clean-${payload.meetingId}`;
    }
  },
};
