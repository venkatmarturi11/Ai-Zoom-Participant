import type { BotContext } from '../bot.js';
import { liveControlKeyboard } from '../keyboards/inline.js';

/**
 * /start — Welcome message with direct links
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  const userName = ctx.from?.first_name || ctx.from?.username || 'User';
  const liveMonitorUrl =
    process.env['RENDER_EXTERNAL_URL'] || `http://localhost:${process.env['API_PORT'] || 3000}`;

  // Store display name for later use
  ctx.session.pendingDisplayName =
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ||
    ctx.from?.username ||
    'Meeting Assistant';

  ctx.session.step = 'awaiting_meeting_link';

  await ctx.reply(
    `👋 <b>Welcome, ${userName}!</b>\n\n` +
    `🤖 <b>Zoom Meeting Attendance & Recorder Bot</b>\n\n` +
    `<b>Here is how to use the bot:</b>\n` +
    `1️⃣ <b>Login to Zoom</b>: <a href="https://zoom.us/signin">👉 Click here to Login to Zoom</a>\n` +
    `2️⃣ <b>Send me your Zoom meeting invite link</b>\n` +
    `3️⃣ <b>Join the meeting on your phone/device</b>, then feel free to leave — the bot stays and records\n` +
    `4️⃣ <b>Bot records the meeting</b> (screen + sound) into the database\n` +
    `5️⃣ <b>Send /stop</b> when finished to get your video download link!\n\n` +
    `🖥️ <b>Bot Live Screen Link (to help bot with Captcha/Login):</b>\n` +
    `👉 <a href="${liveMonitorUrl}">${liveMonitorUrl}</a>\n\n` +
    `👇 <b>Paste your Zoom meeting invite link directly in chat to begin!</b>`,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: liveControlKeyboard(liveMonitorUrl),
    },
  );
}
