import { createLogger, ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

const log = createLogger({ module: 'zoom-obf' });

export interface ObfTokenResponse {
  token: string;
}

/**
 * Retrieve an On Behalf Of (OBF) token for an app participant.
 *
 * Endpoint: GET https://api.zoom.us/v2/users/{userId}/token?type=onbehalf
 * Requires scope: user:read:token
 *
 * OBF represents an application associated with an authorized user.
 * Note for external meetings: The authorized user must already be present in the meeting.
 */
export async function getObfToken(userId: string, accessToken: string): Promise<string> {
  const response = await fetch(`https://api.zoom.us/v2/users/${userId}/token?type=onbehalf`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody, userId }, 'Failed to retrieve OBF token');
    throw new ZoomError(ZoomErrorCode.OBF_INVALID, 'Could not retrieve OBF token');
  }

  const data = (await response.json()) as ObfTokenResponse;
  return data.token;
}
