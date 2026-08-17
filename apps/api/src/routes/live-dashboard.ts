import type { FastifyPluginAsync } from 'fastify';
import { meetingService } from '@zoom-assistant/orchestrator';
import { recordingRepo } from '@zoom-assistant/database';

export const liveDashboardRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * Verify admin API key for programmer-only endpoints.
   * Checks X-Admin-Key header or ?key= query parameter.
   * If ADMIN_API_KEY is not set, all requests are allowed (dev mode).
   */
  function verifyAdminKey(request: any, reply: any): boolean {
    const adminKey = process.env['ADMIN_API_KEY']?.trim();
    if (!adminKey) return true; // No key configured — allow all (dev mode)

    const headerKey = request.headers['x-admin-key'] as string | undefined;
    const queryKey = (request.query as any)?.key as string | undefined;

    if (headerKey === adminKey || queryKey === adminKey) {
      return true;
    }

    reply.status(403).send({
      error: 'Forbidden',
      message: 'Invalid or missing admin API key. Recordings are programmer-only.',
    });
    return false;
  }

  /**
   * WS /api/live/control — WebSocket endpoint for Human-in-the-Loop browser control
   */
  fastify.get('/api/live/control', { websocket: true }, (connection) => {
    connection.socket.on('message', async (message: Buffer) => {
      try {
        const event = JSON.parse(message.toString());
        await meetingService.dispatchControlEvent(event);
      } catch {
        // ignore invalid messages
      }
    });
  });

  /**
   * GET /api/recordings — List all recorded videos saved in PostgreSQL database
   * 🔐 Requires admin API key (programmer-only)
   */
  fastify.get('/api/recordings', async (request, reply) => {
    if (!verifyAdminKey(request, reply)) return;
    const list = await recordingRepo.listRecent(20);
    return reply.send(list);
  });

  /**
   * GET /api/recordings/:id/download — Stream / Download full MP4 video from database
   * 🔐 Requires admin API key (programmer-only) OR a valid download token
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
   * GET /api/live/status — JSON status of current bot screen and session
   */
  fastify.get('/api/live/status', async (_request, reply) => {
    const status = await meetingService.getActiveLiveStatus();
    return reply.send({
      timestamp: new Date().toISOString(),
      ...status,
    });
  });

  /**
   * POST /api/live/screenshot — Force-capture a fresh screenshot immediately
   */
  fastify.post('/api/live/screenshot', async (_request, reply) => {
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
  fastify.get('/api/live/screen', async (_request, reply) => {
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
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a0e1a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <circle cx="320" cy="150" r="36" fill="#3b82f6" opacity="0.2"/>
        <circle cx="320" cy="150" r="24" fill="#3b82f6" opacity="0.4"/>
        <path d="M312 138 L334 150 L312 162 Z" fill="#60a5fa"/>
        <text x="320" y="215" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="600" fill="#f8fafc" text-anchor="middle">
          Headless Browser is Idle
        </text>
        <text x="320" y="240" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#94a3b8" text-anchor="middle">
          Send a Zoom link to Telegram Bot to join &amp; record live!
        </text>
        <rect x="230" y="265" width="180" height="28" rx="14" fill="#1e293b" stroke="#334155" stroke-width="1"/>
        <circle cx="245" cy="279" r="4" fill="#10b981"/>
        <text x="257" y="283" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500" fill="#cbd5e1">
          Telegram Bot Online
        </text>
      </svg>
    `;
    return reply.send(svg.trim());
  });

  /**
   * GET / — Live Visual Monitoring & Diagnostic Dashboard
   * Full-screen live view of the headless browser with activity log,
   * status indicators, and remote control. Mobile-friendly.
   */
  fastify.get('/', async (_request, reply) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Zoom Bot — Live Screen & Diagnostics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card: rgba(18, 26, 43, 0.85);
      --border: rgba(255, 255, 255, 0.08);
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
      max-width: 1320px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 20px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      backdrop-filter: blur(12px);
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 16px rgba(59,130,246,0.4);
    }
    .header h1 { font-size: 17px; font-weight: 700; }
    .header p { font-size: 12px; color: var(--muted); }
    .header-right { display: flex; align-items: center; gap: 10px; }
    .pill {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 14px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
    }
    .pill-green { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .pill-red { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
    .pill-yellow { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
    .pill-blue { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
    .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1.5s infinite; }
    .dot-green { background: var(--green); box-shadow: 0 0 8px var(--green); }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.85)} }

    .grid {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 16px;
      flex: 1;
    }
    @media (max-width: 960px) {
      .grid { grid-template-columns: 1fr; }
    }

    .screen-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    .card-header {
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .card-title {
      font-size: 14px; font-weight: 600;
      display: flex; align-items: center; gap: 8px;
    }
    .live-tag {
      background: var(--red); color: white;
      font-size: 10px; font-weight: 800;
      padding: 2px 7px; border-radius: 4px;
      letter-spacing: 0.05em;
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
    }
    .screen-image {
      width: 100%; height: 100%; object-fit: contain; display: block;
    }
    .screen-overlay {
      position: absolute; bottom: 12px; left: 12px;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(10px);
      padding: 6px 12px; border-radius: 8px;
      font-size: 11px; font-family: var(--mono);
      color: #93c5fd;
      display: flex; gap: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .btn {
      padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s ease;
      display: inline-flex; align-items: center; gap: 6px;
      text-decoration: none; font-family: 'Inter', sans-serif;
    }
    .btn-primary { background: linear-gradient(135deg, #2563eb, #3b82f6); color: #fff; }
    .btn-secondary { background: rgba(255, 255, 255, 0.06); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.12); }
    .btn-warning { background: var(--yellow); color: #000; font-weight: 700; }

    .sidebar {
      display: flex; flex-direction: column; gap: 16px;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }
    .panel h2 {
      font-size: 14px; font-weight: 700; margin-bottom: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .stat-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 12px;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--muted); }
    .stat-value { font-family: var(--mono); font-weight: 600; color: #fff; font-size: 12px; }

    .log-panel {
      max-height: 220px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 6px;
      font-size: 11px;
    }
    .log-item {
      padding: 6px 10px; background: rgba(255,255,255,0.02);
      border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);
      display: flex; gap: 8px; align-items: flex-start;
      line-height: 1.35;
    }
    .log-time { color: var(--muted); font-family: var(--mono); font-size: 10px; white-space: nowrap; }

    .help-box {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8));
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 12px; padding: 12px; font-size: 12px; line-height: 1.45; color: #cbd5e1;
    }
    .help-box strong { color: #93c5fd; display: block; margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <div class="logo">🎥</div>
        <div>
          <h1>Zoom Bot Monitor</h1>
          <p>Real-Time Visual Screencast &amp; Activity Log</p>
        </div>
      </div>
      <div class="header-right">
        <div class="pill pill-green" id="headerPill">
          <div class="dot dot-green"></div>
          <span id="headerStatusText">Service Active</span>
        </div>
        <button class="btn btn-secondary" onclick="forceCapture()">📸 Capture Now</button>
      </div>
    </div>

    <div class="grid">
      <!-- Main Visual Screen -->
      <div class="screen-card">
        <div class="card-header">
          <div class="card-title">
            <span>📺 Headless Browser Display (640×360)</span>
            <span class="live-tag">LIVE</span>
            <span class="rec-tag" id="recBadge" style="display:none">● REC</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="takeControlBtn" class="btn btn-warning" style="display: none;" onclick="toggleControl()">⚠️ Take Control</button>
            <button class="btn btn-secondary" id="pauseBtn" onclick="togglePause()">⏸ Pause</button>
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
      </div>

      <!-- Sidebar -->
      <div class="sidebar">
        <div class="panel">
          <h2>📊 Live Session State</h2>
          <div class="stat-row">
            <span class="stat-label">Bot Status</span>
            <span class="stat-value" id="statusVal" style="color: #34d399">IDLE</span>
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
              <span>🟢 Monitoring dashboard initialized. Ready for Zoom sessions.</span>
            </div>
          </div>
        </div>

        <div class="help-box">
          <strong>💡 How it works:</strong>
          1. Send a Zoom link in Telegram.<br>
          2. The bot joins and records everything.<br>
          3. Watch the live screen above in real-time.<br>
          4. Send <code>/stop</code> in Telegram to save video.
        </div>
      </div>
    </div>

    <!-- Saved Recordings -->
    <div class="panel">
      <h2>📼 Saved Database Recordings</h2>
      <div id="recordingsList" style="display: grid; gap: 8px; margin-top: 8px;">
        <div style="color: var(--muted); font-size: 12px;">Loading database recordings...</div>
      </div>
    </div>
  </div>

  <script>
    const screenImg = document.getElementById('liveScreen');
    const logList = document.getElementById('logList');
    let autoRefresh = true;
    let isControlling = false;
    let ws = null;
    let lastState = 'IDLE';
    let sessionStartTime = null;

    function addLog(icon, text) {
      const time = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = '<span class="log-time">' + time + '</span><span>' + icon + ' ' + text + '</span>';
      logList.prepend(div);
      while (logList.children.length > 30) logList.removeChild(logList.lastChild);
    }

    function refreshScreen() {
      if (!autoRefresh) return;
      const t = Date.now();
      screenImg.src = '/api/live/screen?t=' + t;
      document.getElementById('lastUpdateOverlay').textContent = 'Updated: ' + new Date().toLocaleTimeString();
    }

    async function forceCapture() {
      addLog('📸', 'Capturing fresh screenshot on demand...');
      try {
        const res = await fetch('/api/live/screenshot', { method: 'POST' });
        if (res.ok) {
          const blob = await res.blob();
          screenImg.src = URL.createObjectURL(blob);
          document.getElementById('lastUpdateOverlay').textContent = 'Updated: ' + new Date().toLocaleTimeString();
          addLog('✅', 'Fresh screenshot captured');
        } else {
          addLog('⚠️', 'No active browser session');
        }
      } catch {
        addLog('❌', 'Screenshot capture failed');
      }
    }

    function togglePause() {
      autoRefresh = !autoRefresh;
      document.getElementById('pauseBtn').textContent = autoRefresh ? '⏸ Pause' : '▶ Resume';
      addLog(autoRefresh ? '▶️' : '⏸️', autoRefresh ? 'Screen stream resumed' : 'Screen stream paused');
    }

    async function pollStatus() {
      try {
        const res = await fetch('/api/live/status');
        if (!res.ok) return;
        const d = await res.json();

        const statusVal = document.getElementById('statusVal');
        const recBadge = document.getElementById('recBadge');
        const takeControlBtn = document.getElementById('takeControlBtn');

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

          if (d.status === 'CONNECTED') {
            statusVal.textContent = 'CONNECTED';
            statusVal.style.color = '#34d399';
            if (lastState !== 'CONNECTED') addLog('✅', 'Bot is inside the Zoom meeting room! Screen recording active.');
          } else if (d.status === 'WAITING_ROOM') {
            statusVal.textContent = 'WAITING ROOM';
            statusVal.style.color = '#fbbf24';
            if (lastState !== 'WAITING_ROOM') addLog('⏳', 'Bot is waiting in the host waiting room. Host must click Admit.');
          } else {
            statusVal.textContent = 'CONNECTING';
            statusVal.style.color = '#60a5fa';
            if (lastState !== 'CONNECTING') addLog('🔄', 'Launching headless browser and navigating to Zoom meeting...');
          }

          if (d.needsHumanInteraction && !isControlling) {
            takeControlBtn.style.display = 'inline-flex';
            if (lastState !== 'NEEDS_HELP') addLog('🚨', 'Bot encountered CAPTCHA or Login check! Click "Take Control" to assist.');
            lastState = 'NEEDS_HELP';
          } else {
            if (!isControlling) takeControlBtn.style.display = 'none';
            lastState = d.status;
          }
        } else {
          sessionStartTime = null;
          document.getElementById('meetingIdVal').textContent = '—';
          document.getElementById('displayNameVal').textContent = '—';
          document.getElementById('frameCountVal').textContent = '0';
          document.getElementById('framesOverlay').textContent = 'Frames: 0';
          document.getElementById('durationVal').textContent = '00:00:00';
          document.getElementById('durationOverlay').textContent = 'Elapsed: 00:00:00';
          statusVal.textContent = 'IDLE';
          statusVal.style.color = '#94a3b8';
          document.getElementById('recorderStatusVal').textContent = 'Ready';
          document.getElementById('recorderStatusVal').style.color = '#94a3b8';
          recBadge.style.display = 'none';
          takeControlBtn.style.display = 'none';

          if (lastState && lastState !== 'IDLE') {
            addLog('🔴', 'Meeting session ended. Recording saved to database.');
          }
          lastState = 'IDLE';
        }
      } catch {}
    }

    async function loadRecordings() {
      const container = document.getElementById('recordingsList');
      if (!container) return;
      try {
        const res = await fetch('/api/recordings');
        if (res.ok) {
          const items = await res.json();
          if (items.length === 0) {
            container.innerHTML = '<div style="color: var(--muted); font-size: 12px;">No recordings stored yet. Join and stop a meeting to view recordings here.</div>';
            return;
          }
          container.innerHTML = items.map(function(item) {
            var sizeMb = (item.fileSize / (1024 * 1024)).toFixed(2);
            var recDate = new Date(item.createdAt).toLocaleString();
            return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 10px;">' +
              '<div>' +
                '<div style="font-weight: 600; font-size: 13px; color: #fff;">Zoom Meeting: <code>' + item.zoomMeetingId + '</code></div>' +
                '<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Size: ' + sizeMb + ' MB • ' + recDate + '</div>' +
              '</div>' +
              '<a href="/api/recordings/' + item.id + '/download" target="_blank" class="btn btn-primary" style="font-size: 11px; padding: 5px 10px;">▶️ Download MP4</a>' +
            '</div>';
          }).join('');
        } else if (res.status === 403) {
          container.innerHTML = '<div style="color: var(--muted); font-size: 12px;">🔒 Recordings require programmer API key (ADMIN_API_KEY).</div>';
        }
      } catch {
        container.innerHTML = '<div style="color: var(--muted); font-size: 12px;">Could not load database recordings.</div>';
      }
    }

    function initWebSocket() {
      if (ws) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host + '/api/live/control');
      ws.onopen = () => addLog('🔗', 'Remote control connection established');
      ws.onclose = () => { ws = null; addLog('🔌', 'Remote control disconnected'); };
    }

    function toggleControl() {
      isControlling = !isControlling;
      const btn = document.getElementById('takeControlBtn');
      if (isControlling) {
        initWebSocket();
        btn.textContent = '✅ Controlling (Click to Release)';
        btn.className = 'btn btn-primary';
        screenImg.style.cursor = 'crosshair';
        addLog('🖱️', 'Control mode active — click the screen image to interact with Zoom');
      } else {
        btn.textContent = '⚠️ Take Control';
        btn.className = 'btn btn-warning';
        screenImg.style.cursor = 'default';
        addLog('🖱️', 'Control released');
      }
    }

    function sendWs(evt) {
      if (ws && ws.readyState === 1 && isControlling) ws.send(JSON.stringify(evt));
    }

    screenImg.addEventListener('click', (e) => {
      if (!isControlling) return;
      e.preventDefault();
      const rect = screenImg.getBoundingClientRect();
      sendWs({ type:'click', x: (e.clientX-rect.left)*(640/rect.width), y: (e.clientY-rect.top)*(360/rect.height) });
    });

    setInterval(() => {
      refreshScreen();
      pollStatus();
    }, 2000);

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
