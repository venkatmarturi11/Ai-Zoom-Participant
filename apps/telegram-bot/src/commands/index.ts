import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { startCommand } from './start.js';
import { helpCommand } from './help.js';
import { connectZoomCommand } from './connect-zoom.js';
import { accountCommand } from './account.js';
import { disconnectZoomCommand, handleDisconnectConfirm } from './disconnect-zoom.js';
import { joinCommand, handleMeetingLinkInput, handlePasscodeInput } from './join.js';
import { scheduleCommand, handleScheduleTimeInput } from './schedule.js';
import { meetingsCommand } from './meetings.js';
import { statusCommand } from './status.js';
import { stopCommand, handleStopConfirm } from './stop.js';
import { settingsCommand } from './settings.js';
import { pauseCommand, resumeCommand } from './pause-resume.js';
import { liveCommand } from './live.js';
import { userRepo } from '@zoom-assistant/database';
import { extractZoomUrl } from '@zoom-assistant/meeting-parser';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'bot-commands' });

export function registerCommands(bot: Bot<BotContext>): void {
  // Middleware to ensure user record exists on any command interaction
  // Non-blocking so DB errors never hang commands
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      userRepo.upsert(BigInt(ctx.from.id), ctx.from.username).catch((err: any) => {
        log.warn({ error: err?.message }, 'DB upsert failed (non-blocking, continuing)');
      });
    }
    await next();
  });

  // Register command handlers
  bot.command('start', startCommand);
  bot.command('live', liveCommand);
  bot.command('monitor', liveCommand);
  bot.command('help', helpCommand);
  bot.command('connect_zoom', connectZoomCommand);
  bot.command('account', accountCommand);
  bot.command('disconnect_zoom', disconnectZoomCommand);
  bot.command('join', joinCommand);
  bot.command('schedule', scheduleCommand);
  bot.command('meetings', meetingsCommand);
  bot.command('status', statusCommand);
  bot.command('stop', stopCommand);
  bot.command('pause', pauseCommand);
  bot.command('resume', resumeCommand);
  bot.command('settings', settingsCommand);

  // Handle multi-step conversation inputs & direct Zoom links
  bot.on('message:text', async (ctx, next) => {
    // If command, skip to next middleware (handled by bot.command above)
    if (ctx.message.text.startsWith('/')) {
      return next();
    }

    const { step } = ctx.session;

    if (step === 'awaiting_meeting_link') {
      await handleMeetingLinkInput(ctx);
      return;
    }

    if (step === 'awaiting_passcode') {
      await handlePasscodeInput(ctx);
      return;
    }

    if (step === 'awaiting_schedule_time') {
      await handleScheduleTimeInput(ctx);
      return;
    }

    // When user is in the "awaiting zoom login" state,
    // and they send a Zoom link, treat it as a meeting link (they may have already logged in)
    if (step === 'awaiting_zoom_login' || step === 'awaiting_zoom_link_after_login') {
      if (ctx.message.text.includes('zoom.us') || extractZoomUrl(ctx.message.text)) {
        ctx.session.step = 'idle';
        await handleMeetingLinkInput(ctx);
        return;
      }
      // If they send something that's not a Zoom link while awaiting login,
      // remind them to login or send a link
      await ctx.reply(
        '👆 Please click the <b>Connect Zoom</b> button above to login, then send me a Zoom meeting link.\n\n' +
        '<i>Or just paste a Zoom invite link directly!</i>',
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Direct Zoom meeting link pasted anytime!
    if (ctx.message.text.includes('zoom.us') || extractZoomUrl(ctx.message.text)) {
      await handleMeetingLinkInput(ctx);
      return;
    }

    await ctx.reply(
      '💡 Send <code>/help</code> to see available commands or paste any Zoom meeting link directly to start recording!',
      { parse_mode: 'HTML' },
    );
  });

  // Handle callback queries
  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'disconnect_confirm') {
      await handleDisconnectConfirm(ctx);
      return;
    }

    if (data === 'disconnect_cancel') {
      await ctx.editMessageText('Cancelled disconnection.');
      return;
    }

    if (data.startsWith('stop_confirm:')) {
      const meetingId = data.replace('stop_confirm:', '');
      await handleStopConfirm(ctx, meetingId);
      return;
    }

    if (data.startsWith('stop_cancel:')) {
      await ctx.editMessageText('Cancelled stop request.');
      return;
    }

    if (data === 'reconnect_zoom') {
      await connectZoomCommand(ctx);
      return;
    }

    if (data === 'disconnect_zoom') {
      await disconnectZoomCommand(ctx);
      return;
    }

    await next();
  });
}

/**
 * Registers bot slash commands with Telegram API so the autocomplete popup menu
 * and Telegram "Menu" button display all available bot commands in the chat interface.
 */
export async function setupBotCommands(bot: Bot<BotContext>): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: '🚀 Start bot & get direct links' },
      { command: 'live', description: '🖥️ Live Screen & Help (Captcha/Login)' },
      { command: 'stop', description: '🛑 Stop recording & save video' },
      { command: 'status', description: '📊 Check recording status' },
      { command: 'meetings', description: '📼 List recent recordings' },
      { command: 'help', description: 'ℹ️ Help & documentation' },
    ]);
    log.info('Registered Telegram bot commands menu');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ error: message }, 'Failed to set Telegram bot commands menu');
  }
}
