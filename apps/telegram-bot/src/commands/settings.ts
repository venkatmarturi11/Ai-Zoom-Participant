import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';

/**
 * /settings — View bot configuration and preferences
 */
export async function settingsCommand(ctx: BotContext): Promise<void> {
  const displayName = process.env['DEFAULT_DISPLAY_NAME'] ?? 'Meeting Assistant';
  const timezone = process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata';

  await ctx.reply(messages.settings(displayName, timezone), {
    parse_mode: 'HTML',
  });
}
