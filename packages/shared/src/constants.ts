// ============================================================
// Meeting status lifecycle — full state machine
// ============================================================

export const MEETING_STATUS = {
  CREATED: 'CREATED',
  SCHEDULED: 'SCHEDULED',
  STARTING: 'STARTING',
  AUTHENTICATING: 'AUTHENTICATING',
  SDK_INITIALIZING: 'SDK_INITIALIZING',
  JOINING: 'JOINING',
  WAITING_ROOM: 'WAITING_ROOM',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  STOPPING: 'STOPPING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type MeetingStatusType = (typeof MEETING_STATUS)[keyof typeof MEETING_STATUS];

// ============================================================
// Operational limits
// ============================================================

export const LIMITS = {
  /** Maximum concurrent meetings a single user can run */
  MAX_CONCURRENT_MEETINGS_PER_USER: 1,

  /** Safety cap — force-terminate sessions exceeding this */
  MAX_SESSION_DURATION_HOURS: 8,

  /** How long to wait in the waiting room before prompting user */
  WAITING_ROOM_TIMEOUT_MINUTES: 30,

  /** Maximum join/reconnect retry attempts */
  MAX_RETRIES: 4,

  /** Exponential backoff delays in milliseconds */
  RETRY_DELAYS_MS: [5_000, 15_000, 30_000, 60_000] as const,

  /** Worker heartbeat interval */
  HEARTBEAT_INTERVAL_MS: 30_000,

  /** If no heartbeat received within this window, mark unhealthy */
  HEARTBEAT_TIMEOUT_MS: 90_000,

  /** Maximum times the watchdog will restart a crashed worker */
  MAX_WORKER_RESTARTS: 3,

  /** OAuth state parameter expires after this many minutes */
  OAUTH_STATE_EXPIRY_MINUTES: 10,

  /** Fetch ZAK/OBF token this many minutes before scheduled join */
  TOKEN_PREFETCH_MINUTES: 5,

  /** Start preparing the worker this many minutes before scheduled join */
  SCHEDULE_PREP_MINUTES: 10,
} as const;

// ============================================================
// Per-command rate limits (requests per window)
// ============================================================

export const RATE_LIMITS = {
  join: { max: 5, windowSeconds: 60 },
  connect_zoom: { max: 3, windowSeconds: 600 },
  disconnect_zoom: { max: 3, windowSeconds: 600 },
  stop: { max: 5, windowSeconds: 60 },
  default: { max: 30, windowSeconds: 60 },
} as const;

// ============================================================
// Telegram notification event types
// ============================================================

export const NOTIFICATION_EVENTS = {
  ZOOM_CONNECTED: 'ZOOM_CONNECTED',
  ZOOM_DISCONNECTED: 'ZOOM_DISCONNECTED',
  MEETING_SCHEDULED: 'MEETING_SCHEDULED',
  MEETING_STARTING: 'MEETING_STARTING',
  MEETING_JOINED: 'MEETING_JOINED',
  WAITING_ROOM: 'WAITING_ROOM',
  WAITING_TIMEOUT: 'WAITING_TIMEOUT',
  RECONNECTING: 'RECONNECTING',
  RECONNECTED: 'RECONNECTED',
  MEETING_ENDED: 'MEETING_ENDED',
  MEETING_STOPPED: 'MEETING_STOPPED',
  AUTH_ERROR: 'AUTH_ERROR',
  MEETING_ERROR: 'MEETING_ERROR',
  WORKER_ERROR: 'WORKER_ERROR',
} as const;

// ============================================================
// BullMQ queue / job names (must NOT contain colons)
// ============================================================

export const QUEUE_NAMES = {
  MEETING_JOIN: 'meeting-join',
  MEETING_CONTROL: 'meeting-control',
  MEETING_SCHEDULE: 'meeting-schedule',
  MEETING_TIMEOUT: 'meeting-timeout',
  MEETING_CLEANUP: 'meeting-cleanup',
  TOKEN_REFRESH: 'token-refresh',
  RECORDING_CHECK: 'recording-check',
} as const;
