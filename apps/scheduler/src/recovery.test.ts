import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runServerRestartReconciliation } from './recovery.js';

describe('Server Restart Reconciliation Process', () => {
  it('executes reconciliation process without throwing', async () => {
    // Under test environment without database, reconciliation reports 0 records gracefully
    const report = await runServerRestartReconciliation();

    assert.equal(typeof report.requeuedScheduled, 'number');
    assert.equal(typeof report.recoveredInterrupted, 'number');
    assert.equal(typeof report.cleanedStale, 'number');
    assert.equal(typeof report.errors, 'number');
  });
});
