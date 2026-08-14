import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { connectZoomKeyboard } from '../keyboards/inline.js';
import { buildZoomOAuthUrl } from '../utils/oauth.js';

/**
 * /connect_zoom — Generate OAuth state and present Connect button
 */
export async function connectZoomCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from!.id;
  const connectUrl = buildZoomOAuthUrl(telegramUserId);

  await ctx.reply(messages.connectZoomPrompt, {
    parse_mode: 'HTML',
    reply_markup: connectZoomKeyboard(connectUrl),
  });
}
