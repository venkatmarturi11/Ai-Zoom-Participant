import { LIMITS, createLogger } from '@zoom-assistant/shared';
import type { MeetingWorker } from '../meeting-worker.js';

const log = createLogger({ module: 'watchdog' });

export class Watchdog {
  private timer?: NodeJS.Timeout;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = LIMITS.HEARTBEAT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  public start(workersProvider: () => Iterable<MeetingWorker>): void {
    log.info({ timeoutMs: this.timeoutMs }, 'Starting Watchdog monitoring loop');
    this.timer = setInterval(() => {
      this.checkWorkers(workersProvider());
    }, 30_000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      log.info('Watchdog monitoring loop stopped');
    }
  }

  public checkWorkers(workers: Iterable<MeetingWorker>): void {
    const now = Date.now();

    for (const worker of workers) {
      if (worker.isTerminal) continue;

      const lastHeartbeat = worker.lastHeartbeat?.getTime();
      if (lastHeartbeat && now - lastHeartbeat > this.timeoutMs) {
        log.warn(
          { meetingId: worker.meetingId, lastHeartbeat: new Date(lastHeartbeat).toISOString() },
          'Worker heartbeat timed out; triggering emergency cleanup',
        );

        worker.performCleanup('HEARTBEAT_TIMEOUT', 'Worker failed to send heartbeat within threshold').catch((err) => {
          log.error({ meetingId: worker.meetingId, error: err }, 'Error in watchdog cleanup trigger');
        });
      }
    }
  }
}
