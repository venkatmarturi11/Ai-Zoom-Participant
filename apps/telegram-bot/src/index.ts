import { createLogger } from '@zoom-assistant/shared';

export { createBot, type BotContext } from './bot.js';
export { setupBotCommands } from './commands/index.js';
export { notificationService } from './services/notification-service.js';

const log = createLogger({ module: 'telegram-bot' });

/**
 * Standalone entry point — NOT USED when bot is embedded in the API server.
 * The bot long-polling runner is embedded in apps/api/src/index.ts to avoid
 * 409 Conflict errors from multiple services polling the same bot token.
 *
 * If this file is executed directly, it simply exits.
 */
async function main() {
  log.info('⚠️  Telegram bot standalone mode is DISABLED.');
  log.info('The bot is embedded in the API server (apps/api/src/index.ts).');
  log.info('This worker process will now exit. Remove the Ai-Zoom-Participant-Bot worker from Render.');

  // Keep process alive so Render doesn't restart it in a crash loop
  // But do NOT start any bot polling
  setInterval(() => {
    log.info('Bot worker idle — bot runs inside API server');
  }, 300_000); // log every 5 minutes
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
