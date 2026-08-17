// ============================================================
// Telegram message templates
// ============================================================

export const messages = {
  welcome: `👋 <b>Welcome to Zoom Meeting Recorder Bot</b>

I'll join your Zoom meetings, record them, and save the recording for you.

<b>Get started:</b>
Connect your Zoom account to begin.`,

  pause: `⏸️ <b>Notifications paused.</b>\n\nUse /resume to resume receiving meeting alerts.`,

  resume: `▶️ <b>Notifications resumed.</b>\n\nYou will receive active meeting alerts and updates.`,

  help: `📋 <b>Zoom Meeting Recorder Bot — Commands</b>

<b>🔑 Account</b>
/start — Start bot & connect Zoom
/connect_zoom — Connect your Zoom account
/account — View connected Zoom account
/disconnect_zoom — Disconnect Zoom account

<b>📹 Recording</b>
/join — Send a Zoom meeting link to record
/stop — Stop recording & get download link
/status — Check active recording status
/meetings — List recent recordings

<b>⚙️ Other</b>
/pause — Pause notifications
/resume — Resume notifications
/settings — Bot settings
/help — This help message

<b>💡 Quick Start:</b>
Just paste any Zoom meeting link directly in chat and I'll join & record it!`,

  noZoomAccount: `⚠️ No Zoom account connected.

Use /connect_zoom or /start to link your Zoom account first.`,

  connectZoomPrompt: `🔐 <b>Connect Zoom Account</b>

Tap the button below to login to your Zoom account.
You'll be redirected to Zoom's login page — we never see your password.

After logging in, come back here and send me a Zoom meeting link!`,

  zoomConnected: (email: string) =>
    `✅ <b>Zoom account connected!</b>

Email: <code>${email}</code>

🎉 <b>You're all set!</b> Now send me a Zoom meeting invite link and I'll join the meeting and start recording.

<i>Example:</i>
<code>https://zoom.us/j/1234567890?pwd=xxxx</code>`,

  zoomDisconnected: `✅ Zoom account disconnected.

All authorization tokens have been removed.`,

  accountInfo: (email: string, status: string) =>
    `🔐 <b>Zoom Account</b>

Email: <code>${email}</code>
Status: ${status === 'ACTIVE' ? '🟢 Connected' : '🔴 Disconnected'}
Authorization: ${status === 'ACTIVE' ? 'Active' : 'Inactive'}`,

  sendMeetingLink: `📹 <b>Send your Zoom meeting invite link</b>

Paste the full Zoom meeting URL here and I'll:
1. Join the meeting as a participant
2. Start screen recording with audio
3. Save the recording when you send /stop

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

  // Shown when the bot is about to join a meeting
  botJoining: (meetingId: string, displayName: string) =>
    `🚀 <b>Joining Zoom Meeting</b>

📌 <b>Meeting ID:</b> <code>${meetingId}</code>
👤 <b>Display Name:</b> <code>${displayName}</code>

⏳ Launching browser & connecting to meeting room...

<b>Useful links for you:</b>
🔗 <a href="https://zoom.us/signin">Zoom Login Page</a>
🔗 <a href="https://zoom.us/j/${meetingId}">Join Meeting on Your Device</a>

<i>You can join the meeting on your own device too, or let the bot handle it alone.</i>`,

  botConnected: (meetingId: string, displayName: string) =>
    `✅ <b>Bot is IN the Zoom Meeting!</b>

📌 <b>Meeting ID:</b> <code>${meetingId}</code>
👤 <b>Display Name:</b> <code>${displayName}</code>
🎥 <b>Screen Recording:</b> 🟢 <b>Active & Recording</b>

The bot is attending and recording the meeting session.

📌 <b>What to do now:</b>
• You can leave the meeting if you want — the bot will keep recording
• Send <code>/status</code> to check recording duration
• Send <code>/stop</code> to stop recording and get your download link`,

  botWaitingRoom: (meetingId: string, displayName: string) =>
    `⏳ <b>Bot is in the Zoom Waiting Room</b>

📌 <b>Meeting ID:</b> <code>${meetingId}</code>
👤 <b>Display Name:</b> <code>${displayName}</code>

<i>Please ask the meeting host to admit <b>${displayName}</b> to the meeting! The bot will automatically enter and start recording once admitted.</i>`,

  botFailed: (detail: string) =>
    `❌ <b>Could not join Zoom meeting</b>

<code>${detail || 'Connection failed'}</code>

<i>Please check that the meeting is currently live and the passcode is correct.</i>`,

  botNeedsHuman: (meetingId: string) =>
    `⚠️ <b>Action Required: Zoom Verification / Login Screen</b>

📌 <b>Meeting ID:</b> <code>${meetingId}</code>

The bot encountered a Zoom Sign-In, "Stay signed in", or CAPTCHA check on screen.
Please tap the button below to open the Live Screen and complete the check or click Join!`,


  // Shown when recording is stopped and saved
  recordingSaved: (data: {
    meetingId: string;
    duration: string;
    downloadUrl: string;
  }) =>
    `✅ <b>Meeting Session Ended & Recording Saved!</b>

📌 <b>Meeting ID:</b> <code>${data.meetingId}</code>
⏱️ <b>Duration:</b> <code>${data.duration}</code>
🤖 <b>Status:</b> Completed & Saved

📥 <b>Download your recording:</b>
<a href="${data.downloadUrl}">🎬 Click here to download MP4 video</a>

<i>The recording is stored securely in the database.</i>
You can send another Zoom link anytime to start a new recording!`,

  recordingNoVideo: (meetingId: string, duration: string) =>
    `✅ <b>Meeting Session Ended!</b>

📌 <b>Meeting ID:</b> <code>${meetingId}</code>
⏱️ <b>Duration:</b> <code>${duration}</code>
🤖 <b>Status:</b> Completed & Cleaned Up

⚠️ <i>No video recording was captured for this session.</i>

You can send another Zoom link anytime to start a new recording!`,

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
    `🟢 <b>Zoom Recording Status</b>

Meeting: ${data.topic ?? 'Meeting'}
Meeting ID: <code>${data.meetingId}</code>
Zoom account: <code>${data.email}</code>
Status: CONNECTED & RECORDING
Duration: <code>${data.duration}</code>
Connection: ${data.connection}
🎥 Screen Recording: 🟢 Active
Microphone: 🔇 OFF
Camera: 📷 OFF

Send <code>/stop</code> to end recording and get your download link.`,

  statusNoActive: `ℹ️ No active recording session.

Send a Zoom meeting link to start recording, or use /join.`,

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
