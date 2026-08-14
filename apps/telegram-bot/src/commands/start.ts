import type { BotContext } from '../bot.js';

/**
 * /start — Welcome message for Telegram Zoom Assistant
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  const userName = ctx.from?.first_name || ctx.from?.username || 'User';

  await ctx.reply(
    `👋 <b>Welcome, ${userName}!</b>\n\n` +
    `⚡ <b>Zoom Integration is Active!</b>\n` +
    `No browser login or Zoom Marketplace sign-in required. Everything is configured automatically.\n\n` +
    `📌 <b>How to join a meeting:</b>\n` +
    `1. Send or paste any Zoom meeting link directly in this chat:\n` +
    `   <code>https://zoom.us/j/1234567890?pwd=xxxx</code>\n` +
    `2. Or use <code>/join &lt;meeting_id&gt; &lt;passcode&gt;</code>\n\n` +
    `💡 Send <code>/help</code> anytime to see all available commands.`,
    { parse_mode: 'HTML' },
  );
}
