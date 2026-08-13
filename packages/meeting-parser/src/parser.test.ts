import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetingUrl, isValidMeetingId, extractZoomUrl } from '../src/parser.js';

describe('Meeting Parser', () => {
  describe('parseMeetingUrl', () => {
    it('parses standard Zoom URL with passcode', () => {
      const url = 'https://us06web.zoom.us/j/123456789?pwd=XXXXXXXX';
      const result = parseMeetingUrl(url);

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.meeting.meetingId, '123456789');
        assert.equal(result.meeting.passcode, 'XXXXXXXX');
        assert.equal(result.meeting.domain, 'us06web.zoom.us');
        assert.equal(result.meeting.isVanityUrl, false);
      }
    });

    it('parses Zoom URL without passcode', () => {
      const url = 'https://zoom.us/j/987654321';
      const result = parseMeetingUrl(url);

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.meeting.meetingId, '987654321');
        assert.equal(result.meeting.passcode, null);
      }
    });

    it('parses vanity URL', () => {
      const url = 'https://zoom.us/my/testmeeting';
      const result = parseMeetingUrl(url);

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.meeting.meetingId, 'testmeeting');
        assert.equal(result.meeting.isVanityUrl, true);
      }
    });

    it('rejects non-HTTPS schemes', () => {
      const url = 'http://zoom.us/j/123456789';
      const result = parseMeetingUrl(url);

      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('HTTPS'));
      }
    });

    it('rejects non-Zoom domains', () => {
      const url = 'https://malicious.com/j/123456789';
      const result = parseMeetingUrl(url);

      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('zoom.us'));
      }
    });

    it('rejects dangerous schemes', () => {
      const result = parseMeetingUrl('javascript:alert(1)');
      assert.equal(result.success, false);
    });
  });

  describe('isValidMeetingId', () => {
    it('validates 9-digit meeting ID', () => {
      assert.equal(isValidMeetingId('123456789'), true);
    });

    it('validates 11-digit meeting ID', () => {
      assert.equal(isValidMeetingId('12345678901'), true);
    });

    it('rejects invalid meeting ID', () => {
      assert.equal(isValidMeetingId('12345'), false);
      assert.equal(isValidMeetingId('abc'), false);
    });
  });

  describe('extractZoomUrl', () => {
    it('extracts Zoom URL from invitation text block', () => {
      const text = `Join my Zoom Meeting\nhttps://us06web.zoom.us/j/123456789?pwd=abc\nMeeting ID: 123 456 789`;
      const url = extractZoomUrl(text);
      assert.equal(url, 'https://us06web.zoom.us/j/123456789?pwd=abc');
    });
  });
});

