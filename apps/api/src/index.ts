import { createServer } from './server.js';
import { createBot, setupBotCommands, notificationService } from '@zoom-assistant/telegram-bot';
import { createLogger } from '@zoom-assistant/shared';

// Polyfill BigInt serialization to prevent JSON.stringify crashes across Fastify & Pino loggers
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const log = createLogger({ module: 'api-entry' });

async function startBotSupervisor(): Promise<void> {
  const bot = createBot();

  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((err: any) => {
    log.warn({ error: err?.message }, 'Failed to delete webhook (proceeding)');
  });

  await setupBotCommands(bot).catch((err: any) => {
    log.warn({ error: err?.message }, 'Failed to setup bot commands menu (proceeding)');
  });

  notificationService.start(bot);

  bot.catch(async (err) => {
    const errorMsg = err.error instanceof Error ? err.error.message : String(err.error);
    log.error({ error: errorMsg }, 'Grammy bot error caught');
  });

  log.info('🤖 Launching Telegram Bot supervisor loop...');

  while (true) {
    try {
      await bot.start({
        drop_pending_updates: false,
        onStart: (info) => {
          log.info({ username: info.username }, '🤖 Telegram Bot is online and listening for messages!');
        },
      });
      log.warn('Bot polling cycle ended. Restarting in 5s...');
    } catch (err: any) {
      const msg = err?.message || String(err);
      log.error({ error: msg }, 'Bot runner exception encountered, restarting in 5s...');
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
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

    startBotSupervisor();
  });
}

main();
