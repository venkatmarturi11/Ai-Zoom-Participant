import Redis from 'ioredis';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'queue-connection' });

let redisClient: Redis | undefined;

export function getRedisConnection(): Redis {
  if (!redisClient) {
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisClient.on('error', (err) => {
      log.error({ error: err.message }, 'Redis connection error');
    });

    redisClient.on('connect', () => {
      log.info('Connected to Redis');
    });
  }
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = undefined;
  }
}
