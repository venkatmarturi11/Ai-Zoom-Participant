import { runServerRestartReconciliation } from './recovery.js';
import { StaleSessionCleaner } from './stale-session-cleaner.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'scheduler-app' });

export class SchedulerApp {
  private readonly staleCleaner = new StaleSessionCleaner();

  public async start(): Promise<void> {
    log.info('Starting Scheduler Application Daemon...');

    // 1. Run Server Restart Reconciliation Process on startup
    await runServerRestartReconciliation();

    // 2. Start periodic stale session cleaner
    this.staleCleaner.start(15);

    log.info('Scheduler Application Daemon is active');
  }

  public async stop(): Promise<void> {
    log.info('Stopping Scheduler Application Daemon...');
    this.staleCleaner.stop();
  }
}
