import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerManager } from './worker-manager.js';

describe('WorkerManager', () => {
  it('prevents duplicate workers for the same meetingId', () => {
    const manager = WorkerManager.getInstance();

    const config = {
      meetingId: 'm-dup-1',
      userId: 'u-dup-1',
      zoomMeetingId: '123456789',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
    };

    const worker1 = manager.getOrCreateWorker(config);
    const worker2 = manager.getOrCreateWorker(config);

    assert.equal(worker1, worker2);
    assert.equal(manager.activeCount, 1);
  });

  it('stops and removes worker from memory', async () => {
    const manager = WorkerManager.getInstance();

    const config = {
      meetingId: 'm-dup-2',
      userId: 'u-dup-2',
      zoomMeetingId: '987654321',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
    };

    const worker = manager.getOrCreateWorker(config);
    await worker.start();

    const stopped = await manager.stopWorker('m-dup-2', 'TEST_REASON');
    assert.equal(stopped, true);
    assert.equal(manager.getWorker('m-dup-2'), undefined);
  });

  it('sweeps terminated workers', async () => {
    const manager = WorkerManager.getInstance();

    const config = {
      meetingId: 'm-dup-3',
      userId: 'u-dup-3',
      zoomMeetingId: '555555555',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
    };

    const worker = manager.getOrCreateWorker(config);
    await worker.start();
    await worker.stop('STOPPED');

    const swept = manager.sweepTerminated();
    assert.equal(swept >= 1, true);
  });
});
