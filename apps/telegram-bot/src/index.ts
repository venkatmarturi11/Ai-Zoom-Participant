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

// Only auto-start main() when run directly as CLI script
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  main().catch((err) => {
    console.error('Fatal error starting bot:', err);
    process.exit(1);
  });
}
