import { createBot } from './bot.js';
import { setupBotCommands } from './commands/index.js';
import { notificationService } from './services/notification-service.js';
import { createLogger } from '@zoom-assistant/shared';

export { createBot, type BotContext } from './bot.js';
export { setupBotCommands } from './commands/index.js';

const log = createLogger({ module: 'telegram-bot' });

async function main() {
  log.info('Starting Telegram Zoom Assistant bot...');

  const bot = createBot();

  // Clear any existing webhook so long polling receives all updates cleanly
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    log.info('Successfully cleared stale Telegram webhooks');
  } catch (err: any) {
    log.warn({ error: err.message }, 'Failed to clear webhook (proceeding to long polling)');
  }

  // Register commands popup menu in Telegram UI
  await setupBotCommands(bot);

  notificationService.start(bot);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received');
    notificationService.stop();
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.info('Starting bot long-polling runner...');
  bot.start({
    onStart: (info) => {
      log.info({ username: info.username }, '🤖 Bot is running and listening for Telegram commands');
    },
  });
}

main().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
