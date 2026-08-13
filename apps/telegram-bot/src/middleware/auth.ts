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
 * For a multi-user SaaS: check against the users database table.
 */
export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    log.warn('Received update without user ID');
    return;
  }

  const authorizedIds = process.env['AUTHORIZED_TELEGRAM_IDS'];
  if (!authorizedIds) {
    log.fatal('AUTHORIZED_TELEGRAM_IDS is not configured');
    await ctx.reply('⚠️ Bot is not configured. Contact the administrator.');
    return;
  }

  const allowedIds = authorizedIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!allowedIds.includes(String(userId))) {
    log.warn({ telegramUserId: userId }, 'Unauthorized access attempt');
    await ctx.reply('⛔ Unauthorized.');
    return;
  }

  await next();
}
