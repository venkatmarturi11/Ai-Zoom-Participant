import { createServer } from './server.js';
import { createBot, setupBotCommands, notificationService } from '@zoom-assistant/telegram-bot';
import { initDatabaseSchema } from '@zoom-assistant/database';
import { createLogger } from '@zoom-assistant/shared';

// Polyfill BigInt serialization to prevent JSON.stringify crashes across Fastify & Pino loggers
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const log = createLogger({ module: 'api-entry' });

async function startBotSupervisor(): Promise<void> {
  log.info('🤖 Launching Telegram Bot supervisor loop...');

  while (true) {
    let bot;
    try {
      bot = createBot();

      await bot.api.deleteWebhook({ drop_pending_updates: false }).catch((err: any) => {
        log.warn({ error: err?.message }, 'Failed to delete webhook (proceeding)');
      });

      await setupBotCommands(bot).catch((err: any) => {
        log.warn({ error: err?.message }, 'Failed to setup bot commands menu (proceeding)');
      });

      notificationService.start(bot);

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
      if (bot) {
        try {
          bot.stop();
        } catch {
          // ignore
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main() {
  const server = createServer();

  const port = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3000);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  // Initialize PostgreSQL database schema / tables if not present
  try {
    log.info('Ensuring PostgreSQL database tables and enums are initialized...');
    await initDatabaseSchema();
    log.info('✅ PostgreSQL database schema check complete');
  } catch (err: any) {
    log.warn({ error: err?.message }, 'Database schema initialization warning (proceeding)');
  }

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
