import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { connectZoomKeyboard } from '../keyboards/inline.js';
import { buildZoomOAuthUrl } from '../utils/oauth.js';

/**
 * /connect_zoom — Generate OAuth URL and present Connect button
 *
 * Always offers OAuth login — the user clicks the button, logs into Zoom
 * in their browser, and the tokens are stored automatically.
 */
export async function connectZoomCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from!.id;
  const connectUrl = buildZoomOAuthUrl(telegramUserId);

  ctx.session.step = 'awaiting_zoom_login';

  await ctx.reply(messages.connectZoomPrompt, {
    parse_mode: 'HTML',
    reply_markup: connectZoomKeyboard(connectUrl),
  });
}
