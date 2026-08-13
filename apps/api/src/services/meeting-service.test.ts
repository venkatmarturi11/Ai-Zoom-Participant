import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingService } from './meeting-service.js';

describe('MeetingService Unit Tests', () => {
  it('instantiates MeetingService successfully', () => {
    const service = new MeetingService();
    assert.ok(service);
    assert.equal(typeof service.createAndQueueMeeting, 'function');
    assert.equal(typeof service.scheduleMeeting, 'function');
    assert.equal(typeof service.stopMeeting, 'function');
    assert.equal(typeof service.getMeetingStatus, 'function');
    assert.equal(typeof service.listUserMeetings, 'function');
  });

  it('rejects unauthorized user for createAndQueueMeeting', async () => {
    const service = new MeetingService();
    let thrown = false;
    try {
      await service.createAndQueueMeeting({
        telegramUserId: BigInt(9999999999),
        meetingUrl: 'https://zoom.us/j/123456789',
        meetingId: '123456789',
      });
    } catch (err: any) {
      thrown = true;
      assert.ok(err);
    }
    assert.equal(thrown, true);
  });





});
