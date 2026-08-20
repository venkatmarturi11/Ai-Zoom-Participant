import { InlineKeyboard } from 'grammy';

// ============================================================
// Reusable inline keyboard builders
// ============================================================

export function isValidTelegramButtonUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function connectZoomKeyboard(oauthUrl: string) {
  const kb = new InlineKeyboard();
  if (isValidTelegramButtonUrl(oauthUrl)) {
    kb.url('🔐 Connect Zoom', oauthUrl);
  }
  return kb;
}

export function meetingActionsKeyboard(meetingId: string) {
  return new InlineKeyboard()
    .text('▶️ Join Now', `join:${meetingId}`)
    .text('🕐 Schedule', `schedule:${meetingId}`)
    .row()
    .text('❌ Cancel', `cancel:${meetingId}`);
}

export function stopConfirmKeyboard(meetingId: string) {
  return new InlineKeyboard()
    .text('🛑 Stop', `stop_confirm:${meetingId}`)
    .text('Cancel', `stop_cancel:${meetingId}`);
}

export function disconnectConfirmKeyboard() {
  return new InlineKeyboard()
    .text('❌ Disconnect', 'disconnect_confirm')
    .text('Cancel', 'disconnect_cancel');
}

export function accountKeyboard() {
  return new InlineKeyboard()
    .text('🔄 Reconnect', 'reconnect_zoom')
    .text('❌ Disconnect', 'disconnect_zoom');
}

export function activeSessionKeyboard(meetingId: string) {
  return new InlineKeyboard()
    .text('📊 View Status', `status:${meetingId}`)
    .text('🛑 Stop', `stop:${meetingId}`);
}

export function waitingRoomKeyboard(meetingId: string) {
  return new InlineKeyboard()
    .text('⏳ Continue Waiting', `wait:${meetingId}`)
    .text('🛑 Stop', `stop:${meetingId}`);
}

export function liveControlKeyboard(liveMonitorUrl?: string, meetingId?: string) {
  const kb = new InlineKeyboard();
  if (liveMonitorUrl && isValidTelegramButtonUrl(liveMonitorUrl)) {
    kb.url('🖥️ Open Live Screen & Control (Captcha/Login/Join)', liveMonitorUrl);
    if (meetingId) {
      kb.row().text('🛑 Stop Recording', `stop_confirm:${meetingId}`);
    }
  } else if (meetingId) {
    kb.text('🛑 Stop Recording', `stop_confirm:${meetingId}`);
  }
  return kb.inline_keyboard.length > 0 ? kb : undefined;
}

