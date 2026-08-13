import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerStateMachine } from './state-machine.js';

describe('Worker State Machine', () => {
  it('starts in CREATED state', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');
    assert.equal(sm.state, 'CREATED');
    assert.equal(sm.isTerminal, false);
    assert.deepEqual(sm.stateHistory, ['CREATED']);
  });

  it('permits valid state transitions sequence', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');

    sm.transitionTo('STARTING');
    assert.equal(sm.state, 'STARTING');

    sm.transitionTo('AUTHENTICATING');
    assert.equal(sm.state, 'AUTHENTICATING');

    sm.transitionTo('INITIALIZING');
    assert.equal(sm.state, 'INITIALIZING');

    sm.transitionTo('CONNECTING');
    assert.equal(sm.state, 'CONNECTING');

    sm.transitionTo('CONNECTED');
    assert.equal(sm.state, 'CONNECTED');

    sm.transitionTo('MONITORING');
    assert.equal(sm.state, 'MONITORING');

    sm.transitionTo('STOPPING');
    assert.equal(sm.state, 'STOPPING');

    sm.transitionTo('CLEANING_UP');
    assert.equal(sm.state, 'CLEANING_UP');

    sm.transitionTo('COMPLETED');
    assert.equal(sm.state, 'COMPLETED');
    assert.equal(sm.isTerminal, true);
  });

  it('permits reconnection flow: CONNECTED -> RECONNECTING -> CONNECTED', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');
    sm.transitionTo('STARTING');
    sm.transitionTo('AUTHENTICATING');
    sm.transitionTo('INITIALIZING');
    sm.transitionTo('CONNECTING');
    sm.transitionTo('CONNECTED');

    sm.transitionTo('RECONNECTING');
    assert.equal(sm.state, 'RECONNECTING');

    sm.transitionTo('CONNECTED');
    assert.equal(sm.state, 'CONNECTED');
  });

  it('rejects invalid transitions (e.g. CREATED -> COMPLETED directly)', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');
    assert.throws(() => sm.transitionTo('COMPLETED'), /Invalid state transition/);
  });

  it('ignores duplicate transitions', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');
    sm.transitionTo('STARTING');
    sm.transitionTo('STARTING'); // Duplicate
    assert.equal(sm.state, 'STARTING');
    assert.deepEqual(sm.stateHistory, ['CREATED', 'STARTING']);
  });

  it('enforces terminal state protection (no transition after COMPLETED or FAILED)', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');
    sm.transitionTo('STARTING');
    sm.transitionTo('AUTHENTICATING');
    sm.transitionTo('INITIALIZING');
    sm.transitionTo('CONNECTING');
    sm.transitionTo('CONNECTED');
    sm.transitionTo('MONITORING');
    sm.transitionTo('STOPPING');
    sm.transitionTo('CLEANING_UP');
    sm.transitionTo('COMPLETED');

    assert.throws(() => sm.transitionTo('CONNECTED'), /Cannot transition from terminal state/);
  });

  it('allows transition to CLEANING_UP and FAILED on error', () => {
    const sm = new WorkerStateMachine('m1', 'u1', '123456789');
    sm.transitionTo('STARTING');
    sm.transitionTo('AUTHENTICATING');
    sm.transitionTo('CLEANING_UP');
    sm.transitionTo('FAILED');

    assert.equal(sm.state, 'FAILED');
    assert.equal(sm.isTerminal, true);
  });
});
