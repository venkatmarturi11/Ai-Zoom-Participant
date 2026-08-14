import type { NextFunction } from 'grammy';
import type { BotContext } from '../bot.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'auth-middleware' });

/**
 * Authorization middleware.
 *
 * Uses telegram_user_id (NOT username) to authorize users.
 * Usernames can change; user IDs are permanent.
 *
 * For a personal bot: whitelist via AUTHORIZED_TELEGRAM_IDS env var.
 * If set to '*' or empty: allows all users.
 */
export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    log.warn('Received update without user ID');
    return;
  }

  log.info({ userId, text: ctx.message?.text }, 'Received update from Telegram user');

  const authorizedIds = process.env['AUTHORIZED_TELEGRAM_IDS']?.trim();

  // If AUTHORIZED_TELEGRAM_IDS is empty or set to '*', allow all users
  if (!authorizedIds || authorizedIds === '*') {
    await next();
    return;
  }

  const allowedIds = authorizedIds
    .split(/[\s,]+/)
    .map((id) => id.replace(/[^\d*]/g, '').trim())
    .filter(Boolean);

  if (!allowedIds.includes('*') && !allowedIds.includes(String(userId))) {
    log.warn({ telegramUserId: userId, allowedIds }, 'Unauthorized access attempt');
    await ctx.reply(`⛔ Unauthorized access.\n\nYour Telegram User ID is: <code>${userId}</code>\n\nPlease add this ID to <code>AUTHORIZED_TELEGRAM_IDS</code> in your environment settings.`, {
      parse_mode: 'HTML',
    });
    return;
  }

  await next();
}
