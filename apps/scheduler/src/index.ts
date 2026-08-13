import { SchedulerApp } from './scheduler.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'scheduler-main' });

async function main() {
  const app = new SchedulerApp();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received in scheduler');
    await app.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.start();
}

main().catch((err) => {
  console.error('Fatal error in scheduler daemon:', err);
  process.exit(1);
});
