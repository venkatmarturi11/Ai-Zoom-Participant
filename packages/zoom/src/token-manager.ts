import { zoomAccountRepo } from '@zoom-assistant/database';
import { decryptToken, encryptToken } from '@zoom-assistant/crypto';
import { refreshAccessToken } from './oauth.js';
import { createLogger, ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

const log = createLogger({ module: 'token-manager' });

export interface ValidatedTokens {
  accessToken: string;
  zoomUserId: string;
  zoomEmail: string;
}

/**
 * Get valid access token for a user.
 * Decrypts stored token, checks expiration, refreshes automatically if expired.
 */
export async function getValidAccessToken(userId: string): Promise<ValidatedTokens> {
  const account = await zoomAccountRepo.findActiveByUserId(userId);
  if (!account) {
    throw new ZoomError(ZoomErrorCode.USER_NOT_AUTHORIZED, 'No active Zoom account found');
  }

  const encryptionKey = process.env['ENCRYPTION_KEY'] ?? '';
  let accessToken = decryptToken(account.accessTokenEncrypted, encryptionKey);
  const refreshToken = decryptToken(account.refreshTokenEncrypted, encryptionKey);

  // Check if token is expired or expires in < 5 minutes
  const bufferMs = 5 * 60 * 1000;
  const isExpiringSoon = account.tokenExpiresAt.getTime() - Date.now() < bufferMs;

  if (isExpiringSoon) {
    log.info({ userId, zoomEmail: account.zoomEmail }, 'Access token expiring soon; refreshing');

    try {
      const clientId = process.env['ZOOM_CLIENT_ID'] ?? '';
      const clientSecret = process.env['ZOOM_CLIENT_SECRET'] ?? '';

      const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret);

      accessToken = refreshed.access_token;
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

      const newEncryptedAccess = encryptToken(refreshed.access_token, encryptionKey);
      const newEncryptedRefresh = encryptToken(refreshed.refresh_token, encryptionKey);

      await zoomAccountRepo.updateTokens(
        account.id,
        newEncryptedAccess,
        newEncryptedRefresh,
        newExpiresAt,
      );

      log.info({ userId }, 'Access token refreshed and saved');
    } catch (err) {
      log.error({ userId, error: err }, 'Token refresh failed');
      await zoomAccountRepo.updateStatus(account.id, 'REFRESH_FAILED');
      throw new ZoomError(ZoomErrorCode.TOKEN_REFRESH_FAILED, 'Failed to refresh Zoom token');
    }
  }

  return {
    accessToken,
    zoomUserId: account.zoomUserId,
    zoomEmail: account.zoomEmail,
  };
}
