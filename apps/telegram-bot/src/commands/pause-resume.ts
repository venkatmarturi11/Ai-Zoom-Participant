import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';

/**
 * /pause — Stop receiving bot notifications
 */
export async function pauseCommand(ctx: BotContext): Promise<void> {
  ctx.session.step = 'idle';
  await ctx.reply(messages.pause, { parse_mode: 'HTML' });
}

/**
 * /resume — Resume bot notifications
 */
export async function resumeCommand(ctx: BotContext): Promise<void> {
  ctx.session.step = 'idle';
  await ctx.reply(messages.resume, { parse_mode: 'HTML' });
}
