import { getRedisConnection } from './connection.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'distributed-lock' });

export interface LockOptions {
  ttlSeconds?: number;
  processId?: string;
}

export class DistributedLock {
  private readonly lockKey: string;
  private readonly processId: string;
  private readonly ttlSeconds: number;
  private autoRenewInterval?: NodeJS.Timeout;

  constructor(meetingId: string, options?: LockOptions) {
    this.lockKey = `meeting-lock:${meetingId}`;
    this.processId = options?.processId ?? `proc-${process.pid}-${Math.random().toString(36).substring(2, 8)}`;
    this.ttlSeconds = options?.ttlSeconds ?? 60; // Default 60s TTL
  }

  public get lockId(): string {
    return this.processId;
  }

  /**
   * Acquire a distributed lock via SET NX EX.
   * Returns true if lock was acquired, false if already owned by another worker.
   */
  public async acquire(): Promise<boolean> {
    const redis = getRedisConnection();
    const acquired = await redis.set(this.lockKey, this.processId, 'EX', this.ttlSeconds, 'NX');

    if (acquired === 'OK') {
      log.info({ lockKey: this.lockKey, processId: this.processId, ttl: this.ttlSeconds }, 'Acquired distributed lock');
      this.startAutoRenew();
      return true;
    }

    log.warn({ lockKey: this.lockKey, processId: this.processId }, 'Failed to acquire distributed lock (already locked)');
    return false;
  }

  /**
   * Renew the lock TTL if still owned by this process.
   */
  public async renew(): Promise<boolean> {
    const redis = getRedisConnection();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await redis.eval(script, 1, this.lockKey, this.processId, this.ttlSeconds);
    const renewed = result === 1;

    if (renewed) {
      log.debug({ lockKey: this.lockKey }, 'Renewed distributed lock');
    } else {
      log.warn({ lockKey: this.lockKey }, 'Lock renewal failed (lost lock ownership)');
      this.stopAutoRenew();
    }

    return renewed;
  }

  /**
   * Release the distributed lock safely using Lua script (only if still owned by process).
   */
  public async release(): Promise<boolean> {
    this.stopAutoRenew();
    const redis = getRedisConnection();

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await redis.eval(script, 1, this.lockKey, this.processId);
    const released = result === 1;

    log.info({ lockKey: this.lockKey, released }, 'Released distributed lock');
    return released;
  }

  private startAutoRenew(): void {
    const renewIntervalMs = (this.ttlSeconds / 2) * 1000;
    this.autoRenewInterval = setInterval(() => {
      this.renew().catch((err) => {
        log.error({ lockKey: this.lockKey, error: err }, 'Error in auto-renew');
      });
    }, renewIntervalMs);
  }

  private stopAutoRenew(): void {
    if (this.autoRenewInterval) {
      clearInterval(this.autoRenewInterval);
      this.autoRenewInterval = undefined;
    }
  }
}
