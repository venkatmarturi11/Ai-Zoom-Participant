import type { FastifyPluginAsync } from 'fastify';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getZoomUserProfile,
} from '@zoom-assistant/zoom';
import {
  userRepo,
  zoomAccountRepo,
  oauthStateRepo,
  auditRepo,
} from '@zoom-assistant/database';
import { encryptToken } from '@zoom-assistant/crypto';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'oauth-routes' });

export const oauthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /zoom/connect?telegram_user_id=123456789
   *
   * Initiates the OAuth flow:
   *   1. Creates cryptographically random OAuth state in DB (with 10-min expiry)
   *   2. Redirects user to Zoom's authorization page
   */
  fastify.get('/zoom/connect', async (request, reply) => {
    const query = request.query as { telegram_user_id?: string };
    const telegramUserIdStr = query.telegram_user_id;

    if (!telegramUserIdStr) {
      return reply.status(400).send('Missing telegram_user_id parameter');
    }

    const telegramUserId = BigInt(telegramUserIdStr);
    const clientId = process.env['ZOOM_CLIENT_ID'] ?? '';
    const redirectUri =
      process.env['ZOOM_REDIRECT_URI'] ?? 'http://localhost:3000/zoom/callback';

    // Generate CSRF state
    const state = await oauthStateRepo.create(telegramUserId);

    const authUrl = getAuthorizationUrl(clientId, redirectUri, state);
    log.info({ telegramUserId: telegramUserIdStr }, 'Initiating Zoom OAuth redirect');

    return reply.redirect(authUrl);
  });

  /**
   * GET /zoom/callback?code=...&state=...
   *
   * Handles Zoom OAuth callback:
   *   1. Validates and consumes one-time CSRF state (prevents replay/CSRF)
   *   2. Exchanges authorization code for access + refresh tokens
   *   3. Fetches Zoom user profile (email, Zoom ID)
   *   4. Encrypts tokens with AES-256-GCM
   *   5. Stores in PostgreSQL zoom_accounts table
   *   6. Logs audit event
   *   7. Renders success page
   */
  fastify.get('/zoom/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      log.warn({ error: query.error }, 'User declined Zoom authorization');
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authorization Cancelled</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>❌ Authorization Cancelled</h2>
          <p>You declined the Zoom authorization. You can close this tab and return to Telegram.</p>
        </body>
        </html>
      `);
    }

    if (!query.code || !query.state) {
      return reply.status(400).send('Missing authorization code or state parameter');
    }

    // Verify and consume CSRF state
    const telegramUserId = await oauthStateRepo.consumeAndDelete(query.state);
    if (!telegramUserId) {
      log.warn({ state: query.state }, 'Invalid or expired OAuth state parameter');
      return reply.status(400).send('Invalid or expired state parameter. Please try again from Telegram.');
    }

    try {
      const clientId = process.env['ZOOM_CLIENT_ID'] ?? '';
      const clientSecret = process.env['ZOOM_CLIENT_SECRET'] ?? '';
      const redirectUri =
        process.env['ZOOM_REDIRECT_URI'] ?? 'http://localhost:3000/zoom/callback';
      const encryptionKey = process.env['ENCRYPTION_KEY'] ?? '';

      // Exchange code for tokens
      const tokenResp = await exchangeCodeForTokens(
        query.code,
        clientId,
        clientSecret,
        redirectUri,
      );

      // Get Zoom user profile
      const profile = await getZoomUserProfile(tokenResp.access_token);

      // Upsert user in database
      const user = await userRepo.upsert(telegramUserId);

      // Encrypt tokens
      const accessTokenEncrypted = encryptToken(tokenResp.access_token, encryptionKey);
      const refreshTokenEncrypted = encryptToken(tokenResp.refresh_token, encryptionKey);
      const tokenExpiresAt = new Date(Date.now() + tokenResp.expires_in * 1000);

      // Store tokens
      await zoomAccountRepo.storeTokens({
        userId: user.id,
        zoomUserId: profile.id,
        zoomEmail: profile.email,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt,
        scopes: tokenResp.scope,
      });

      await auditRepo.log({
        userId: user.id,
        action: 'ZOOM_OAUTH_CONNECTED',
        metadata: { zoomUserId: profile.id, email: profile.email },
      });

      log.info({ userId: user.id, zoomEmail: profile.email }, 'Zoom account successfully connected');

      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Zoom Connected!</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 40px 20px; background: #0f172a; color: #f8fafc; }
            .card { max-width: 400px; margin: 0 auto; background: #1e293b; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h2 { color: #38bdf8; margin-bottom: 10px; }
            p { color: #94a3b8; font-size: 15px; }
            .email { background: #334155; padding: 8px 16px; border-radius: 8px; font-family: monospace; color: #e2e8f0; display: inline-block; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✅ Zoom Connected!</h2>
            <p>Your Zoom account has been successfully linked:</p>
            <div class="email">${profile.email}</div>
            <p>You can close this tab and return to Telegram to manage your meetings.</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      log.error({ error: err }, 'OAuth callback handler error');
      return reply.status(500).send('Failed to complete Zoom authorization. Please try again.');
    }
  });
};
