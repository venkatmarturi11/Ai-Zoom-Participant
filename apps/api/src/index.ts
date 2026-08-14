import { createServer } from './server.js';
import { createBot, setupBotCommands } from '@zoom-assistant/telegram-bot';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'api-entry' });

async function main() {
  const server = createServer();

  const port = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3000);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  try {
    await server.listen({ port, host });
    log.info({ port, host }, `🚀 Fastify API server listening on http://${host}:${port}`);
  } catch (err) {
    log.fatal({ error: err }, 'Failed to start API server');
    process.exit(1);
  }

  // Start Telegram Bot long-polling directly in the main Web Service process
  const botToken = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  if (botToken) {
    try {
      log.info('Initializing Telegram bot listener in Web Service process...');
      const bot = createBot();
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      await setupBotCommands(bot);
      bot.start({
        onStart: (info) => {
          log.info({ username: info.username }, '🤖 Telegram Bot is online and listening for messages!');
        },
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to start Telegram bot listener');
    }
  } else {
    log.warn('TELEGRAM_BOT_TOKEN environment variable is missing; bot polling not started.');
  }
}

main();
