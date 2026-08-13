import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DistributedLock } from './locks.js';

describe('DistributedLock (Mocked Mode)', () => {
  it('generates unique process ID for each instance', () => {
    const lock1 = new DistributedLock('m-lock-1');
    const lock2 = new DistributedLock('m-lock-1');

    assert.notEqual(lock1.lockId, lock2.lockId);
  });

  it('uses custom processId if provided', () => {
    const lock = new DistributedLock('m-lock-2', { processId: 'custom-worker-id' });
    assert.equal(lock.lockId, 'custom-worker-id');
  });
});
