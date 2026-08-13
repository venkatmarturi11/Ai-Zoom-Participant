import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { connectZoomKeyboard } from '../keyboards/inline.js';

/**
 * /start — Welcome message with Connect Zoom button
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  const oauthUrl = buildOAuthUrl(ctx.from!.id);

  await ctx.reply(messages.welcome, {
    parse_mode: 'HTML',
    reply_markup: connectZoomKeyboard(oauthUrl),
  });
}

function buildOAuthUrl(telegramUserId: number): string {
  const baseUrl = process.env['ZOOM_REDIRECT_URI'] ?? 'http://localhost:3000/zoom/callback';
  const apiBase = baseUrl.replace('/zoom/callback', '/zoom/connect');
  return `${apiBase}?telegram_user_id=${telegramUserId}`;
}
