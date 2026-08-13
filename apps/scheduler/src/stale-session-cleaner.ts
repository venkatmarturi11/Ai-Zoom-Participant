import { meetingRepo, auditRepo, getDb } from '@zoom-assistant/database';
import { createLogger, LIMITS } from '@zoom-assistant/shared';

const log = createLogger({ module: 'stale-cleaner' });

export class StaleSessionCleaner {
  private timer?: NodeJS.Timeout;

  public start(intervalMinutes: number = 15): void {
    log.info({ intervalMinutes }, 'Starting periodic StaleSessionCleaner');
    this.timer = setInterval(() => {
      this.cleanStaleSessions().catch((err) => {
        log.error({ error: err }, 'Error running StaleSessionCleaner');
      });
    }, intervalMinutes * 60 * 1000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      log.info('Stopped StaleSessionCleaner');
    }
  }

  public async cleanStaleSessions(): Promise<number> {
    const db = getDb();
    const maxDurationMs = LIMITS.MAX_SESSION_DURATION_HOURS * 60 * 60 * 1000;
    const thresholdTime = new Date(Date.now() - maxDurationMs);

    const staleMeetings = await db.meeting.findMany({
      where: {
        status: {
          in: ['STARTING', 'AUTHENTICATING', 'SDK_INITIALIZING', 'JOINING', 'WAITING_ROOM', 'CONNECTED', 'RECONNECTING'],
        },
        createdAt: {
          lt: thresholdTime,
        },
      },
    });

    if (staleMeetings.length === 0) return 0;

    log.warn({ count: staleMeetings.length }, `Found ${staleMeetings.length} stale sessions exceeding duration limit`);

    let cleaned = 0;
    for (const meeting of staleMeetings) {
      await meetingRepo.updateStatus(meeting.id, 'FAILED');
      await auditRepo.log({
        userId: meeting.userId,
        action: 'STALE_SESSION_CLEANED',
        metadata: { meetingId: meeting.id },
      });
      cleaned++;
    }

    return cleaned;
  }
}
