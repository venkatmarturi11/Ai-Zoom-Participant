import pino from 'pino';

/**
 * Structured JSON logger with automatic redaction of sensitive values.
 * Never logs: access_token, refresh_token, ZAK, OBF, passwords, encryption keys.
 */
export const logger = pino({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'accessToken',
      'refreshToken',
      'access_token',
      'refresh_token',
      'accessTokenEncrypted',
      'refreshTokenEncrypted',
      'access_token_encrypted',
      'refresh_token_encrypted',
      'zak',
      'zakToken',
      'obf',
      'obfToken',
      'password',
      'passcode',
      'pwd',
      'encryptionKey',
      'clientSecret',
      'client_secret',
      'ZOOM_CLIENT_SECRET',
      'ZOOM_SDK_SECRET',
      'ENCRYPTION_KEY',
      'TELEGRAM_BOT_TOKEN',
      'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env['NODE_ENV'] !== 'production' &&
    process.env['NODE_ENV'] !== 'test' &&
    !process.env['VITEST']
      ? undefined // Standard stdout logging for reliability across environments
      : undefined,

});

/**
 * Create a child logger with bound context fields.
 * Usage: createLogger({ module: 'oauth', userId: '...' })
 */
export function createLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
