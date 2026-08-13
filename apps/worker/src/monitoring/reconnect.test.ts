import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReconnectManager } from './reconnect.js';
import { WorkerStateMachine } from '../state/state-machine.js';

describe('ReconnectManager', () => {
  it('handles successful reconnection after temporary failure', async () => {
    const rm = new ReconnectManager({ maxRetries: 3, delaysMs: [10, 20, 30] });
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');

    sm.transitionTo('STARTING');
    sm.transitionTo('AUTHENTICATING');
    sm.transitionTo('INITIALIZING');
    sm.transitionTo('CONNECTING');
    sm.transitionTo('CONNECTED');

    let reconnected = false;
    const success = await rm.executeReconnect(sm, async () => {
      reconnected = true;
    });

    assert.equal(success, true);
    assert.equal(reconnected, true);
    assert.equal(sm.state, 'CONNECTED');
    assert.equal(rm.attempts, 0); // Reset on success
  });

  it('enforces maximum retry threshold', async () => {
    const rm = new ReconnectManager({ maxRetries: 2, delaysMs: [10, 10] });
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');

    sm.transitionTo('STARTING');
    sm.transitionTo('AUTHENTICATING');
    sm.transitionTo('INITIALIZING');
    sm.transitionTo('CONNECTING');
    sm.transitionTo('CONNECTED');

    // Attempt 1 (fail)
    await rm.executeReconnect(sm, async () => {
      throw new Error('Network error');
    });

    // Attempt 2 (fail)
    await rm.executeReconnect(sm, async () => {
      throw new Error('Network error');
    });

    assert.equal(rm.canRetry, false);

    // Attempt 3 (blocked)
    const success3 = await rm.executeReconnect(sm, async () => {});
    assert.equal(success3, false);
  });
});
