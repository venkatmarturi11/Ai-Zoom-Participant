import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { meetingService } from '@zoom-assistant/orchestrator';
import { recordingRepo } from '@zoom-assistant/database';

export const liveDashboardRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * Verify admin API key for programmer-only endpoints.
   */
  function verifyAdminKey(request: any, reply?: any): boolean {
    const adminKey = process.env['ADMIN_API_KEY']?.trim();
    if (!adminKey) return true; // No key configured — allow all (dev mode)

    const isLocalhost =
      request.ip === '127.0.0.1' ||
      request.ip === '::1' ||
      request.hostname === 'localhost' ||
      request.hostname?.startsWith('localhost:') ||
      request.hostname?.startsWith('127.0.0.1:');

    if (isLocalhost && (process.env['NODE_ENV'] === 'development' || !process.env['NODE_ENV'])) {
      return true;
    }

    const headerKey = request.headers['x-admin-key'] as string | undefined;
    const queryKey = (request.query as any)?.key as string | undefined;

    const suppliedKey = headerKey ?? queryKey;
    if (
      suppliedKey &&
      suppliedKey.length === adminKey.length &&
      timingSafeEqual(Buffer.from(suppliedKey), Buffer.from(adminKey))
    ) {
      return true;
    }

    if (reply) {
      reply.status(403).send({
        error: 'Forbidden',
        message: 'Invalid or missing admin API key.',
      });
    }
    return false;
  }

  /**
   * WS /api/live/control — WebSocket endpoint for Human-in-the-Loop browser control
   */
  fastify.get('/api/live/control', { websocket: true }, (connection: any, request: any) => {
    const ws = connection?.socket || connection;
    if (!ws || typeof ws.on !== 'function') return;

    if (!verifyAdminKey(request)) {
      ws.close(4403, 'Forbidden');
      return;
    }

    ws.on('message', async (message: any) => {
      try {
        const str = typeof message === 'string' ? message : message.toString();
        const event = JSON.parse(str);
        await meetingService.dispatchControlEvent(event);
      } catch {
        // ignore invalid messages
      }
    });
  });

  /**
   * POST /api/live/launch-login — Open interactive browser to Zoom Sign-in page for 1-time permanent login
   */
  fastify.post('/api/live/launch-login', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    const body = (request.body || {}) as { url?: string };
    const targetUrl = body.url || 'https://zoom.us/signin';
    await meetingService.launchLoginSession(targetUrl);
    return reply.send({ success: true, url: targetUrl, message: 'Zoom sign-in browser launched on live screen' });
  });

  /**
   * POST /api/live/close-login — Gracefully finish login session and persist session cookies
   */
  fastify.post('/api/live/close-login', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    await meetingService.closeLoginSession();
    return reply.send({ success: true, message: 'Login session finalized and cookies saved' });
  });

  /**
   * GET /api/recordings — List all recorded videos saved in PostgreSQL database
   */
  fastify.get('/api/recordings', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    const list = await recordingRepo.listRecent(50);
    return reply.send(list);
  });

  /**
   * GET /api/recordings/:id/download — Stream / Download full MP4 video from database
   */
  fastify.get('/api/recordings/:id/download', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;

    const { id } = request.params as { id: string };
    const rec = await recordingRepo.findById(id);
    if (!rec) {
      return reply.status(404).send({ error: 'RecordingNotFound', message: 'Video recording not found in database' });
    }

    reply.header('Content-Type', rec.mimeType || 'video/mp4');
    reply.header('Content-Disposition', `inline; filename="${rec.fileName}"`);
    reply.header('Content-Length', rec.fileSize);
    return reply.send(rec.videoData);
  });

  /**
   * DELETE /api/recordings/:id — Directly delete a recording from PostgreSQL database
   */
  fastify.delete('/api/recordings/:id', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;

    const { id } = request.params as { id: string };
    try {
      await recordingRepo.delete(id);
      return reply.send({ success: true, message: 'Recording successfully deleted from database' });
    } catch (err: any) {
      return reply.status(404).send({ error: 'NotFound', message: 'Recording not found or already deleted' });
    }
  });

  /**
   * DELETE /api/recordings/all — Delete all recordings from PostgreSQL database
   */
  fastify.delete('/api/recordings/all', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;

    try {
      const result = await recordingRepo.deleteAll();
      return reply.send({ success: true, count: result.count, message: `${result.count} recordings deleted` });
    } catch (err: any) {
      return reply.status(500).send({ error: 'DeleteFailed', message: err?.message || 'Failed to delete recordings' });
    }
  });

  /**
   * GET /api/live/status — JSON status of current bot screen and session
   */
  fastify.get('/api/live/status', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    const status = await meetingService.getActiveLiveStatus();
    return reply.send({
      timestamp: new Date().toISOString(),
      ...status,
    });
  });

  /**
   * POST /api/live/screenshot — Force-capture a fresh screenshot immediately
   */
  fastify.post('/api/live/screenshot', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    const screenshot = await meetingService.getActiveMeetingScreenshot();
    if (screenshot && screenshot.length > 0) {
      reply.header('Cache-Control', 'no-cache');
      reply.type('image/jpeg');
      return reply.send(screenshot);
    }
    return reply.status(204).send();
  });

  /**
   * GET /api/live/screen — Live JPEG image stream of the headless bot's browser
   */
  fastify.get('/api/live/screen', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    const screenshot = await meetingService.getActiveMeetingScreenshot();

    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');

    if (screenshot && screenshot.length > 0) {
      reply.type('image/jpeg');
      return reply.send(screenshot);
    }

    // Return clean SVG placeholder when idle
    reply.type('image/svg+xml');
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a0e1a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <circle cx="640" cy="300" r="48" fill="#3b82f6" opacity="0.2"/>
        <circle cx="640" cy="300" r="32" fill="#3b82f6" opacity="0.4"/>
        <path d="M632 284 L654 300 L632 316 Z" fill="#60a5fa"/>
        <text x="640" y="380" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="#f8fafc" text-anchor="middle">
          Headless Browser is Ready (1280×720 HD)
        </text>
        <text x="640" y="415" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">
          Click "Launch Zoom Sign-In" below or send a Zoom link in Telegram!
        </text>
        <rect x="520" y="450" width="240" height="36" rx="18" fill="#1e293b" stroke="#334155" stroke-width="1"/>
        <circle cx="545" cy="468" r="5" fill="#10b981"/>
        <text x="560" y="473" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#cbd5e1">
          Interactive Control Ready
        </text>
      </svg>
    `;
    return reply.send(svg.trim());
  });

  /**
   * GET / — Live Visual Monitoring & Full Remote Control Center
   */
  fastify.get('/', async (_request, reply) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Zoom Bot — Live Screen & Interactive Remote Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card: rgba(18, 26, 43, 0.9);
      --border: rgba(255, 255, 255, 0.1);
      --blue: #3b82f6;
      --cyan: #06b6d4;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --text: #f8fafc;
      --muted: #94a3b8;
      --mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at 50% 0%, #172554 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 16px;
    }
    .container {
      width: 100%;
      max-width: 1360px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      flex: 1;
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 18px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      backdrop-filter: blur(12px);
      flex-wrap: wrap;
      gap: 12px;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 38px; height: 38px; border-radius: 10px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 16px rgba(59,130,246,0.4);
    }
    .header h1 { font-size: 16px; font-weight: 700; }
    .header p { font-size: 11px; color: var(--muted); }
    .header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pill {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
    }
    .pill-green { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .pill-yellow { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
    .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1.5s infinite; }
    .dot-green { background: var(--green); box-shadow: 0 0 8px var(--green); }
    .dot-yellow { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.85)} }

    .grid {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 14px;
      flex: 1;
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }

    .screen-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    .card-header {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(0, 0, 0, 0.2);
      flex-wrap: wrap;
      gap: 8px;
    }
    .card-title {
      font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 8px;
    }
    .live-tag {
      background: var(--red); color: white;
      font-size: 10px; font-weight: 800;
      padding: 2px 7px; border-radius: 4px;
      animation: pulse 1.2s infinite;
    }
    .rec-tag {
      background: rgba(239,68,68,0.2); color: #f87171;
      font-size: 10px; font-weight: 700;
      padding: 2px 7px; border-radius: 4px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .screen-viewport {
      position: relative;
      width: 100%;
      background: #000;
      aspect-ratio: 16 / 9;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
      user-select: none;
      touch-action: none;
    }
    .screen-image {
      width: 100%; height: 100%; object-fit: contain; display: block;
      cursor: crosshair;
    }
    .click-indicator {
      position: absolute;
      width: 22px; height: 22px;
      border-radius: 50%;
      border: 2px solid #60a5fa;
      background: rgba(96, 165, 250, 0.4);
      transform: translate(-50%, -50%);
      pointer-events: none;
      animation: clickRipple 0.6s ease-out forwards;
    }
    @keyframes clickRipple {
      0% { transform: translate(-50%, -50%) scale(0.4); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
    }

    .screen-overlay {
      position: absolute; bottom: 8px; left: 12px; right: 12px;
      display: flex; justify-content: space-between;
      font-size: 11px; font-family: var(--mono); color: #e2e8f0;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
      pointer-events: none;
    }

    .control-toolbar {
      padding: 12px 16px;
      background: rgba(0, 0, 0, 0.35);
      border-top: 1px solid var(--border);
      display: flex; flex-direction: column; gap: 10px;
    }
    .input-bar {
      display: flex; gap: 8px; width: 100%;
    }
    .text-input {
      flex: 1; background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      color: #fff; font-size: 13px;
      outline: none; transition: border-color 0.2s;
    }
    .text-input:focus { border-color: var(--blue); }
    .btn-keys {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .btn-key {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1; border-radius: 6px;
      padding: 6px 10px; font-size: 11px; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-key:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff; transform: translateY(-1px);
    }
    .btn-key:active { transform: translateY(0); }

    .btn {
      padding: 7px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      text-decoration: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--blue), #2563eb);
      color: white; box-shadow: 0 2px 10px rgba(59,130,246,0.3);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(59,130,246,0.4);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #cbd5e1; border: 1px solid var(--border);
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
    .btn-success {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      box-shadow: 0 2px 10px rgba(16,185,129,0.3);
    }
    .btn-success:hover {
      background: linear-gradient(135deg, #059669, #047857);
      transform: translateY(-1px);
    }
    .btn-danger {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
      box-shadow: 0 2px 8px rgba(239,68,68,0.25);
    }
    .btn-danger:hover {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(239,68,68,0.35);
    }

    .sidebar {
      display: flex; flex-direction: column; gap: 14px;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .panel h2 {
      font-size: 12px; font-weight: 700; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.05em;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .stat-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 11px;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--muted); }
    .stat-value { font-family: var(--mono); font-weight: 600; color: #fff; font-size: 11px; }

    .log-panel {
      max-height: 180px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 5px;
      font-size: 11px;
    }
    .log-item {
      padding: 5px 8px; background: rgba(255,255,255,0.02);
      border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);
      display: flex; gap: 6px; align-items: flex-start;
      line-height: 1.35;
    }
    .log-time { color: var(--muted); font-family: var(--mono); font-size: 9px; white-space: nowrap; }

    .help-box {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8));
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 10px; padding: 10px; font-size: 11px; line-height: 1.45; color: #cbd5e1;
    }
    .help-box strong { color: #93c5fd; display: block; margin-bottom: 3px; }

    @media (max-width: 640px) {
      body { padding: 8px; }
      .header { padding: 10px 12px; }
      .header-right { width: 100%; justify-content: flex-start; }
      .btn { font-size: 11px; padding: 6px 10px; }
      .btn-key { font-size: 10px; padding: 5px 8px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <div class="logo">🎮</div>
        <div>
          <h1>Zoom Bot Remote Control</h1>
          <p>Click, Type &amp; Manage Browser in Real Time (PC &amp; Mobile)</p>
        </div>
      </div>
      <div class="header-right">
        <div class="pill pill-green" id="headerPill">
          <div class="dot dot-green" id="headerDot"></div>
          <span id="headerStatusText">Control Ready</span>
        </div>
        <button class="btn btn-primary" onclick="launchLoginSession()">🔐 Launch Zoom Sign-In</button>
        <button class="btn btn-secondary" onclick="forceCapture()">📸 Capture</button>
      </div>
    </div>

    <div class="grid">
      <!-- Main Visual Screen & Interactive Viewport -->
      <div class="screen-card">
        <div class="card-header">
          <div class="card-title">
            <span>🖱️ Interactive Browser Screen (1280×720 HD)</span>
            <span class="live-tag">LIVE</span>
            <span class="rec-tag" id="recBadge" style="display:none">● REC</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-success" id="finishLoginBtn" style="display:none; font-size: 11px; padding: 5px 10px;" onclick="finishLoginSession()">✅ Finish Sign-In</button>
            <button class="btn btn-secondary" id="pauseBtn" style="font-size: 11px; padding: 5px 10px;" onclick="togglePause()">⏸ Pause</button>
          </div>
        </div>

        <div class="screen-viewport" id="screenContainer">
          <img id="liveScreen" class="screen-image" src="/api/live/screen" alt="Zoom Bot Screen">
          <div class="screen-overlay">
            <span id="framesOverlay">Frames: 0</span>
            <span id="durationOverlay">Elapsed: 00:00:00</span>
            <span id="lastUpdateOverlay">Updated: Just now</span>
          </div>
        </div>

        <!-- Interactive Remote Keyboard & Mouse Toolbar -->
        <div class="control-toolbar">
          <div class="input-bar">
            <input type="text" id="typeTextInput" class="text-input" placeholder="Type text here & press Enter or Send (Email, Password, Code)..." onkeydown="if(event.key==='Enter') sendTypedText()">
            <button class="btn btn-primary" onclick="sendTypedText()">⌨️ Send Text</button>
          </div>

          <div class="btn-keys">
            <button class="btn-key" onclick="sendKey('Tab')">⇥ Tab</button>
            <button class="btn-key" onclick="sendKey('Enter')">↵ Enter</button>
            <button class="btn-key" onclick="sendKey('Backspace')">⌫ Backspace</button>
            <button class="btn-key" onclick="sendKey('Space')">Space</button>
            <button class="btn-key" onclick="sendScroll(350)">⬇️ Scroll Down</button>
            <button class="btn-key" onclick="sendScroll(-350)">⬆️ Scroll Up</button>
            <button class="btn-key" onclick="navigateToUrl('https://zoom.us/signin')">🔐 Zoom Login Page</button>
            <button class="btn-key" onclick="navigateToUrl('https://zoom.us/google/oauth/signin')">🔵 Google Sign-In</button>
            <button class="btn-key" onclick="navigateToUrl('https://zoom.us/saml/login')">🏢 SSO Sign-In</button>
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="sidebar">
        <div class="panel">
          <h2>📊 Live Session State</h2>
          <div class="stat-row">
            <span class="stat-label">Bot Status</span>
            <span class="stat-value" id="statusVal" style="color: #34d399">READY</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Meeting ID</span>
            <span class="stat-value" id="meetingIdVal">—</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Display Name</span>
            <span class="stat-value" id="displayNameVal">—</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Duration</span>
            <span class="stat-value" id="durationVal">00:00:00</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Frames Captured</span>
            <span class="stat-value" id="frameCountVal">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Screen Recorder</span>
            <span class="stat-value" id="recorderStatusVal">Ready</span>
          </div>
        </div>

        <!-- Activity Log -->
        <div class="panel">
          <h2>📋 Live Activity Log</h2>
          <div class="log-panel" id="logList">
            <div class="log-item">
              <span class="log-time">${new Date().toLocaleTimeString()}</span>
              <span>🟢 Interactive control center ready. Click screen or type above.</span>
            </div>
          </div>
        </div>

        <div class="help-box">
          <strong>🖱️ How to Log In &amp; Use:</strong>
          • <strong>Tap or Click anywhere on the screen</strong> to click buttons, input boxes, or CAPTCHA checkmarks on PC or Mobile.<br>
          • <strong>Type into the text bar</strong> and click "Send Text" to enter your Zoom credentials.<br>
          • <strong>Click "Launch Zoom Sign-In"</strong> to sign in once permanently — the bot saves your login session so future meetings join instantly without prompts!
        </div>
      </div>
    </div>

    <!-- Saved Recordings with Direct Database Delete -->
    <div class="panel">
      <h2>
        <span>📼 Saved Database Recordings</span>
        <button class="btn btn-secondary" style="font-size: 10px; padding: 3px 8px;" onclick="loadRecordings()">🔄 Refresh</button>
      </h2>
      <div id="recordingsList" style="display: grid; gap: 8px; margin-top: 8px;">
        <div style="color: var(--muted); font-size: 12px;">Loading database recordings...</div>
      </div>
    </div>
  </div>

  <script>
    const adminKey = new URLSearchParams(window.location.search).get('key') || '${process.env['ADMIN_API_KEY']?.trim() || ''}';
    function apiUrl(path) {
      if (!adminKey) return path;
      return path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(adminKey);
    }
    const screenImg = document.getElementById('liveScreen');
    const screenContainer = document.getElementById('screenContainer');
    const logList = document.getElementById('logList');
    let autoRefresh = true;
    let ws = null;
    let lastState = 'IDLE';
    let sessionStartTime = null;
    let isLoginMode = false;

    function addLog(icon, text) {
      const time = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = '<span class="log-time">' + time + '</span><span>' + icon + ' ' + text + '</span>';
      logList.prepend(div);
      while (logList.children.length > 35) logList.removeChild(logList.lastChild);
    }

    function initWebSocket() {
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host + apiUrl('/api/live/control'));
      ws.onopen = () => {
        addLog('🔗', 'Interactive remote control stream connected');
        flushPendingWs();
      };
      ws.onclose = () => { setTimeout(initWebSocket, 2000); };
      ws.onerror = () => { addLog('⚠️', 'Remote control connection error'); };
    }

    let pendingWs = [];
    function flushPendingWs() {
      if (!ws || ws.readyState !== 1) return;
      while (pendingWs.length) {
        ws.send(JSON.stringify(pendingWs.shift()));
      }
    }

    function sendWs(evt) {
      initWebSocket();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(evt));
      } else {
        pendingWs.push(evt);
        if (pendingWs.length > 20) pendingWs.shift();
      }
    }

    // Direct Click / Touch on screen image
    function handlePointer(clientX, clientY) {
      const rect = screenImg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = 1280 / rect.width;
      const scaleY = 720 / rect.height;
      const clickX = Math.max(0, Math.min(1280, (clientX - rect.left) * scaleX));
      const clickY = Math.max(0, Math.min(720, (clientY - rect.top) * scaleY));

      // Show visual click indicator
      const ripple = document.createElement('div');
      ripple.className = 'click-indicator';
      ripple.style.left = (clientX - screenContainer.getBoundingClientRect().left) + 'px';
      ripple.style.top = (clientY - screenContainer.getBoundingClientRect().top) + 'px';
      screenContainer.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);

      sendWs({ type: 'click', x: clickX, y: clickY });
      addLog('🖱️', 'Clicked at (' + Math.round(clickX) + ', ' + Math.round(clickY) + ')');

      setTimeout(forceCapture, 350);
    }

    screenImg.addEventListener('click', (e) => {
      e.preventDefault();
      handlePointer(e.clientX, e.clientY);
    });

    screenImg.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        handlePointer(touch.clientX, touch.clientY);
      }
    });

    function sendTypedText() {
      const input = document.getElementById('typeTextInput');
      const text = input.value;
      if (!text) return;
      sendWs({ type: 'type', text: text });
      addLog('⌨️', 'Typed text: "' + text.replace(/./g, '*') + '"');
      input.value = '';
      setTimeout(forceCapture, 400);
    }

    function sendKey(key) {
      sendWs({ type: 'press', key: key });
      addLog('⌨️', 'Pressed key: [' + key + ']');
      setTimeout(forceCapture, 400);
    }

    function sendScroll(deltaY) {
      sendWs({ type: 'scroll', deltaY: deltaY });
      addLog('📜', 'Scrolled ' + (deltaY > 0 ? 'down' : 'up'));
      setTimeout(forceCapture, 350);
    }

    function navigateToUrl(url) {
      sendWs({ type: 'goto', url: url });
      addLog('🌐', 'Navigating to ' + url);
      setTimeout(forceCapture, 1200);
    }

    async function launchLoginSession() {
      addLog('🚀', 'Launching interactive Zoom sign-in browser session...');
      isLoginMode = true;
      document.getElementById('finishLoginBtn').style.display = 'inline-flex';
      try {
        await fetch(apiUrl('/api/live/launch-login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://zoom.us/signin' })
        });
        setTimeout(forceCapture, 1200);
      } catch (err) {
        addLog('❌', 'Failed to launch login session');
      }
    }

    async function finishLoginSession() {
      addLog('💾', 'Finalizing Zoom login and saving permanent session cookies...');
      try {
        await fetch(apiUrl('/api/live/close-login'), { method: 'POST' });
        isLoginMode = false;
        document.getElementById('finishLoginBtn').style.display = 'none';
        addLog('✅', 'Zoom login session saved permanently! Future meetings will join automatically.');
        setTimeout(forceCapture, 1000);
      } catch (err) {
        addLog('❌', 'Failed to finalize login session');
      }
    }

    let isRefreshing = false;
    function refreshScreen() {
      if (!autoRefresh || isRefreshing) return;
      isRefreshing = true;
      const t = Date.now();
      const tempImg = new Image();
      tempImg.onload = () => {
        screenImg.src = tempImg.src;
        document.getElementById('lastUpdateOverlay').textContent = 'Updated: ' + new Date().toLocaleTimeString();
        isRefreshing = false;
      };
      tempImg.onerror = () => {
        isRefreshing = false;
      };
      tempImg.src = apiUrl('/api/live/screen?t=' + t);
    }

    async function forceCapture() {
      try {
        const res = await fetch(apiUrl('/api/live/screenshot'), { method: 'POST' });
        if (res.ok && res.status === 200) {
          const blob = await res.blob();
          if (blob && blob.size > 0) {
            screenImg.src = URL.createObjectURL(blob);
            document.getElementById('lastUpdateOverlay').textContent = 'Updated: ' + new Date().toLocaleTimeString();
          }
        }
      } catch {}
    }

    function togglePause() {
      autoRefresh = !autoRefresh;
      document.getElementById('pauseBtn').textContent = autoRefresh ? '⏸ Pause' : '▶ Resume';
    }

    async function pollStatus() {
      try {
        const res = await fetch(apiUrl('/api/live/status'));
        if (!res.ok) return;
        const d = await res.json();

        const statusVal = document.getElementById('statusVal');
        const recBadge = document.getElementById('recBadge');

        if (d.active) {
          if (!sessionStartTime) sessionStartTime = Date.now();
          const elapsed = Date.now() - sessionStartTime;
          const h = String(Math.floor(elapsed/3600000)).padStart(2,'0');
          const m = String(Math.floor((elapsed%3600000)/60000)).padStart(2,'0');
          const s = String(Math.floor((elapsed%60000)/1000)).padStart(2,'0');
          const durStr = h+':'+m+':'+s;

          document.getElementById('meetingIdVal').textContent = d.zoomMeetingId || '—';
          document.getElementById('displayNameVal').textContent = d.displayName || 'Assistant';
          document.getElementById('frameCountVal').textContent = d.frameCount || 0;
          document.getElementById('framesOverlay').textContent = 'Frames: ' + (d.frameCount || 0);
          document.getElementById('durationVal').textContent = durStr;
          document.getElementById('durationOverlay').textContent = 'Elapsed: ' + durStr;
          document.getElementById('recorderStatusVal').textContent = '🟢 Recording Active';
          document.getElementById('recorderStatusVal').style.color = '#34d399';
          recBadge.style.display = 'inline-flex';

          if (d.displayName === 'User Login' || isLoginMode) {
            document.getElementById('finishLoginBtn').style.display = 'inline-flex';
          }

          if (d.status === 'CONNECTED') {
            statusVal.textContent = 'CONNECTED';
            statusVal.style.color = '#34d399';
            if (lastState !== 'CONNECTED') addLog('✅', 'Bot is inside the Zoom meeting room! Screen recording active.');
          } else if (d.status === 'WAITING_ROOM') {
            statusVal.textContent = 'WAITING ROOM';
            statusVal.style.color = '#fbbf24';
            if (lastState !== 'WAITING_ROOM') addLog('⏳', 'Bot is waiting in the host waiting room.');
          } else {
            statusVal.textContent = 'CONNECTING / ACTIVE';
            statusVal.style.color = '#60a5fa';
          }
          lastState = d.status;
        } else {
          sessionStartTime = null;
          document.getElementById('meetingIdVal').textContent = '—';
          document.getElementById('displayNameVal').textContent = '—';
          document.getElementById('frameCountVal').textContent = '0';
          document.getElementById('framesOverlay').textContent = 'Frames: 0';
          document.getElementById('durationVal').textContent = '00:00:00';
          document.getElementById('durationOverlay').textContent = 'Elapsed: 00:00:00';
          statusVal.textContent = 'READY';
          statusVal.style.color = '#34d399';
          document.getElementById('recorderStatusVal').textContent = 'Ready';
          document.getElementById('recorderStatusVal').style.color = '#94a3b8';
          recBadge.style.display = 'none';
          document.getElementById('finishLoginBtn').style.display = 'none';
          isLoginMode = false;
          lastState = 'IDLE';
        }
      } catch {}
    }

    async function deleteRecording(id, zoomMeetingId) {
      if (!confirm('Are you sure you want to permanently delete the recording for Zoom Meeting ' + zoomMeetingId + ' from the database?')) {
        return;
      }
      try {
        const res = await fetch(apiUrl('/api/recordings/' + id), { method: 'DELETE' });
        if (res.ok) {
          addLog('🗑️', 'Deleted recording for meeting ' + zoomMeetingId + ' from database');
          loadRecordings();
        } else {
          alert('Failed to delete recording from database.');
        }
      } catch (err) {
        alert('Network error while deleting recording.');
      }
    }

    async function loadRecordings() {
      const container = document.getElementById('recordingsList');
      if (!container) return;
      try {
        const res = await fetch(apiUrl('/api/recordings'));
        if (res.ok) {
          const items = await res.json();
          if (items.length === 0) {
            container.innerHTML = '<div style="color: var(--muted); font-size: 12px; padding: 8px 0;">No recordings stored yet. Join and stop a meeting to view recordings here.</div>';
            return;
          }
          container.innerHTML = items.map(function(item) {
            var sizeMb = (item.fileSize / (1024 * 1024)).toFixed(2);
            var recDate = new Date(item.createdAt).toLocaleString();
            return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 10px; flex-wrap: wrap; gap: 8px;">' +
              '<div>' +
                '<div style="font-weight: 600; font-size: 13px; color: #fff;">Zoom Meeting: <code>' + item.zoomMeetingId + '</code></div>' +
                '<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Size: ' + sizeMb + ' MB • ' + recDate + '</div>' +
              '</div>' +
              '<div style="display: flex; gap: 8px; align-items: center;">' +
                '<a href="' + apiUrl('/api/recordings/' + item.id + '/download') + '" target="_blank" class="btn btn-primary" style="font-size: 11px; padding: 5px 10px;">▶️ Download MP4</a>' +
                '<button onclick="deleteRecording(\\'' + item.id + '\\', \\'' + item.zoomMeetingId + '\\')" class="btn btn-danger" style="font-size: 11px; padding: 5px 10px;">🗑️ Delete</button>' +
              '</div>' +
            '</div>';
          }).join('');
        } else if (res.status === 403) {
          container.innerHTML = '<div style="color: var(--muted); font-size: 12px;">🔒 Recordings require programmer API key (ADMIN_API_KEY).</div>';
        }
      } catch {
        container.innerHTML = '<div style="color: var(--muted); font-size: 12px;">Could not load database recordings.</div>';
      }
    }

    initWebSocket();
    setInterval(refreshScreen, 1200);
    setInterval(pollStatus, 1500);
    setInterval(loadRecordings, 12000);

    pollStatus();
    loadRecordings();
  </script>
</body>
</html>
    `;
    return reply.type('text/html').send(html.trim());
  });
};
