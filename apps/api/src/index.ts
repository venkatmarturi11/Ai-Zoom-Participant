import { createServer } from './server.js';
import { createBot, setupBotCommands, notificationService } from '@zoom-assistant/telegram-bot';
import { createLogger } from '@zoom-assistant/shared';

// Polyfill BigInt serialization to prevent JSON.stringify crashes across Fastify & Pino loggers
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const log = createLogger({ module: 'api-entry' });

async function startBotWithRetry(botToken: string): Promise<void> {
  try {
    log.info('Initializing Telegram bot listener in Web Service process...');
    const bot = createBot();

    await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((err: any) => {
      log.warn({ error: err?.message }, 'Failed to delete webhook (proceeding)');
    });

    await setupBotCommands(bot).catch((err: any) => {
      log.warn({ error: err?.message }, 'Failed to setup bot commands menu (proceeding)');
    });

    notificationService.start(bot);

    log.info('🤖 Starting Telegram Bot long-polling runner...');

    bot.catch(async (err) => {
      const errorMsg = err.error instanceof Error ? err.error.message : String(err.error);
      log.error({ error: errorMsg }, 'Grammy runner error caught');

      if (errorMsg.includes('409') || errorMsg.includes('Conflict')) {
        log.warn('409 Conflict detected during deploy overlap. Retrying bot listener in 10s...');
        bot.stop().catch(() => {});
        setTimeout(() => startBotWithRetry(botToken), 10000);
      }
    });

    await bot.start({
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query'],
      onStart: (info) => {
        log.info({ username: info.username }, '🤖 Telegram Bot is online and listening for messages!');
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    log.error({ error: msg }, 'Bot runner exception encountered');
    if (msg.includes('409') || msg.includes('Conflict')) {
      log.warn('409 Conflict on startup. Retrying in 10s...');
      setTimeout(() => startBotWithRetry(botToken), 10000);
    }
  }
}

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

    startBotWithRetry(botToken);
  });
}

main();
