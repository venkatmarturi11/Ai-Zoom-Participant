import { InlineKeyboard } from 'grammy';

// ============================================================
// Reusable inline keyboard builders
// ============================================================

export function connectZoomKeyboard(oauthUrl: string) {
  return new InlineKeyboard().url('🔐 Connect Zoom', oauthUrl);
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
