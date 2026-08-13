import { createLogger, ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

const log = createLogger({ module: 'zoom-zak' });

export interface ZakTokenResponse {
  token: string;
}

/**
 * Retrieve a Zoom Access Key (ZAK) token for a user.
 *
 * Endpoint: GET https://api.zoom.us/v2/users/{userId}/token?type=zak
 * Requires scope: user:read or user:read:admin
 *
 * ZAK represents the person/user identity.
 * Default TTL: 2 hours.
 * Recommended: Fetch ZAK ≤ 5 minutes before joining a meeting.
 */
export async function getZakToken(userId: string, accessToken: string): Promise<string> {
  const response = await fetch(`https://api.zoom.us/v2/users/${userId}/token?type=zak`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody, userId }, 'Failed to retrieve ZAK token');
    throw new ZoomError(ZoomErrorCode.ZAK_INVALID, 'Could not retrieve ZAK token');
  }

  const data = (await response.json()) as ZakTokenResponse;
  return data.token;
}
