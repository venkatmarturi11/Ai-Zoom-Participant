/**
 * Build direct Zoom OAuth authorization URL for a Telegram user.
 * Generates official zoom.us/oauth/authorize URL matching reference project architecture.
 */
export function buildZoomOAuthUrl(telegramUserId: number | bigint): string {
  const clientId = (process.env['ZOOM_CLIENT_ID'] ?? 'nNZ1tk3LQMivCAP8EV7IKA').trim();
  const redirectUri = (
    process.env['ZOOM_REDIRECT_URI'] ??
    'https://ai-zoom-participant.onrender.com/auth/zoom/callback'
  ).trim();

  if (clientId) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: String(telegramUserId),
    });
    return `https://zoom.us/oauth/authorize?${params.toString()}`;
  }

  // Fallback to API endpoint
  const apiBase = redirectUri.replace(/\/auth\/zoom\/callback|\/zoom\/callback/, '');
  return `${apiBase}/auth/zoom/connect?telegram_user_id=${telegramUserId}`;
}
