import type { FastifyPluginAsync } from 'fastify';
import { meetingService } from '@zoom-assistant/orchestrator';
import { recordingRepo } from '@zoom-assistant/database';

export const liveDashboardRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * WS /api/live/control — WebSocket endpoint for Human-in-the-Loop browser control
   */
  fastify.get('/api/live/control', { websocket: true }, (connection) => {
    connection.socket.on('message', async (message: Buffer) => {
      try {
        const event = JSON.parse(message.toString());
        await meetingService.dispatchControlEvent(event);
      } catch (err) {
        // ignore invalid messages
      }
    });
  });

  /**
   * GET /api/recordings — List all recorded videos saved in PostgreSQL database
   */
  fastify.get('/api/recordings', async (_request, reply) => {
    const list = await recordingRepo.listRecent(20);
    return reply.send(list);
  });

  /**
   * GET /api/recordings/:id/download — Stream / Download full MP4 video from database
   */
  fastify.get('/api/recordings/:id/download', async (request, reply) => {
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
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <circle cx="640" cy="300" r="64" fill="#3b82f6" opacity="0.15"/>
        <circle cx="640" cy="300" r="48" fill="#3b82f6" opacity="0.25"/>
        <path d="M620 280 L660 300 L620 320 Z" fill="#60a5fa" filter="url(#glow)"/>
        <text x="640" y="410" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="26" font-weight="600" fill="#f8fafc" text-anchor="middle">
          Headless Browser is Idle
        </text>
        <text x="640" y="450" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">
          Send a Zoom link to your Telegram Bot to start attending &amp; recording live!
        </text>
        <rect x="510" y="490" width="260" height="40" rx="20" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
        <circle cx="530" cy="510" r="5" fill="#10b981"/>
        <text x="548" y="516" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#cbd5e1">
          Telegram Bot Online &amp; Ready
        </text>
      </svg>
    `;
    return reply.send(svg.trim());
  });

  /**
   * GET / — Live Visual Monitoring & Diagnostic Dashboard
   */
  fastify.get('/', async (_request, reply) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zoom Participant Bot — Live Screen & Diagnostics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #090d16;
      --card-bg: rgba(18, 26, 43, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-blue: #3b82f6;
      --accent-cyan: #06b6d4;
      --accent-green: #10b981;
      --accent-yellow: #f59e0b;
      --accent-red: #ef4444;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at 50% 0%, #172554 0%, var(--bg-dark) 60%);
      color: var(--text-main);
      min-height: 100vh;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .container {
      width: 100%;
      max-width: 1320px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 24px;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    }

    .logo-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .logo-badge {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.4);
    }

    .logo-text h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(to right, #ffffff, #93c5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .logo-text p {
      font-size: 13px;
      color: var(--text-muted);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-green);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 10px var(--accent-green);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .btn {
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      color: #fff;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
    }

    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(37, 99, 235, 0.45);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-main);
      border: 1px solid var(--card-border);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    /* Main Grid */
    .grid {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 20px;
    }

    @media (max-width: 1024px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    /* Screen Card */
    .screen-card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }

    .card-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .live-tag {
      background: #ef4444;
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      letter-spacing: 0.05em;
      animation: pulse 1.5s infinite;
    }

    .screen-viewport {
      position: relative;
      width: 100%;
      background: #000;
      aspect-ratio: 16 / 9;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .screen-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      transition: opacity 0.2s ease;
    }

    .screen-overlay {
      position: absolute;
      bottom: 16px;
      left: 16px;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(10px);
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      color: #93c5fd;
      display: flex;
      gap: 16px;
    }

    /* Sidebar Stats */
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .panel {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }

    .panel h2 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 13px;
    }

    .stat-row:last-child {
      border-bottom: none;
    }

    .stat-label {
      color: var(--text-muted);
    }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      color: #ffffff;
    }

    .badge-status {
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .badge-connected { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-waiting { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge-connecting { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge-idle { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; }

    .help-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8));
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 16px;
      padding: 16px;
      font-size: 13px;
      line-height: 1.5;
      color: #cbd5e1;
    }

    .help-card strong {
      color: #93c5fd;
      display: block;
      margin-bottom: 4px;
    }

    /* Auto-refresh Switch */
    .toggle-group {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
    }

    .switch input { opacity: 0; width: 0; height: 0; }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .3s;
      border-radius: 22px;
      border: 1px solid var(--card-border);
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 16px; width: 16px;
      left: 2px; bottom: 2px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }

    input:checked + .slider { background-color: var(--accent-blue); }
    input:checked + .slider:before { transform: translateX(18px); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-group">
        <div class="logo-badge">🎥</div>
        <div class="logo-text">
          <h1>Zoom Participant Live Monitor</h1>
          <p>Real-Time Visual Screencast &amp; Diagnostic Center</p>
        </div>
      </div>
      <div class="header-actions">
        <div class="status-pill">
          <div class="status-dot"></div>
          <span id="headerStatusText">Service Active</span>
        </div>
        <button class="btn btn-secondary" onclick="refreshScreen()">🔄 Refresh</button>
      </div>
    </header>

    <div class="grid">
      <!-- Main Visual Screen -->
      <div class="screen-card">
        <div class="card-header">
          <div class="card-title">
            <span>📺 Headless Browser Display (1280x720)</span>
            <span class="live-tag" id="liveTag">LIVE</span>
          </div>
          <div class="toggle-group">
            <button id="takeControlBtn" class="btn btn-primary" style="display: none; background: #f59e0b; box-shadow: none;">⚠️ Needs Help: Take Control</button>
            <span>Live Stream</span>
            <label class="switch">
              <input type="checkbox" id="autoRefreshToggle" checked>
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="screen-viewport">
          <img id="liveScreen" class="screen-image" src="/api/live/screen" alt="Zoom Bot Live Screencast">
          <div class="screen-overlay">
            <span id="fpsOverlay">FPS: 5.0</span>
            <span id="framesOverlay">Frames: 0</span>
            <span id="lastUpdateOverlay">Updated: Just now</span>
          </div>
        </div>
      </div>

      <!-- Diagnostic Sidebar -->
      <div class="sidebar">
        <div class="panel">
          <h2>📊 Live Session State</h2>
          <div class="stat-row">
            <span class="stat-label">Bot State</span>
            <span id="stateBadge" class="badge-status badge-idle">IDLE</span>
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
            <span class="stat-label">Frames Captured</span>
            <span class="stat-value" id="frameCountVal">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Screen Recorder</span>
            <span class="stat-value" id="recorderStatusVal">Ready</span>
          </div>
        </div>

        <div class="help-card">
          <strong>💡 Diagnostic Guide:</strong>
          • If you see the <i>Waiting Room</i> screen above, click <b>Admit</b> in your Zoom host window.<br>
          • The bot will join audio and begin recording automatically.<br>
          • Send <code>/stop</code> in Telegram at any time to receive the finalized MP4 recording.
        </div>
      </div>
    </div>

    <!-- Saved Database Recordings Section -->
    <div class="panel" style="margin-top: 20px;">
      <h2>📼 Saved Video Recordings (Stored in PostgreSQL Database)</h2>
      <div id="recordingsList" style="display: grid; gap: 10px; margin-top: 12px;">
        <div style="color: var(--text-muted); font-size: 13px;">Loading database recordings...</div>
      </div>
    </div>
  </div>

  <script>
    const screenImg = document.getElementById('liveScreen');
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    const stateBadge = document.getElementById('stateBadge');
    const meetingIdVal = document.getElementById('meetingIdVal');
    const displayNameVal = document.getElementById('displayNameVal');
    const frameCountVal = document.getElementById('frameCountVal');
    const framesOverlay = document.getElementById('framesOverlay');
    const lastUpdateOverlay = document.getElementById('lastUpdateOverlay');
    const recorderStatusVal = document.getElementById('recorderStatusVal');
    const takeControlBtn = document.getElementById('takeControlBtn');

    let isControlling = false;
    let ws = null;

    function initWebSocket() {
      if (ws) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/api/live/control`);
      ws.onopen = () => console.log('WebSocket connected');
      ws.onclose = () => { console.log('WebSocket disconnected'); ws = null; };
    }

    takeControlBtn.addEventListener('click', () => {
      isControlling = !isControlling;
      if (isControlling) {
        initWebSocket();
        takeControlBtn.style.background = '#10b981';
        takeControlBtn.textContent = '✅ Controlling (Click to Release)';
        screenImg.style.cursor = 'crosshair';
      } else {
        takeControlBtn.style.background = '#f59e0b';
        takeControlBtn.textContent = '⚠️ Needs Help: Take Control';
        screenImg.style.cursor = 'default';
      }
    });

    function sendWsEvent(event) {
      if (ws && ws.readyState === 1 && isControlling) {
        ws.send(JSON.stringify(event));
      }
    }

    screenImg.addEventListener('mousedown', (e) => {
      if (!isControlling) return;
      e.preventDefault();
      const rect = screenImg.getBoundingClientRect();
      sendWsEvent({ type: 'mousedown', x: (e.clientX - rect.left) * (1280 / rect.width), y: (e.clientY - rect.top) * (720 / rect.height) });
    });
    screenImg.addEventListener('mouseup', (e) => {
      if (!isControlling) return;
      e.preventDefault();
      const rect = screenImg.getBoundingClientRect();
      sendWsEvent({ type: 'mouseup', x: (e.clientX - rect.left) * (1280 / rect.width), y: (e.clientY - rect.top) * (720 / rect.height) });
    });
    screenImg.addEventListener('mousemove', (e) => {
      if (!isControlling) return;
      const rect = screenImg.getBoundingClientRect();
      sendWsEvent({ type: 'mousemove', x: (e.clientX - rect.left) * (1280 / rect.width), y: (e.clientY - rect.top) * (720 / rect.height) });
    });
    screenImg.addEventListener('click', (e) => {
      if (!isControlling) return;
      e.preventDefault();
      const rect = screenImg.getBoundingClientRect();
      sendWsEvent({ type: 'click', x: (e.clientX - rect.left) * (1280 / rect.width), y: (e.clientY - rect.top) * (720 / rect.height) });
    });
    
    document.addEventListener('keydown', (e) => {
      if (!isControlling) return;
      e.preventDefault();
      sendWsEvent({ type: 'keydown', key: e.key });
    });
    document.addEventListener('keyup', (e) => {
      if (!isControlling) return;
      e.preventDefault();
      sendWsEvent({ type: 'keyup', key: e.key });
    });

    function refreshScreen() {
      const timestamp = Date.now();
      screenImg.src = '/api/live/screen?t=' + timestamp;
      lastUpdateOverlay.textContent = 'Updated: ' + new Date().toLocaleTimeString();
    }

    async function pollStatus() {
      try {
        const res = await fetch('/api/live/status');
        if (res.ok) {
          const data = await res.json();
          if (data.active) {
            meetingIdVal.textContent = data.zoomMeetingId || '—';
            displayNameVal.textContent = data.displayName || 'Assistant';
            frameCountVal.textContent = data.frameCount || 0;
            framesOverlay.textContent = 'Frames: ' + (data.frameCount || 0);
            recorderStatusVal.textContent = '🟢 Recording Active';

            if (data.status === 'CONNECTED') {
              stateBadge.textContent = 'CONNECTED';
              stateBadge.className = 'badge-status badge-connected';
            } else if (data.status === 'WAITING_ROOM') {
              stateBadge.textContent = 'WAITING ROOM';
              stateBadge.className = 'badge-status badge-waiting';
            } else {
              stateBadge.textContent = 'CONNECTING';
              stateBadge.className = 'badge-status badge-connecting';
            }

            if (data.needsHumanInteraction && !isControlling) {
              takeControlBtn.style.display = 'inline-flex';
            } else if (!data.needsHumanInteraction && !isControlling) {
              takeControlBtn.style.display = 'none';
            }
          } else {
            meetingIdVal.textContent = '—';
            displayNameVal.textContent = '—';
            frameCountVal.textContent = '0';
            framesOverlay.textContent = 'Frames: 0';
            recorderStatusVal.textContent = 'Ready';
            stateBadge.textContent = 'IDLE';
            stateBadge.className = 'badge-status badge-idle';
            takeControlBtn.style.display = 'none';
          }
        }
      } catch (err) {
        console.warn('Status poll error', err);
      }
    }

    async function loadRecordings() {
      const container = document.getElementById('recordingsList');
      if (!container) return;
      try {
        const res = await fetch('/api/recordings');
        if (res.ok) {
          const items = await res.json();
          if (items.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">No recorded meetings stored in database yet. Join and stop a meeting to view recordings here!</div>';
            return;
          }
          container.innerHTML = items.map(function(item) {
            var sizeMb = (item.fileSize / (1024 * 1024)).toFixed(2);
            var recDate = new Date(item.createdAt).toLocaleString();
            return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--card-border); border-radius: 12px;">' +
              '<div>' +
                '<div style="font-weight: 600; font-size: 14px; color: #fff;">Zoom Meeting: <code>' + item.zoomMeetingId + '</code></div>' +
                '<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Size: ' + sizeMb + ' MB • Recorded: ' + recDate + '</div>' +
              '</div>' +
              '<div style="display: flex; gap: 10px;">' +
                '<a href="/api/recordings/' + item.id + '/download" target="_blank" class="btn btn-primary" style="font-size: 12px; padding: 6px 12px;">▶️ Watch / Download</a>' +
              '</div>' +
            '</div>';
          }).join('');
        }
      } catch (e) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">Could not load database recordings.</div>';
      }
    }

    // Auto-refresh loop every 1 second
    setInterval(() => {
      if (autoRefreshToggle.checked) {
        refreshScreen();
        pollStatus();
      }
    }, 1000);

    // Refresh recordings list every 10 seconds
    setInterval(loadRecordings, 10000);

    pollStatus();
    loadRecordings();
  </script>
</body>
</html>
    `;
    return reply.type('text/html').send(html.trim());
  });
};
