import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from './notification-service.js';

describe('NotificationService Unit Tests', () => {
  it('instantiates NotificationService successfully', () => {
    const service = new NotificationService();
    assert.ok(service);
    assert.equal(typeof service.start, 'function');
    assert.equal(typeof service.stop, 'function');
  });

  it('handles start and stop lifecycle without throwing', () => {
    const service = new NotificationService();
    const mockBot: any = { api: { sendMessage: async () => {} } };

    service.start(mockBot);
    service.stop();
    assert.ok(true);
  });
});
