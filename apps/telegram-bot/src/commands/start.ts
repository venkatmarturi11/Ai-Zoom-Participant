import type { BotContext } from '../bot.js';
import { userRepo, zoomAccountRepo } from '@zoom-assistant/database';
import { connectZoomKeyboard } from '../keyboards/inline.js';
import { buildZoomOAuthUrl } from '../utils/oauth.js';

/**
 * /start — Welcome message & guided flow
 *
 * Flow:
 * 1. Welcome the user
 * 2. Check if Zoom account is connected
 *    - If not → prompt to connect via OAuth (login page)
 *    - If yes → prompt to send a Zoom meeting invite link
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  const userName = ctx.from?.first_name || ctx.from?.username || 'User';
  const telegramUserId = BigInt(ctx.from!.id);

  // Store display name for later use
  ctx.session.pendingDisplayName =
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ||
    ctx.from?.username ||
    'Meeting Assistant';

  // Check if user already has a connected Zoom account
  let hasZoomAccount = false;
  try {
    let user = await userRepo.findByTelegramId(telegramUserId).catch(() => null);
    if (!user) {
      user = await userRepo.upsert(telegramUserId, ctx.from?.username).catch(() => null);
    }
    if (user) {
      const zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id).catch(() => null);
      hasZoomAccount = Boolean(zoomAccount);
    }
  } catch {
    // Continue without DB check
  }

  if (hasZoomAccount) {
    // Already connected — skip to asking for meeting link
    ctx.session.step = 'awaiting_meeting_link';
    await ctx.reply(
      `👋 <b>Welcome back, ${userName}!</b>\n\n` +
      `✅ Your Zoom account is connected.\n\n` +
      `📹 <b>Send me a Zoom meeting invite link</b> and I'll join the meeting, record it, and save the recording for you.\n\n` +
      `<i>Example:</i>\n` +
      `<code>https://zoom.us/j/1234567890?pwd=xxxx</code>\n\n` +
      `💡 Commands:\n` +
      `• <b>Paste a Zoom link</b> — Bot joins & records\n` +
      `• <code>/stop</code> — Stop recording & get download link\n` +
      `• <code>/status</code> — Check recording status\n` +
      `• <code>/help</code> — All commands`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  // Not connected — prompt Zoom login
  ctx.session.step = 'awaiting_zoom_login';
  const connectUrl = buildZoomOAuthUrl(ctx.from!.id);

  await ctx.reply(
    `👋 <b>Welcome, ${userName}!</b>\n\n` +
    `🤖 I'm your <b>Zoom Meeting Recorder Bot</b>.\n\n` +
    `<b>Here's how it works:</b>\n` +
    `1️⃣ <b>Login to Zoom</b> — Click the button below to connect your Zoom account\n` +
    `2️⃣ <b>Send a meeting link</b> — Paste any Zoom invite link\n` +
    `3️⃣ <b>Bot joins & records</b> — I'll join the meeting and record everything\n` +
    `4️⃣ <b>Send /stop</b> — I'll save the recording and send you the download link\n\n` +
    `👇 <b>Step 1: Login to your Zoom account</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: connectZoomKeyboard(connectUrl),
    },
  );
}
