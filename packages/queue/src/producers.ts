import { getMeetingJoinQueue, getMeetingControlQueue, getMeetingCleanupQueue } from './queues.js';
import type { MeetingStartPayload, MeetingStopPayload, MeetingCleanupPayload } from './jobs.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'queue-producer' });

export const queueProducers = {
  /**
   * Enqueue a meeting start job.
   * Uses deterministic jobId (`meeting-start:{meetingId}`) for idempotency & duplicate job prevention.
   */
  async enqueueMeetingStart(payload: MeetingStartPayload): Promise<string> {
    const queue = getMeetingJoinQueue();
    const jobId = `meeting-start:${payload.meetingId}`;

    const job = await queue.add('MEETING_START', payload, {
      jobId,
    });

    log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Enqueued MEETING_START job');
    return job.id!;
  },

  /**
   * Enqueue a delayed meeting start job for scheduled joins.
   * Uses BullMQ delayed jobs backed by Redis (durable across process restarts).
   */
  async enqueueScheduledMeetingStart(payload: MeetingStartPayload, delayMs: number): Promise<string> {
    const queue = getMeetingJoinQueue();
    const jobId = `meeting-schedule:${payload.meetingId}`;

    const job = await queue.add('MEETING_START', payload, {
      jobId,
      delay: delayMs,
    });

    log.info({ meetingId: payload.meetingId, delayMs, jobId: job.id }, 'Enqueued scheduled MEETING_START job');
    return job.id!;
  },

  /**
   * Enqueue a meeting stop control job.
   */
  async enqueueMeetingStop(payload: MeetingStopPayload): Promise<string> {
    const queue = getMeetingControlQueue();
    const jobId = `meeting-stop:${payload.meetingId}`;

    const job = await queue.add('MEETING_STOP', payload, {
      jobId,
    });

    log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Enqueued MEETING_STOP job');
    return job.id!;
  },

  /**
   * Enqueue a cleanup job.
   */
  async enqueueMeetingCleanup(payload: MeetingCleanupPayload): Promise<string> {
    const queue = getMeetingCleanupQueue();
    const jobId = `meeting-cleanup:${payload.meetingId}:${Date.now()}`;

    const job = await queue.add('MEETING_CLEANUP', payload, {
      jobId,
    });

    log.info({ meetingId: payload.meetingId, jobId: job.id }, 'Enqueued MEETING_CLEANUP job');
    return job.id!;
  },
};
