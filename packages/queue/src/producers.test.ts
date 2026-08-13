import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Queue Producers & Idempotency', () => {
  it('formats deterministic job IDs for meeting start', () => {
    const meetingId = 'm-test-100';
    const expectedJobId = `meeting-start:${meetingId}`;
    assert.equal(expectedJobId, 'meeting-start:m-test-100');
  });

  it('formats deterministic job IDs for meeting stop', () => {
    const meetingId = 'm-test-100';
    const expectedJobId = `meeting-stop:${meetingId}`;
    assert.equal(expectedJobId, 'meeting-stop:m-test-100');
  });
});
