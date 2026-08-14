import { createLogger, ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

const log = createLogger({ module: 'zoom-oauth' });

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export interface ZoomUserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  type: number;
  account_id: string;
}

/**
 * Generate Zoom Authorization Code OAuth URL.
 * Scopes required: user:read, user:read:token (for ZAK/OBF token retrieval)
 */
export function getAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL('https://zoom.us/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Exchange an OAuth authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody }, 'OAuth token exchange failed');
    throw new ZoomError(ZoomErrorCode.SDK_AUTH_FAILED, 'Failed to exchange authorization code');
  }

  return (await response.json()) as OAuthTokenResponse;
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokenResponse> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody }, 'OAuth token refresh failed');
    throw new ZoomError(ZoomErrorCode.TOKEN_REFRESH_FAILED, 'Failed to refresh access token');
  }

  return (await response.json()) as OAuthTokenResponse;
}

/**
 * Fetch the authenticated user's Zoom profile using their access token.
 */
export async function getZoomUserProfile(accessToken: string): Promise<ZoomUserProfile> {
  const response = await fetch('https://api.zoom.us/v2/users/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody }, 'Failed to fetch Zoom user profile');
    throw new ZoomError(ZoomErrorCode.OAUTH_REVOKED, 'Failed to fetch Zoom profile');
  }

  return (await response.json()) as ZoomUserProfile;
}

/**
 * Server-to-Server OAuth token retrieval (grant_type=account_credentials)
 */
export async function getServerToServerAccessToken(
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: accountId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody }, 'Server-to-Server OAuth failed');
    throw new ZoomError(ZoomErrorCode.SDK_AUTH_FAILED, 'Failed to fetch Server-to-Server OAuth token');
  }

  const data = (await response.json()) as OAuthTokenResponse;
  return data.access_token;
}
