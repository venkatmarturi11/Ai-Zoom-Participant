import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { eventBus, MEETING_EVENTS, type MeetingEventPayload, createLogger } from '@zoom-assistant/shared';
import { userRepo } from '@zoom-assistant/database';

const log = createLogger({ module: 'notification-service' });

export class NotificationService {
  private unsubscribe?: () => void;
  private readonly reconnectNotifiedMeetings = new Set<string>();

  public start(bot: Bot<BotContext>): void {
    log.info('Starting Telegram NotificationService...');

    this.unsubscribe = eventBus.subscribe('*', async (payload: MeetingEventPayload) => {
      await this.handleEvent(bot, payload);
    });
  }

  public stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
      log.info('Stopped Telegram NotificationService');
    }
  }

  private async handleEvent(bot: Bot<BotContext>, payload: MeetingEventPayload): Promise<void> {
    try {
      const user = await userRepo.findByTelegramId(BigInt(payload.userId)).catch(() => null);
      const telegramChatId = user ? Number(user.telegramUserId) : null;

      if (!telegramChatId) {
        log.warn({ userId: payload.userId, event: payload.event }, 'Could not resolve Telegram chat ID for user');
        return;
      }

      switch (payload.event) {
        case MEETING_EVENTS.MEETING_STARTING:
          await bot.api.sendMessage(
            telegramChatId,
            `🟡 <b>Starting meeting session...</b>\n\nMeeting ID: <code>${payload.zoomMeetingId}</code>`,
            { parse_mode: 'HTML' },
          );
          break;

        case MEETING_EVENTS.MEETING_WAITING_ROOM:
          await bot.api.sendMessage(
            telegramChatId,
            `🟡 <b>Waiting for host admission</b>\n\nMeeting ID: <code>${payload.zoomMeetingId}</code>\nI'll notify you once admitted.`,
            { parse_mode: 'HTML' },
          );
          break;

        case MEETING_EVENTS.MEETING_CONNECTED:
          // Reset reconnection notification throttle
          this.reconnectNotifiedMeetings.delete(payload.meetingId);

          await bot.api.sendMessage(
            telegramChatId,
            `🟢 <b>Meeting connected!</b>\n\nMeeting ID: <code>${payload.zoomMeetingId}</code>\nSession is active and monitoring.`,
            { parse_mode: 'HTML' },
          );
          break;

        case MEETING_EVENTS.MEETING_RECONNECTING:
          // Throttle reconnection notifications to prevent chat spam
          if (!this.reconnectNotifiedMeetings.has(payload.meetingId)) {
            this.reconnectNotifiedMeetings.add(payload.meetingId);
            await bot.api.sendMessage(
              telegramChatId,
              `⚠️ <b>Connection interrupted</b>\n\n🔄 Attempting to reconnect...`,
              { parse_mode: 'HTML' },
            );
          }
          break;

        case MEETING_EVENTS.MEETING_ENDED:
        case MEETING_EVENTS.MEETING_CLEANED:
          this.reconnectNotifiedMeetings.delete(payload.meetingId);
          await bot.api.sendMessage(
            telegramChatId,
            `🔴 <b>Meeting session ended</b>\n\nSession cleaned up successfully.`,
            { parse_mode: 'HTML' },
          );
          break;

        case MEETING_EVENTS.MEETING_FAILED:
          this.reconnectNotifiedMeetings.delete(payload.meetingId);
          await bot.api.sendMessage(
            telegramChatId,
            `❌ <b>Meeting session failed</b>\n\nReason: ${payload.error ?? 'Unexpected error'}`,
            { parse_mode: 'HTML' },
          );
          break;

        default:
          break;
      }
    } catch (err: any) {
      log.error({ error: err.message, event: payload.event }, 'Failed to deliver Telegram notification');
    }
  }
}

export const notificationService = new NotificationService();
