// ============================================================
// Telegram message templates
// ============================================================

export const messages = {
  welcome: `👋 <b>Welcome to Telegram Zoom Assistant</b>

I can control your Zoom meetings directly from Telegram.

<b>Get started:</b>
Connect your Zoom account to begin.`,

  help: `📋 <b>Available Commands</b>

<b>Account</b>
/connect_zoom — Connect your Zoom account
/account — View connected Zoom account
/disconnect_zoom — Disconnect Zoom account

<b>Meetings</b>
/join — Join a Zoom meeting now
/schedule — Schedule a meeting join
/meetings — List active and recent meetings

<b>Session</b>
/status — Current session status
/stop — Stop active meeting session
/settings — Bot settings

<b>Other</b>
/start — Welcome message
/help — This help message`,

  noZoomAccount: `⚠️ No Zoom account connected.

Use /connect_zoom to link your Zoom account.`,

  connectZoomPrompt: `🔐 <b>Connect Zoom Account</b>

Tap the button below to connect your Zoom account.
You'll be redirected to Zoom's login page — we never see your password.`,

  zoomConnected: (email: string) =>
    `✅ <b>Zoom account connected!</b>

Email: <code>${email}</code>

You can now use /join to join meetings.`,

  zoomDisconnected: `✅ Zoom account disconnected.

All authorization tokens have been removed.`,

  accountInfo: (email: string, status: string) =>
    `🔐 <b>Zoom Account</b>

Email: <code>${email}</code>
Status: ${status === 'ACTIVE' ? '🟢 Connected' : '🔴 Disconnected'}
Authorization: ${status === 'ACTIVE' ? 'Active' : 'Inactive'}`,

  sendMeetingLink: `📹 Send your Zoom meeting invitation link.

<i>Example: https://zoom.us/j/123456789?pwd=...</i>`,

  meetingDetected: (meetingId: string, email: string) =>
    `🔎 <b>Meeting detected</b>

Meeting ID: <code>${meetingId}</code>
Zoom account: <code>${email}</code>`,

  meetingNeedsPasscode: `🔒 This meeting requires a passcode.

Please send the meeting passcode:`,

  invalidMeetingUrl: (error: string) =>
    `❌ <b>Invalid meeting link</b>

${error}`,

  duplicateSession: (topic: string | null, duration: string) =>
    `⚠️ You already have an active session.

Meeting: ${topic ?? 'Active Meeting'}
Duration: ${duration}`,

  schedulePrompt: `🕐 <b>When should I join?</b>

Send the time in one of these formats:
• <code>18:30</code> — today at 6:30 PM
• <code>18:30 tomorrow</code>
• <code>2026-08-14 09:00</code>

Timezone: Asia/Kolkata`,

  meetingScheduled: (meetingId: string, time: string) =>
    `✅ <b>Meeting scheduled</b>

Meeting ID: <code>${meetingId}</code>
Join at: <code>${time}</code>

I'll join automatically at the scheduled time.`,

  statusConnected: (data: {
    topic: string | null;
    meetingId: string;
    email: string;
    duration: string;
    connection: string;
  }) =>
    `🟢 <b>Zoom Assistant Status</b>

Meeting: ${data.topic ?? 'Meeting'}
Meeting ID: <code>${data.meetingId}</code>
Zoom account: <code>${data.email}</code>
Status: CONNECTED
Duration: <code>${data.duration}</code>
Connection: ${data.connection}
Microphone: 🔇 OFF
Camera: 📷 OFF`,

  statusNoActive: `ℹ️ No active meeting session.

Use /join to start one.`,

  stopConfirm: (topic: string | null, duration: string) =>
    `🛑 <b>Stop meeting session?</b>

Meeting: ${topic ?? 'Active Meeting'}
Duration: ${duration}`,

  meetingStopped: `✅ Meeting session stopped.

The bot has left the meeting and cleaned up.`,

  meetingEnded: `🔴 <b>Meeting ended</b>

The meeting has ended. Session cleaned up successfully.`,

  settings: (displayName: string, timezone: string) =>
    `⚙️ <b>Settings</b>

Display name: <code>${displayName}</code>
Microphone: OFF
Camera: OFF
Auto-reconnect: ON
Waiting-room timeout: 30 min
Auto-leave on meeting end: ON
Timezone: <code>${timezone}</code>`,

  unauthorized: `⛔ Unauthorized.`,

  rateLimited: (seconds: number) =>
    `⏳ Too many requests. Please wait ${seconds} seconds.`,

  genericError: `⚠️ An unexpected error occurred. Please try again.`,
} as const;
