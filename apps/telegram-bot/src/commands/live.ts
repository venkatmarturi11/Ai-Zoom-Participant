import type { BotContext } from '../bot.js';
import { liveControlKeyboard } from '../keyboards/inline.js';

/**
 * /live or /monitor — Directly sends the Live Screen & Help Center link to the user
 */
export async function liveCommand(ctx: BotContext): Promise<void> {
  const liveMonitorUrl =
    process.env['RENDER_EXTERNAL_URL'] || `http://localhost:${process.env['API_PORT'] || 3000}`;

  await ctx.reply(
    `🖥️ <b>Bot Live Screen & Help Center</b>\n\n` +
    `Use this link to watch the bot's live screen in real time and assist with CAPTCHA, "Stay signed in", or login prompts:\n\n` +
    `👉 <a href="${liveMonitorUrl}"><b>${liveMonitorUrl}</b></a>\n\n` +
    `💡 <i>Tap the button below on your phone or PC to open the live interactive view!</i>`,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: liveControlKeyboard(liveMonitorUrl),
    },
  );
}
