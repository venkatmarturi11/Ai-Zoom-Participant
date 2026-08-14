import Redis from 'ioredis';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'queue-connection' });

let redisClient: Redis | undefined;

export function getRedisConnection(): Redis {
  if (!redisClient) {
    const redisUrl = process.env['REDIS_URL']?.trim();
    if (!redisUrl) {
      log.info('REDIS_URL is not set; Redis background queue disabled');
      redisClient = new Redis({
        lazyConnect: true,
        retryStrategy: () => null, // Stop reconnecting immediately
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      });
      return redisClient;
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 5) {
          log.warn('Redis reconnection limit reached, pausing retries');
          return null;
        }
        return Math.min(times * 2000, 10000);
      },
    });

    redisClient.on('error', (err) => {
      log.warn({ error: err.message }, 'Redis connection warning');
    });

    redisClient.on('connect', () => {
      log.info('Connected to Redis');
    });
  }
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = undefined;
  }
}
