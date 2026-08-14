import { createServer } from './server.js';
import { createBot, setupBotCommands } from '@zoom-assistant/telegram-bot';
import { createLogger } from '@zoom-assistant/shared';

// Polyfill BigInt serialization to prevent JSON.stringify crashes across Fastify & Pino loggers
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

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

  // Launch Telegram bot long-polling in background so port healthcheck resolves instantly
  setImmediate(() => {
    const botToken = process.env['TELEGRAM_BOT_TOKEN']?.trim();
    if (!botToken) {
      log.warn('TELEGRAM_BOT_TOKEN environment variable is missing; bot polling skipped.');
      return;
    }

    async function startBotLoop() {
      try {
        log.info('Initializing background Telegram bot listener...');
        const bot = createBot();
        await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((err: any) => {
          log.warn({ error: err.message }, 'Failed to delete webhook (proceeding)');
        });
        await setupBotCommands(bot).catch((err: any) => {
          log.warn({ error: err.message }, 'Failed to setup bot commands menu (proceeding)');
        });
        await bot.start({
          drop_pending_updates: true,
          onStart: (info) => {
            log.info({ username: info.username }, '🤖 Telegram Bot is online and listening for messages!');
          },
        });
      } catch (err: any) {
        log.error({ error: err?.message || String(err) }, 'Telegram bot long-polling error, restarting in 5s...');
        setTimeout(startBotLoop, 5000);
      }
    }

    startBotLoop();
  });
}

main();
