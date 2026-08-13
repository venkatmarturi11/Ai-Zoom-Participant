import { MeetingWorker } from './meeting-worker.js';
import type { MeetingWorkerConfig } from './worker-context.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'worker-manager' });

/**
 * Singleton WorkerManager maintaining isolated in-memory MeetingWorker instances.
 * Prevents duplicate workers for the same meetingId.
 */
export class WorkerManager {
  private static instance?: WorkerManager;
  private readonly workers = new Map<string, MeetingWorker>();

  private constructor() {}

  public static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  /**
   * Create or return an existing worker for the given config.
   * If a worker for meetingId already exists and is non-terminal, returns the existing worker.
   */
  public getOrCreateWorker(config: MeetingWorkerConfig): MeetingWorker {
    const existing = this.workers.get(config.meetingId);

    if (existing && !existing.isTerminal) {
      log.info({ meetingId: config.meetingId }, 'Existing active worker returned (duplicate prevention)');
      return existing;
    }

    const worker = new MeetingWorker(config);
    this.workers.set(config.meetingId, worker);
    log.info({ meetingId: config.meetingId }, 'Created new MeetingWorker instance');
    return worker;
  }

  public getWorker(meetingId: string): MeetingWorker | undefined {
    return this.workers.get(meetingId);
  }

  public async stopWorker(meetingId: string, reason: string = 'MANAGER_STOP'): Promise<boolean> {
    const worker = this.workers.get(meetingId);
    if (!worker) return false;

    await worker.stop(reason);
    this.workers.delete(meetingId);
    log.info({ meetingId, reason }, 'Stopped and removed worker from WorkerManager');
    return true;
  }

  public async stopAllWorkers(reason: string = 'SHUTDOWN'): Promise<void> {
    log.info({ count: this.workers.size, reason }, 'Stopping all active workers');
    const stopPromises = Array.from(this.workers.values()).map((worker) =>
      worker.stop(reason).catch((err) => {
        log.error({ meetingId: worker.meetingId, error: err }, 'Error stopping worker during stopAll');
      }),
    );
    await Promise.all(stopPromises);
    this.workers.clear();
  }

  public get activeCount(): number {
    return Array.from(this.workers.values()).filter((w) => !w.isTerminal).length;
  }

  public listActiveMeetingIds(): string[] {
    return Array.from(this.workers.values())
      .filter((w) => !w.isTerminal)
      .map((w) => w.meetingId);
  }

  /** Clear all terminated workers from memory */
  public sweepTerminated(): number {
    let count = 0;
    for (const [meetingId, worker] of this.workers.entries()) {
      if (worker.isTerminal) {
        this.workers.delete(meetingId);
        count++;
      }
    }
    return count;
  }
}
