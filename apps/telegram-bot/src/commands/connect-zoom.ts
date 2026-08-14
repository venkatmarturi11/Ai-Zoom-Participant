import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { connectZoomKeyboard } from '../keyboards/inline.js';
import { buildZoomOAuthUrl } from '../utils/oauth.js';

/**
 * /connect_zoom — Generate OAuth state and present Connect button
 */
export async function connectZoomCommand(ctx: BotContext): Promise<void> {
  const accountId = process.env['ZOOM_ACCOUNT_ID']?.trim();

  if (accountId) {
    await ctx.reply(
      `⚡ <b>Server-to-Server OAuth Active!</b>\n\nNo browser sign-in required! Server-to-Server OAuth handles meeting authorization automatically on the backend.\n\nYou can send your Zoom meeting links directly in chat or use /join to join meetings immediately.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  const telegramUserId = ctx.from!.id;
  const connectUrl = buildZoomOAuthUrl(telegramUserId);

  await ctx.reply(messages.connectZoomPrompt, {
    parse_mode: 'HTML',
    reply_markup: connectZoomKeyboard(connectUrl),
  });
}
