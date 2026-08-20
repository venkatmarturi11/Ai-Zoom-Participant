import type { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';
import { isValidTelegramButtonUrl } from '../keyboards/inline.js';

export async function loginCommand(ctx: BotContext): Promise<void> {
  const hostUrl =
    process.env['API_PUBLIC_URL'] ||
    process.env['RENDER_EXTERNAL_URL'] ||
    'http://localhost:3000';

  const adminKey = process.env['ADMIN_API_KEY']?.trim();
  const liveMonitorUrl = adminKey ? `${hostUrl}/?key=${encodeURIComponent(adminKey)}` : `${hostUrl}/`;
  const zoomLoginUrl = 'https://zoom.us/signin';

  const text = [
    '🔐 *Permanent Zoom Account Login*',
    '',
    'Log in once, and the bot will stay authenticated *forever* across all future meetings\\!',
    '',
    '📌 *How to log in:*',
    '1\\. Click the button below to open the *Live Browser Screen*\\.',
    '2\\. Sign into your Zoom account \\(via Email, Google, Apple, or SSO\\)\\.',
    '3\\. Once logged in, your session is saved permanently to the bot\\.',
    '',
    '✨ *Benefit:* Zoom will *never* ask you to fill registration forms or verify again\\!',
  ].join('\n');

  const keyboard = new InlineKeyboard();
  if (isValidTelegramButtonUrl(liveMonitorUrl)) {
    keyboard.url('🖥️ Open Live Screen to Login', liveMonitorUrl).row();
  }
  keyboard.url('🔗 Zoom Sign-In Page', zoomLoginUrl);

  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard,
  });
}
