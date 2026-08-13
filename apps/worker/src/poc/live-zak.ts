import { getZakToken, getValidAccessToken } from '@zoom-assistant/zoom';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'live-zak-poc' });

/**
 * Phase 6B: Live ZAK Verification Script
 *
 * Usage:
 *   npx tsx apps/worker/src/poc/live-zak.ts <userId>
 *
 * Tests ZAK token retrieval against Zoom's live REST API.
 * NEVER logs raw ZAK token values!
 */
export async function runLiveZakVerification(userId: string): Promise<boolean> {
  log.info({ userId }, 'Starting Stage 6B: Live ZAK Authorization Verification');

  try {
    const { accessToken, zoomUserId, zoomEmail } = await getValidAccessToken(userId);
    log.info({ userId, zoomUserId, zoomEmail }, 'Obtained valid OAuth access token');

    const zakToken = await getZakToken(zoomUserId, accessToken);

    log.info(
      {
        userId,
        zoomUserId,
        zoomEmail,
        status: 'SUCCESS',
        zakTokenLength: zakToken.length,
      },
      'ZAK token live verification SUCCESSful',
    );

    return true;
  } catch (err: any) {
    log.error({ userId, error: err.message, code: err.code }, 'ZAK live verification FAILED');
    return false;
  }
}

// CLI entry point
if (process.argv[1]?.endsWith('live-zak.ts')) {
  const targetUserId = process.argv[2];
  if (!targetUserId) {
    console.error('Usage: npx tsx apps/worker/src/poc/live-zak.ts <userId>');
    process.exit(1);
  }
  runLiveZakVerification(targetUserId).then((success) => process.exit(success ? 0 : 1));
}
