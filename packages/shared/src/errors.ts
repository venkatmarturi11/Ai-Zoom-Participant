// ============================================================
// Zoom-specific error codes — mapped to user-friendly messages
// ============================================================

export enum ZoomErrorCode {
  // Authentication
  OAUTH_REVOKED = 'OAUTH_REVOKED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REFRESH_FAILED = 'TOKEN_REFRESH_FAILED',
  ZAK_INVALID = 'ZAK_INVALID',
  OBF_INVALID = 'OBF_INVALID',
  SDK_AUTH_FAILED = 'SDK_AUTH_FAILED',
  APP_NOT_APPROVED = 'APP_NOT_APPROVED',
  USER_NOT_AUTHORIZED = 'USER_NOT_AUTHORIZED',

  // Meeting
  MEETING_NOT_FOUND = 'MEETING_NOT_FOUND',
  WRONG_PASSWORD = 'WRONG_PASSWORD',
  NOT_ALLOWED = 'NOT_ALLOWED',
  WAITING_FOR_HOST = 'WAITING_FOR_HOST',
  MEETING_ENDED = 'MEETING_ENDED',
  HOST_REJECTED = 'HOST_REJECTED',

  // Infrastructure
  NETWORK_ERROR = 'NETWORK_ERROR',
  SDK_ERROR = 'SDK_ERROR',
  MAX_WORKERS_REACHED = 'MAX_WORKERS_REACHED',
  DUPLICATE_SESSION = 'DUPLICATE_SESSION',
  SESSION_TIMEOUT = 'SESSION_TIMEOUT',
  WORKER_CRASH = 'WORKER_CRASH',

  // Generic
  UNKNOWN = 'UNKNOWN',
}

/**
 * User-facing Telegram messages for each error code.
 * Never expose raw SDK errors or internal details.
 */
export const ERROR_MESSAGES: Record<ZoomErrorCode, string> = {
  [ZoomErrorCode.OAUTH_REVOKED]:
    '🔐 Zoom authorization has been revoked.\nPlease reconnect your Zoom account.',
  [ZoomErrorCode.TOKEN_EXPIRED]:
    '🔐 Zoom authorization expired.\nPlease reconnect your Zoom account.',
  [ZoomErrorCode.TOKEN_REFRESH_FAILED]:
    '🔐 Unable to refresh Zoom authorization.\nPlease reconnect your Zoom account.',
  [ZoomErrorCode.ZAK_INVALID]:
    '🔐 Zoom access key is invalid.\nPlease reconnect your Zoom account.',
  [ZoomErrorCode.OBF_INVALID]:
    '🔐 Zoom authorization token is invalid.\nPlease reconnect your Zoom account.',
  [ZoomErrorCode.SDK_AUTH_FAILED]:
    '🔐 Zoom SDK authentication failed.\nPlease try again or reconnect your Zoom account.',
  [ZoomErrorCode.APP_NOT_APPROVED]:
    '⚠️ This application has not been approved by Zoom for external meetings.\nPlease contact the administrator.',
  [ZoomErrorCode.USER_NOT_AUTHORIZED]:
    '⚠️ You have not authorized this application.\nPlease connect your Zoom account first.',
  [ZoomErrorCode.MEETING_NOT_FOUND]:
    '❌ Meeting not found.\nPlease check the meeting link and try again.',
  [ZoomErrorCode.WRONG_PASSWORD]:
    '❌ Incorrect meeting passcode.\nPlease send the correct passcode.',
  [ZoomErrorCode.NOT_ALLOWED]:
    '⚠️ Unable to join this meeting.\nThe host may have restricted access.',
  [ZoomErrorCode.WAITING_FOR_HOST]:
    '🟡 Waiting for the host to start the meeting.',
  [ZoomErrorCode.MEETING_ENDED]:
    '🔴 The meeting has ended.',
  [ZoomErrorCode.HOST_REJECTED]:
    '🔴 The host did not admit the bot.\nThe session has been terminated.',
  [ZoomErrorCode.NETWORK_ERROR]:
    '⚠️ Network connection lost.\n🔄 Attempting to reconnect...',
  [ZoomErrorCode.SDK_ERROR]:
    '⚠️ An unexpected Zoom SDK error occurred.\nThe system is attempting recovery.',
  [ZoomErrorCode.MAX_WORKERS_REACHED]:
    '⚠️ Server is at capacity.\nPlease try again later.',
  [ZoomErrorCode.DUPLICATE_SESSION]:
    '⚠️ You already have an active meeting session.\nUse /status to check or /stop to end it.',
  [ZoomErrorCode.SESSION_TIMEOUT]:
    '⏱️ Session exceeded the maximum duration limit.\nThe bot has been disconnected.',
  [ZoomErrorCode.WORKER_CRASH]:
    '⚠️ The meeting worker encountered a fatal error.\nPlease try joining again.',
  [ZoomErrorCode.UNKNOWN]:
    '⚠️ An unexpected error occurred.\nPlease try again or contact support.',
};

// ============================================================
// Application error classes
// ============================================================

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ZoomError extends AppError {
  public readonly zoomErrorCode: ZoomErrorCode;

  constructor(zoomErrorCode: ZoomErrorCode, details?: string) {
    const message = details
      ? `${ERROR_MESSAGES[zoomErrorCode]} (${details})`
      : ERROR_MESSAGES[zoomErrorCode];
    super(message, zoomErrorCode, 502);
    this.name = 'ZoomError';
    this.zoomErrorCode = zoomErrorCode;
    Object.setPrototypeOf(this, ZoomError.prototype);
  }

  /** Returns the user-facing Telegram message for this error */
  get telegramMessage(): string {
    return ERROR_MESSAGES[this.zoomErrorCode];
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
      'RATE_LIMIT',
      429,
    );
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}
