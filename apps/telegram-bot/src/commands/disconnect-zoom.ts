import type { BotContext } from '../bot.js';
import { messages } from '../formatters/messages.js';
import { disconnectConfirmKeyboard } from '../keyboards/inline.js';
import { userRepo, zoomAccountRepo, auditRepo } from '@zoom-assistant/database';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'disconnect-zoom' });

/**
 * /disconnect_zoom — Confirm and revoke Zoom OAuth tokens
 *
 * Steps:
 *   1. Show confirmation dialog
 *   2. On confirm: revoke token via Zoom API, delete from DB
 *   3. Cancel active workers
 *   4. Audit log the disconnection
 */
export async function disconnectZoomCommand(ctx: BotContext): Promise<void> {
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
    `⚠️ <b>Disconnect Zoom?</b>\n\nThis will remove the application's authorization for <code>${zoomAccount.zoomEmail}</code>.`,
    {
      parse_mode: 'HTML',
      reply_markup: disconnectConfirmKeyboard(),
    },
  );
}

/**
 * Handle the disconnect confirmation callback.
 * Called when user presses "Disconnect" on the confirmation keyboard.
 */
export async function handleDisconnectConfirm(ctx: BotContext): Promise<void> {
  const telegramUserId = BigInt(ctx.from!.id);

  const user = await userRepo.findByTelegramId(telegramUserId);
  if (!user) return;

  await zoomAccountRepo.revoke(user.id);

  await auditRepo.log({
    userId: user.id,
    action: 'ZOOM_DISCONNECTED',
    metadata: { telegramUserId: Number(telegramUserId) },
  });

  log.info({ userId: user.id }, 'Zoom account disconnected');

  await ctx.editMessageText(messages.zoomDisconnected, { parse_mode: 'HTML' });
}
