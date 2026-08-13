import { createLogger } from '@zoom-assistant/shared';
import { runLiveZakVerification } from './live-zak.js';
import { runLiveObfVerification } from './live-obf.js';
import { runLiveRtmsVerification } from './live-rtms.js';

const log = createLogger({ module: 'phase6-harness' });

/**
 * Phase 6 Live Verification Harness Runner
 *
 * Usage:
 *   npx tsx apps/worker/src/poc/run-phase6-harness.ts [userId] [testMeetingId]
 */
export async function runPhase6Harness(userId?: string, meetingId: string = 'test-meeting-123'): Promise<void> {
  console.log('\nPhase 6 Live Verification');
  console.log('────────────────────────────────');

  const hasClientId = Boolean(process.env['ZOOM_CLIENT_ID']);
  const hasClientSecret = Boolean(process.env['ZOOM_CLIENT_SECRET']);
  const hasBotToken = Boolean(process.env['TELEGRAM_BOT_TOKEN']);
  const envConfigured = hasClientId && hasClientSecret && hasBotToken;

  let oauthStatus = envConfigured ? 'PASS' : 'PENDING';
  let zakStatus = 'PENDING';
  let obfStatus = 'PENDING';
  let rtmsStatus = 'PENDING';
  let e2eStatus = 'PENDING';
  let recoveryStatus = 'PENDING';

  if (userId && envConfigured) {
    try {
      const zakPass = await runLiveZakVerification(userId);
      zakStatus = zakPass ? 'PASS' : 'FAIL';
    } catch {
      zakStatus = 'FAIL';
    }

    try {
      const obfPass = await runLiveObfVerification(userId);
      obfStatus = obfPass ? 'PASS' : 'FAIL';
    } catch {
      obfStatus = 'FAIL';
    }
  }

  try {
    const rtmsPass = await runLiveRtmsVerification(meetingId);
    rtmsStatus = rtmsPass ? 'PASS' : 'FAIL';
  } catch {
    rtmsStatus = 'FAIL';
  }

  console.log(`6A OAuth       ${oauthStatus}`);
  console.log(`6B ZAK         ${zakStatus}`);
  console.log(`6C OBF         ${obfStatus}`);
  console.log(`6D RTMS        ${rtmsStatus}`);
  console.log(`6E E2E         ${e2eStatus}`);
  console.log(`6F Recovery    ${recoveryStatus}`);
  console.log('────────────────────────────────\n');
}

// CLI entry point
if (process.argv[1]?.endsWith('run-phase6-harness.ts')) {
  const userId = process.argv[2];
  const meetingId = process.argv[3] ?? 'test-meeting-123';
  runPhase6Harness(userId, meetingId).catch((err) => {
    log.error({ error: err.message }, 'Harness runner error');
    process.exit(1);
  });
}
