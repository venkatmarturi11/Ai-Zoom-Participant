import { Queue } from 'bullmq';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAMES } from '@zoom-assistant/shared';

let meetingJoinQueue: Queue | undefined;
let meetingControlQueue: Queue | undefined;
let meetingCleanupQueue: Queue | undefined;
let tokenRefreshQueue: Queue | undefined;
let recordingCheckQueue: Queue | undefined;

export function getMeetingJoinQueue(): Queue {
  if (!meetingJoinQueue) {
    meetingJoinQueue = new Queue(QUEUE_NAMES.MEETING_JOIN, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return meetingJoinQueue;
}

export function getMeetingControlQueue(): Queue {
  if (!meetingControlQueue) {
    meetingControlQueue = new Queue(QUEUE_NAMES.MEETING_CONTROL, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return meetingControlQueue;
}

export function getMeetingCleanupQueue(): Queue {
  if (!meetingCleanupQueue) {
    meetingCleanupQueue = new Queue(QUEUE_NAMES.MEETING_CLEANUP, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return meetingCleanupQueue;
}

export function getTokenRefreshQueue(): Queue {
  if (!tokenRefreshQueue) {
    tokenRefreshQueue = new Queue(QUEUE_NAMES.TOKEN_REFRESH, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return tokenRefreshQueue;
}

export function getRecordingCheckQueue(): Queue {
  if (!recordingCheckQueue) {
    recordingCheckQueue = new Queue(QUEUE_NAMES.RECORDING_CHECK, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return recordingCheckQueue;
}
