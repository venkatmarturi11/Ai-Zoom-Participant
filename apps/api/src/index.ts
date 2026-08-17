import fs from 'node:fs';
import path from 'node:path';

// Automatic zero-dependency .env loader for reliable environment initialization
(function loadEnv() {
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
      break;
    }
  }
})();

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

  const port = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 10000);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  // 1. Start HTTP Server FIRST so Render port binding and health check pass in < 1 second!
  try {
    await server.listen({ port, host });
    log.info({ port, host }, `🚀 Fastify API server listening on http://${host}:${port}`);
  } catch (err) {
    log.fatal({ error: err }, 'Failed to start API server');
    process.exit(1);
  }

  // 2. Initialize DB schema asynchronously in background
  setImmediate(async () => {
    try {
      log.info('Ensuring PostgreSQL database tables and enums are initialized...');
      await initDatabaseSchema();
      log.info('✅ PostgreSQL database schema check complete');
    } catch (err: any) {
      log.warn({ error: err?.message }, 'Database schema initialization warning (proceeding)');
    }
  });

  // 3. Launch Telegram Bot polling asynchronously in background
  setImmediate(() => {
    const botToken = process.env['TELEGRAM_BOT_TOKEN']?.trim();
    if (!botToken) {
      log.warn('TELEGRAM_BOT_TOKEN environment variable is missing; bot polling skipped.');
      return;
    }

    startBotSupervisor();
  });

  // 4. Self-ping keep-alive — Render's Free plan spins a web service down after
  // 15 minutes with no inbound HTTP traffic. Since Telegram long-polling never
  // sends *us* an HTTP request, nothing would ever wake this service back up on
  // its own. Pinging our own /health endpoint every 10 minutes keeps it alive.
  // Only runs when RENDER_EXTERNAL_URL is present (i.e. actually running on Render).
  const externalUrl = process.env['RENDER_EXTERNAL_URL'];
  if (externalUrl) {
    const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
    setInterval(() => {
      fetch(`${externalUrl}/health`).catch((err: any) => {
        log.warn({ error: err?.message }, 'Self-ping keep-alive request failed');
      });
    }, KEEP_ALIVE_INTERVAL_MS);
    log.info({ externalUrl, intervalMinutes: 10 }, '💓 Self-ping keep-alive enabled to prevent free-tier spin-down');
  }
}

main();
