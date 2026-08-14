import { Bot, session, type Context } from 'grammy';
import { createLogger } from '@zoom-assistant/shared';
import { authMiddleware } from './middleware/auth.js';
import { registerCommands } from './commands/index.js';

const log = createLogger({ module: 'bot' });

/**
 * Session data stored per-chat for multi-step conversations.
 * Example: waiting for a meeting link after /join, or waiting for a time after /schedule.
 */
export interface SessionData {
  /** The current conversation state */
  step: 'idle' | 'awaiting_meeting_link' | 'awaiting_passcode' | 'awaiting_schedule_time';
  /** Temporary meeting data being assembled */
  pendingMeetingUrl?: string;
  pendingMeetingId?: string;
  pendingPasscode?: string;
}

export type BotContext = Context & {
  session: SessionData;
};

export function createBot(): Bot<BotContext> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  if (!token) {
    log.error('TELEGRAM_BOT_TOKEN is not set');
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is missing');
  }

  const bot = new Bot<BotContext>(token);

  // Session middleware — stores conversation state per chat
  bot.use(
    session({
      initial: (): SessionData => ({
        step: 'idle',
      }),
    }),
  );

  // Authorization middleware — rejects unauthorized Telegram users
  bot.use(authMiddleware);

  // Register all command handlers
  registerCommands(bot);

  // Handle text messages (for multi-step conversations)
  bot.on('message:text', async (ctx) => {
    const { step } = ctx.session;

    if (step === 'idle') {
      await ctx.reply(
        '💡 Use /help to see available commands.',
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Delegate to the appropriate handler based on conversation state
    // These are imported and handled in the command modules via callbacks
  });

  // Handle callback queries (inline keyboard button presses)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    log.debug({ data, userId: ctx.from.id }, 'Callback query received');
    await ctx.answerCallbackQuery();
  });

  // Error handler
  bot.catch((err) => {
    log.error({ error: err.message, stack: err.stack }, 'Bot error');
  });

  return bot;
}
