import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { connectZoomKeyboard } from '../keyboards/inline.js';
import { buildZoomOAuthUrl } from '../utils/oauth.js';

/**
 * /start — Welcome message with Connect Zoom button
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  const oauthUrl = buildZoomOAuthUrl(ctx.from!.id);

  await ctx.reply(messages.welcome, {
    parse_mode: 'HTML',
    reply_markup: connectZoomKeyboard(oauthUrl),
  });
}
