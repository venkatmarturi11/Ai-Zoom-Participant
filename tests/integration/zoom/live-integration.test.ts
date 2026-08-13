import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Opt-In Live Zoom Integration Test Suite', () => {
  const isLiveTestEnabled = process.env['RUN_LIVE_ZOOM_TESTS'] === 'true';

  it('skips live tests by default unless RUN_LIVE_ZOOM_TESTS=true', () => {
    if (!isLiveTestEnabled) {
      console.log('  ℹ️ Opt-in live Zoom tests skipped (set RUN_LIVE_ZOOM_TESTS=true to run against live credentials)');
      assert.ok(true);
      return;
    }

    assert.ok(process.env['ZOOM_CLIENT_ID'], 'ZOOM_CLIENT_ID is required for live tests');
    assert.ok(process.env['ZOOM_CLIENT_SECRET'], 'ZOOM_CLIENT_SECRET is required for live tests');
  });
});
