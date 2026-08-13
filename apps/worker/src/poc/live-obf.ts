import { getObfToken, getValidAccessToken } from '@zoom-assistant/zoom';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'live-obf-poc' });

/**
 * Phase 6C: Live OBF Verification Script
 *
 * Usage:
 *   npx tsx apps/worker/src/poc/live-obf.ts <userId>
 *
 * Tests OBF token retrieval against Zoom's live REST API.
 * NEVER logs raw OBF token values!
 */
export async function runLiveObfVerification(userId: string): Promise<boolean> {
  log.info({ userId }, 'Starting Stage 6C: Live OBF Authorization Verification');

  try {
    const { accessToken, zoomUserId, zoomEmail } = await getValidAccessToken(userId);
    log.info({ userId, zoomUserId, zoomEmail }, 'Obtained valid OAuth access token');

    const obfToken = await getObfToken(zoomUserId, accessToken);

    log.info(
      {
        userId,
        zoomUserId,
        zoomEmail,
        status: 'SUCCESS',
        obfTokenLength: obfToken.length,
        constraintNotice: 'OBF external meetings require authorized user to be present in meeting',
      },
      'OBF token live verification SUCCESSful',
    );

    return true;
  } catch (err: any) {
    log.error({ userId, error: err.message, code: err.code }, 'OBF live verification FAILED');
    return false;
  }
}

// CLI entry point
if (process.argv[1]?.endsWith('live-obf.ts')) {
  const targetUserId = process.argv[2];
  if (!targetUserId) {
    console.error('Usage: npx tsx apps/worker/src/poc/live-obf.ts <userId>');
    process.exit(1);
  }
  runLiveObfVerification(targetUserId).then((success) => process.exit(success ? 0 : 1));
}
