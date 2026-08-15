// ============================================================
// Job Type Definitions — STRICTLY NO SECRETS IN PAYLOADS!
// Payloads contain only identifiers and non-sensitive metadata.
// ============================================================

export type MeetingJobType =
  | 'MEETING_START'
  | 'MEETING_STOP'
  | 'MEETING_RECONNECT'
  | 'MEETING_CLEANUP'
  | 'MEETING_TIMEOUT'
  | 'TOKEN_REFRESH';

export interface BaseJobPayload {
  meetingId: string;
  userId: string;
  zoomMeetingId: string;
  requestedAt: string;
  reason?: string;
}

export interface MeetingStartPayload extends BaseJobPayload {
  mode?: 'PARTICIPANT' | 'MEDIA_ONLY';
  scheduledFor?: string;
}

export interface MeetingStopPayload extends BaseJobPayload {
  reason: string;
}

export interface MeetingReconnectPayload extends BaseJobPayload {
  attempt: number;
}

export interface MeetingCleanupPayload extends BaseJobPayload {
  reason: string;
}

export interface MeetingTimeoutPayload extends BaseJobPayload {
  timeoutMinutes: number;
}

export interface TokenRefreshPayload {
  userId: string;
  zoomUserId: string;
  requestedAt: string;
}

export interface RecordingCheckPayload {
  meetingId: string;
  userId: string;
  zoomMeetingId: string;
  telegramChatId: string;
  requestedAt: string;
  /** How many times we've already checked and found nothing yet. */
  attempt: number;
}
