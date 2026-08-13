import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapability } from './capability-resolver.js';

describe('Capability Resolver', () => {
  it('resolves ZAK_PARTICIPANT for internal/host meetings', () => {
    const res = resolveCapability({
      zoomMeetingId: '123456789',
      isExternalMeeting: false,
      isHostAccount: true,
      userPresentInMeeting: false,
    });

    assert.equal(res.capability, 'ZAK_PARTICIPANT');
    assert.equal(res.requiresUserPresence, false);
  });

  it('resolves OBF_PARTICIPANT for external meetings when user is present', () => {
    const res = resolveCapability({
      zoomMeetingId: '123456789',
      isExternalMeeting: true,
      isHostAccount: false,
      userPresentInMeeting: true,
    });

    assert.equal(res.capability, 'OBF_PARTICIPANT');
    assert.equal(res.requiresUserPresence, true);
  });

  it('resolves UNSUPPORTED for external meetings when user is absent and participant requested', () => {
    const res = resolveCapability({
      zoomMeetingId: '123456789',
      isExternalMeeting: true,
      isHostAccount: false,
      userPresentInMeeting: false,
    });

    assert.equal(res.capability, 'UNSUPPORTED');
    assert.ok(res.reason.includes('requires the authorized user to be present'));
  });

  it('resolves RTMS_MEDIA when MEDIA_ONLY mode requested', () => {
    const res = resolveCapability({
      zoomMeetingId: '123456789',
      isExternalMeeting: true,
      isHostAccount: false,
      userPresentInMeeting: false,
      requestedMode: 'MEDIA_ONLY',
    });

    assert.equal(res.capability, 'RTMS_MEDIA');
    assert.equal(res.requiresUserPresence, false);
  });
});
