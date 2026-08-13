import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { connectZoomKeyboard } from '../keyboards/inline.js';

/**
 * /connect_zoom — Generate OAuth state and present Connect button
 *
 * Flow:
 *   1. Telegram user taps "Connect Zoom" button
 *   2. Opens /zoom/connect on our API server
 *   3. API creates OAuth state in DB, redirects to Zoom OAuth
 *   4. User logs into Zoom on Zoom's page (never in Telegram)
 *   5. Zoom redirects back to /zoom/callback
 *   6. API exchanges code for tokens, stores encrypted
 *   7. User sees success page + gets Telegram notification
 */
export async function connectZoomCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from!.id;

  // Build the URL to our OAuth initiation endpoint
  const apiBase = (process.env['ZOOM_REDIRECT_URI'] ?? 'http://localhost:3000/zoom/callback')
    .replace('/zoom/callback', '');
  const connectUrl = `${apiBase}/zoom/connect?telegram_user_id=${telegramUserId}`;

  await ctx.reply(messages.connectZoomPrompt, {
    parse_mode: 'HTML',
    reply_markup: connectZoomKeyboard(connectUrl),
  });
}
