import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingWorker } from './meeting-worker.js';

describe('MeetingWorker Lifecycle', () => {
  it('initializes in CREATED state', () => {
    const worker = new MeetingWorker({
      meetingId: 'm-test-1',
      userId: 'u-test-1',
      zoomMeetingId: '123456789',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
    });

    assert.equal(worker.meetingId, 'm-test-1');
    assert.equal(worker.state, 'CREATED');
    assert.equal(worker.isTerminal, false);
  });

  it('runs start pipeline to MONITORING state', async () => {
    const worker = new MeetingWorker({
      meetingId: 'm-test-2',
      userId: 'u-test-2',
      zoomMeetingId: '123456789',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
    });

    await worker.start();
    assert.equal(worker.state, 'MONITORING');
    assert.ok(worker.lastHeartbeat);

    await worker.stop('TEST_STOP');
    assert.equal(worker.state, 'COMPLETED');
    assert.equal(worker.isTerminal, true);
  });

  it('guarantees cleanup on stop() call', async () => {
    const worker = new MeetingWorker({
      meetingId: 'm-test-3',
      userId: 'u-test-3',
      zoomMeetingId: '123456789',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
    });

    await worker.start();
    await worker.stop('USER_REQUESTED');

    assert.equal(worker.state, 'COMPLETED');
    assert.equal(worker.isTerminal, true);
  });

  it('handles emergency cleanup on startup error', async () => {
    const worker = new MeetingWorker({
      meetingId: 'm-test-4',
      userId: 'u-test-4',
      zoomMeetingId: '123456789',
      zoomEmail: 'user@example.com',
      accessToken: 'test-token',
      isExternalMeeting: true,
      isHostAccount: false,
      userPresentInMeeting: false, // UNSUPPORTED capability branch
    });

    await assert.rejects(() => worker.start(), /Capability unsupported/);
    assert.equal(worker.state, 'FAILED');
    assert.equal(worker.isTerminal, true);
  });
});
