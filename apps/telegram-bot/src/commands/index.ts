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
import { userRepo } from '@zoom-assistant/database';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'bot-commands' });

export function registerCommands(bot: Bot<BotContext>): void {
  // Middleware to ensure user record exists on any command interaction
  // This is completely non-blocking — if DB is down, commands still work
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

  // Handle multi-step conversation inputs
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

    await next();
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
      { command: 'start', description: 'Start conversation & register' },
      { command: 'join', description: 'Join a Zoom meeting immediately' },
      { command: 'schedule', description: 'Schedule a meeting join time' },
      { command: 'status', description: 'Current meeting session status' },
      { command: 'stop', description: 'Stop active meeting session' },
      { command: 'meetings', description: 'List active & recent meetings' },
      { command: 'account', description: 'View connected Zoom account' },
      { command: 'connect_zoom', description: 'Connect Zoom OAuth account' },
      { command: 'disconnect_zoom', description: 'Disconnect Zoom account' },
      { command: 'pause', description: 'Pause meeting notifications' },
      { command: 'resume', description: 'Resume meeting notifications' },
      { command: 'settings', description: 'Bot configuration & defaults' },
      { command: 'help', description: 'Get help & documentation' },
    ]);
    log.info('Registered Telegram bot commands menu');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ error: message }, 'Failed to set Telegram bot commands menu');
  }
}
