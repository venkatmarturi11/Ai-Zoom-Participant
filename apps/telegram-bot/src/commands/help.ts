import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';

/**
 * /help — List all available commands
 */
export async function helpCommand(ctx: BotContext): Promise<void> {
  await ctx.reply(messages.help, { parse_mode: 'HTML' });
}
