import { createBot } from './bot.js';
import { notificationService } from './services/notification-service.js';
import { createLogger } from '@zoom-assistant/shared';


const log = createLogger({ module: 'telegram-bot' });

async function main() {
  log.info('Starting Telegram Zoom Assistant bot...');

  const bot = createBot();
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

  // Start in polling mode for development
  // Production uses webhook via the API server
  if (process.env['NODE_ENV'] !== 'production') {
    log.info('Starting bot in polling mode (development)');
    bot.start({
      onStart: (info) => {
        log.info({ username: info.username }, '🤖 Bot is running');
      },
    });
  } else {
    log.info('Production mode — bot expects webhook from API server');
  }
}

main().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
