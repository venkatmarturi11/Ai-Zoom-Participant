import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { accountKeyboard } from '../keyboards/inline.js';
import { userRepo, zoomAccountRepo } from '@zoom-assistant/database';

/**
 * /account — Show connected Zoom account info
 */
export async function accountCommand(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) {
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
  }

  const zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id);
  if (!zoomAccount) {
    await ctx.reply(messages.noZoomAccount, { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply(
    messages.accountInfo(zoomAccount.zoomEmail, zoomAccount.status),
    {
      parse_mode: 'HTML',
      reply_markup: accountKeyboard(),
    },
  );
}
