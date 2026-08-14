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

  // Start Telegram Bot listener on the API server to guarantee instant Telegram responsiveness
  if (process.env['TELEGRAM_BOT_TOKEN']) {
    try {
      log.info('Initializing inline Telegram bot listener on API server...');
      const bot = createBot();
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      await setupBotCommands(bot);
      bot.start({
        onStart: (info) => {
          log.info({ username: info.username }, '🤖 Telegram Bot runner is live and responding to commands!');
        },
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to start inline Telegram bot on API server');
    }
  }
}

main();
