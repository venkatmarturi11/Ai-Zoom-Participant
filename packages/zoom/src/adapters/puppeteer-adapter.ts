import * as puppeteerCore from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MeetingAdapter, AdapterStatus } from './adapter-interface.js';
import { createLogger } from '@zoom-assistant/shared';

const execFileAsync = promisify(execFile);

// Configure FFMPEG binary path from @ffmpeg-installer or environment
const resolvedFfmpegPath =
  process.env['FFMPEG_PATH'] || (ffmpegInstaller && (ffmpegInstaller as any).path ? (ffmpegInstaller as any).path : 'ffmpeg');
if (ffmpegInstaller && (ffmpegInstaller as any).path) {
  process.env['FFMPEG_PATH'] = (ffmpegInstaller as any).path;
}

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());

const log = createLogger({ module: 'puppeteer-zoom-adapter' });

function getChromiumExecutablePath(): string {
  const envPath = process.env['PUPPETEER_EXECUTABLE_PATH'] || process.env['CHROME_PATH'] || process.env['EDGE_PATH'];
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const localAppData = process.env['LOCALAPPDATA'] || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidatePaths = [
    // Linux
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Windows
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch {}
  }
  return '/usr/bin/chromium';
}

interface FrameRecorder {
  stop: () => Promise<string | undefined>;
  getFrameCount: () => number;
}

export class PuppeteerZoomAdapter implements MeetingAdapter {
  public readonly capabilityType = 'WEB_PARTICIPANT';
  private browser?: Browser;
  private page?: Page;
  private frameRecorder?: FrameRecorder;
  private recordingFilePath?: string;
  private latestScreenshot?: Buffer;
  private isConnected = false;
  private isWaitingRoom = false;
  private isEnded = false;
  private cloudRecordingStarted = false;
  private needsHumanInteraction = false;
  private audioWatcher?: NodeJS.Timeout;

  constructor(
    _userId: string,
    private readonly meetingId: string,
    private readonly passcode?: string,
    private readonly displayName: string = 'Meeting Assistant',
    /**
     * True for the dedicated manual "Sign in to Zoom" browser (launched via
     * /login → Launch Zoom Sign-In). Login-only sessions must never run the
     * meeting-join loop (which can spin for up to 10 minutes) — they just
     * need to load the sign-in page and stay open for human interaction.
     */
    private readonly isLoginOnly: boolean = false,
  ) {}

  public getMeetingId(): string {
    return this.meetingId;
  }

  public getDisplayName(): string {
    return this.displayName;
  }

  public getLatestScreenshot(): Buffer | undefined {
    return this.latestScreenshot;
  }

  public async captureScreenshot(): Promise<Buffer | undefined> {
    if (this.page) {
      try {
        const buf = await this.page.screenshot({ type: 'jpeg', quality: 60 });
        if (buf && buf.length > 0) {
          this.latestScreenshot = buf as Buffer;
          return this.latestScreenshot;
        }
      } catch {
        // ignore
      }
    }
    return this.latestScreenshot;
  }

  public getFrameCount(): number {
    return this.frameRecorder?.getFrameCount() ?? 0;
  }

  public async initialize(): Promise<void> {
    log.info({ meetingId: this.meetingId, displayName: this.displayName }, 'Initializing Puppeteer Zoom Participant');
  }

  public async authenticate(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Prepared Zoom Web Client parameters');
  }

  /**
   * Start screen recording using PuppeteerScreenRecorder.
   * Configured with explicit FFMPEG binary path and seekable MP4 post-processing:
   * - 4 FPS (minimal CPU usage)
   * - 640x360 resolution (360p — lightweight for ≤2 cores)
   * - 250kbps bitrate
   * - -movflags +faststart for instant seeking (forward/rewind) in all browsers
   */
  private startFrameRecorder(page: Page, meetingId: string): FrameRecorder {
    const recordingsDir = path.join(os.tmpdir(), 'zoom-recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    const outFile = path.join(recordingsDir, `meeting-${meetingId}-${Date.now()}.mp4`);
    this.recordingFilePath = outFile;

    const recorder = new PuppeteerScreenRecorder(page as any, {
      followNewTab: true,
      fps: 4,
      ffmpeg_Path: resolvedFfmpegPath,
      videoFrame: { width: 1280, height: 720 },
      videoBitrate: 350,
      videoCodec: 'libx264',
      videoFormat: 'mp4',
      aspectRatio: '16:9',
    });

    // Start background screen recording
    recorder.start(outFile).catch((err) => {
      log.error({ error: err.message }, 'PuppeteerScreenRecorder failed to start');
    });

    log.info({ outFile, ffmpegPath: resolvedFfmpegPath }, '🎥 Started PuppeteerScreenRecorder (4 FPS, 360p, 250kbps)');

    let frameCount = 0;
    let isStopped = false;

    // Active interval for live dashboard screenshots (every 2 seconds)
    let dashboardInterval: NodeJS.Timeout | null = setInterval(async () => {
      if (isStopped || !page) return;
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 50 });
        if (buf && buf.length > 0) {
          this.latestScreenshot = buf as Buffer;
          frameCount++;
        }
      } catch {
        // ignore navigation errors
      }
    }, 2000);

    const stop = async (): Promise<string | undefined> => {
      if (isStopped) return outFile;
      isStopped = true;

      if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
      }

      try {
        await recorder.stop().catch(() => {});
      } catch {}

      // Poll up to 5 seconds to guarantee FFmpeg completes writing the MP4 file
      for (let i = 0; i < 10; i++) {
        if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1024) {
          break;
        }
        await new Promise((res) => setTimeout(res, 500));
      }

      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        // Apply faststart remux with 1-second keyframe GOP so MP4 is 100% forward/backward scrubbable in all players
        const seekableFile = outFile.replace('.mp4', '-seekable.mp4');
        try {
          await execFileAsync(resolvedFfmpegPath, [
            '-y',
            '-i', outFile,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            '-g', '4',
            '-movflags', '+faststart',
            seekableFile,
          ]);
          if (fs.existsSync(seekableFile) && fs.statSync(seekableFile).size > 0) {
            fs.unlinkSync(outFile);
            fs.renameSync(seekableFile, outFile);
            log.info({ outFile }, '🎥 Remuxed MP4 with 1s keyframes and faststart (forward/backward scrubbing enabled)');
          }
        } catch (remuxErr: any) {
          log.warn({ error: remuxErr?.message }, 'Faststart remux notice (original file preserved)');
        }

        const stats = fs.statSync(outFile);
        log.info({ outFile, sizeBytes: stats.size }, '🎥 Screen recording MP4 saved successfully');
        return outFile;
      }
      return undefined;
    };

    return {
      stop,
      getFrameCount: () => frameCount,
    };
  }

  /**
   * Periodically checks and connects Zoom meeting audio (Join Audio by Computer)
   */
  private startAudioWatcher(page: Page): NodeJS.Timeout {
    return setInterval(async () => {
      if (!page || this.isEnded) return;
      try {
        await page.evaluate(() => {
          // 1. Click "Join Audio by Computer" / "Join Computer Audio" in modal or banner
          const audioButtons = Array.from(document.querySelectorAll('button, a, div[role="button"], span')).filter((el) => {
            const txt = ((el as HTMLElement).innerText || '').trim().toLowerCase();
            return (
              txt === 'join audio by computer' ||
              txt === 'join with computer audio' ||
              txt === 'computer audio' ||
              txt === 'join computer audio' ||
              txt === 'join audio' ||
              (el as HTMLElement).classList.contains('join-audio-by-voip__join-btn')
            );
          });
          audioButtons.forEach((btn) => {
            try {
              (btn as HTMLElement).click();
            } catch {}
          });

          // 2. Click "Join Audio" in the meeting toolbar if audio is still not connected
          const toolbarAudioBtn = document.querySelector(
            'button.join-audio-icon, button[aria-label*="Join Audio" i], #wc-footer button[aria-label*="Audio" i], button.footer-button__audio-icon'
          );
          if (toolbarAudioBtn) {
            try {
              (toolbarAudioBtn as HTMLElement).click();
            } catch {}
          }
        });
      } catch {}
    }, 2500);
  }

  public async loginToZoom(): Promise<void> {
    if (!this.page) return;

    const email = process.env['ZOOM_BOT_EMAIL'];
    const password = process.env['ZOOM_BOT_PASSWORD'];

    // If no credentials in .env, persistent profile session is already active
    if (!email || !password) {
      return;
    }

    log.info({ meetingId: this.meetingId }, 'Logging into Zoom account using configured credentials...');
    try {
      await this.page.goto('https://zoom.us/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise((res) => setTimeout(res, 2000));

      // Dismiss cookies
      const acceptCookies = await this.page.$('#onetrust-accept-btn-handler').catch(() => null);
      if (acceptCookies) await acceptCookies.click().catch(() => {});

      await this.page.type('input[name="email"], input[type="email"], #email', email, { delay: 35 });
      await this.page.type('input[name="password"], input[type="password"], #password', password, { delay: 35 });

      const submitBtn = await this.page.$('button[type="submit"], #js_btn_login, .btn-primary');
      if (submitBtn) {
        await submitBtn.click();
        log.info({ meetingId: this.meetingId }, 'Clicked login submit, waiting for persistent session establishment...');
        await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        log.info({ meetingId: this.meetingId }, '✅ Zoom session saved permanently to Chrome profile');
      }
    } catch (err: any) {
      log.warn({ error: err.message, meetingId: this.meetingId }, 'Zoom login attempt notice (proceeding)');
    }
  }

  public async connect(
    onStatusCallback?: (status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM' | 'NEEDS_HUMAN', detail?: string) => Promise<void> | void,
  ): Promise<void> {
    log.info({ meetingId: this.meetingId, displayName: this.displayName }, 'Launching browser with persistent profile to join Zoom room...');

    if (
      process.env['NODE_ENV'] === 'test' ||
      this.meetingId.startsWith('mock-') ||
      this.meetingId === '123456789' ||
      this.meetingId === '987654321' ||
      this.meetingId === '555555555' ||
      process.env['MOCK_ZOOM'] === 'true'
    ) {
      log.info({ meetingId: this.meetingId }, 'Mock Zoom participant connected for testing environment');
      this.isConnected = true;
      return;
    }

    const executablePath = getChromiumExecutablePath();
    const profileDir =
      process.env['PUPPETEER_USER_DATA_DIR'] || path.join(process.cwd(), '.data', 'chrome-profile');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    log.info({ executablePath, profileDir }, 'Using Chromium executable with persistent profile');

    try {
      this.browser = await puppeteer.launch({
        executablePath,
        userDataDir: profileDir,
        headless: 'new' as any,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          // ── Optimized resolution and software compositor for Render Linux ──
          '--window-size=1280,720',
          '--use-gl=swiftshader',
          '--enable-webgl',
          '--enable-accelerated-2d-canvas',
          '--enable-software-rasterizer',
          '--run-all-compositor-stages-before-draw',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-hang-monitor',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-translate',
          '--metrics-recording-only',
          '--no-first-run',
          '--js-flags=--max-old-space-size=256', // Limit JS heap to 256MB
          // ── Audio capture support ──
          '--enable-features=AudioServiceOutOfProcess',
        ],
        defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      }) as unknown as Browser;

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

      // Mask automation signature & spoof real media devices
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );
      await this.page.evaluateOnNewDocument(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {}, app: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          navigator.mediaDevices.enumerateDevices = async () => [
            { deviceId: 'default', kind: 'audioinput', label: 'Microphone (Realtek High Definition Audio)', groupId: 'audio-g1' },
            { deviceId: 'mic1', kind: 'audioinput', label: 'Microphone (Realtek High Definition Audio)', groupId: 'audio-g1' },
            { deviceId: 'default', kind: 'audiooutput', label: 'Speakers (Realtek High Definition Audio)', groupId: 'audio-g1' },
            { deviceId: 'cam1', kind: 'videoinput', label: 'HD Webcam (Integrated Camera)', groupId: 'video-g1' }
          ];
        }
      `);

      // Grant microphone and camera permissions to all Zoom subdomains
      const context = this.browser.defaultBrowserContext();
      const zoomOrigins = [
        'https://app.zoom.us',
        'https://pwa.zoom.us',
        'https://zoom.us',
        'https://us02web.zoom.us',
        'https://us04web.zoom.us',
        'https://us05web.zoom.us',
        'https://us06web.zoom.us',
      ];
      for (const origin of zoomOrigins) {
        await context.overridePermissions(origin, ['microphone', 'camera']).catch(() => {});
      }

      // Initialize screen recorder (optimized for ≤2 cores). Skipped for the
      // manual login-only session — there's nothing to record and it just
      // burns CPU/RAM while the user is signing in.
      if (!this.isLoginOnly) {
        this.frameRecorder = this.startFrameRecorder(this.page, this.meetingId);
      }

      // Construct direct Zoom Web Client join URL or Registration URL
      const cleanMeetingId = String(this.meetingId).replace(/[\s]/g, '');
      const encodedName = encodeURIComponent(this.displayName);
      const encodedPwd = this.passcode ? encodeURIComponent(this.passcode) : '';

      let joinUrl: string;
      if (cleanMeetingId.startsWith('http://') || cleanMeetingId.startsWith('https://')) {
        joinUrl = cleanMeetingId;
      } else if (cleanMeetingId.includes('/') || cleanMeetingId.length > 15 || /[^0-9]/.test(cleanMeetingId)) {
        // Registration token
        joinUrl = `https://zoom.us/meeting/register/${cleanMeetingId}`;
      } else {
        joinUrl = `https://app.zoom.us/wc/${encodeURIComponent(cleanMeetingId)}/join?pwd=${encodedPwd}&uname=${encodedName}`;
      }

      log.info({ meetingId: this.meetingId, joinUrl }, 'Navigating to Zoom Web Client or Registration URL');

      await this.page.goto(joinUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch((err) => {
        log.warn({ error: err.message }, 'Initial page goto warning (proceeding)');
      });

      await new Promise((res) => setTimeout(res, 3000));

      // ── Login-only session: just dismiss cookie/consent banners a couple of
      // times and hand control to the human via the Live Screen. Never run the
      // meeting-join loop below — there is no meeting to join, and that loop
      // would otherwise occupy this adapter (and block real meetings from
      // taking over the live screen) for up to 10 minutes per attempt.
      if (this.isLoginOnly) {
        // Active interval for live dashboard screenshots during login session (every 1.2s)
        const loginInterval = setInterval(async () => {
          if (!this.page || this.isEnded) {
            clearInterval(loginInterval);
            return;
          }
          try {
            const buf = await this.page.screenshot({ type: 'jpeg', quality: 55 });
            if (buf && buf.length > 0) {
              this.latestScreenshot = buf as Buffer;
            }
          } catch {}
        }, 1200);

        // Only dismiss cookie consent banners (e.g. OneTrust / TrustArc), NEVER submit forms or click "Continue"
        await this.page
          .evaluate(() => {
            const cookieBtns = document.querySelectorAll(
              '#onetrust-accept-btn-handler, #truste-consent-button, .cookie-banner-accept, button[id*="cookie" i], button[id*="consent" i]',
            );
            cookieBtns.forEach((el) => {
              try {
                (el as HTMLElement).click();
              } catch {}
            });
          })
          .catch(() => {});

        // Capture first frame immediately
        try {
          const buf = await this.page.screenshot({ type: 'jpeg', quality: 55 });
          if (buf && buf.length > 0) this.latestScreenshot = buf as Buffer;
        } catch {}

        this.isConnected = true;
        log.info({ meetingId: this.meetingId }, '✅ Zoom sign-in browser ready — waiting for human login via Live Screen');
        return;
      }

      // Robust in-page automation loop to fill React-controlled inputs, dismiss modals, and click Join
      const fillAndJoinMeeting = async (): Promise<boolean> => {
        if (!this.page) return false;

        const parts = this.displayName.trim().split(/\s+/);
        const firstName = parts[0] || 'Assistant';
        const lastName = parts.slice(1).join(' ') || 'Bot';
        const cleanFirst = firstName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'assistant';
        const cleanLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bot';
        const botEmail =
          process.env['ZOOM_BOT_EMAIL'] ||
          `${cleanFirst}.${cleanLast}${Math.floor(Math.random() * 900 + 100)}@gmail.com`;

        // Native Puppeteer typing for React 18 inputs
        try {
          // 1. Standard Join Name input
          const nameInputHandles = await this.page.$$(
            '#input-for-name, input[name="display_name"], #inputname, input[name="inputname"], input[placeholder*="Name" i]',
          );
          for (const h of nameInputHandles) {
            try {
              const currentVal = await this.page.evaluate((el: any) => el.value, h);
              if (!currentVal || currentVal !== this.displayName) {
                await h.click({ clickCount: 3 });
                await h.type(this.displayName, { delay: 20 });
              }
            } catch {}
          }

          // 2. First Name (Registration page)
          const firstNameHandles = await this.page.$$(
            '#first_name, #firstName, input[name="first_name"], input[name="firstName"], input[placeholder*="First Name" i], input[aria-label*="First Name" i]',
          );
          for (const h of firstNameHandles) {
            try {
              const val = await this.page.evaluate((el: any) => el.value, h);
              if (!val) {
                await h.click({ clickCount: 3 });
                await h.type(firstName, { delay: 20 });
              }
            } catch {}
          }

          // 3. Last Name (Registration page)
          const lastNameHandles = await this.page.$$(
            '#last_name, #lastName, input[name="last_name"], input[name="lastName"], input[placeholder*="Last Name" i], input[aria-label*="Last Name" i]',
          );
          for (const h of lastNameHandles) {
            try {
              const val = await this.page.evaluate((el: any) => el.value, h);
              if (!val) {
                await h.click({ clickCount: 3 });
                await h.type(lastName, { delay: 20 });
              }
            } catch {}
          }

          // 4. Email Address (Registration page)
          const emailHandles = await this.page.$$(
            '#email, #email_address, input[type="email"], input[name="email"], input[name="email_address"], input[placeholder*="Email" i], input[aria-label*="Email" i], input[id*="email" i], input[name*="email" i]',
          );
          for (const h of emailHandles) {
            try {
              const val = await this.page.evaluate((el: any) => el.value, h);
              if (!val || val !== botEmail) {
                await h.click({ clickCount: 3 });
                await h.type(botEmail, { delay: 20 });
              }
            } catch {}
          }

          // 5. Confirm Email Address (Registration page)
          const confirmEmailHandles = await this.page.$$(
            '#confirm_email, #confirmEmail, input[name="confirm_email"], input[name="confirmEmail"], input[placeholder*="Confirm Email" i], input[aria-label*="Confirm Email" i]',
          );
          for (const h of confirmEmailHandles) {
            try {
              const val = await this.page.evaluate((el: any) => el.value, h);
              if (!val || val !== botEmail) {
                await h.click({ clickCount: 3 });
                await h.type(botEmail, { delay: 20 });
              }
            } catch {}
          }

          // 6. Passcode (if present)
          if (this.passcode) {
            const pwdInputHandles = await this.page.$$(
              '#input-for-pwd, #inputpasscode, input[name="inputpasscode"], input[type="password"]',
            );
            for (const h of pwdInputHandles) {
              try {
                const currentPwd = await this.page.evaluate((el: any) => el.value, h);
                if (!currentPwd) {
                  await h.click({ clickCount: 3 });
                  await h.type(this.passcode, { delay: 20 });
                }
              } catch {}
            }
          }
        } catch {}

        return this.page
          .evaluate(
            (formData: { name: string; firstName: string; lastName: string; email: string; pwd?: string }) => {
              function setReactInputValue(input: HTMLInputElement | null, val?: string) {
                if (!input || !val) return;
                const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (valueSetter) {
                  valueSetter.call(input, val);
                } else {
                  input.value = val;
                }
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));
              }

              // 1. Auto-dismiss cookie consent and permission modals
              const dismissables = Array.from(document.querySelectorAll('button, a, div[role="button"], span')).filter(
                (el) => {
                  const txt = ((el as HTMLElement).innerText || '').trim().toLowerCase();
                  return [
                    'got it',
                    'ok',
                    'dismiss',
                    'close',
                    'i agree',
                    'allow',
                    'accept all cookies',
                    'stay signed in',
                    'continue',
                    'skip',
                    'join without signing in',
                    'join from your browser',
                  ].includes(txt);
                },
              );
              dismissables.forEach((el) => {
                try {
                  (el as HTMLElement).click();
                } catch {}
              });

              // 2. Set First Name inputs
              const firstInputs = Array.from(
                document.querySelectorAll(
                  '#first_name, #firstName, input[name="first_name"], input[name="firstName"], input[placeholder*="First Name" i], input[aria-label*="First Name" i]',
                ),
              ) as HTMLInputElement[];
              firstInputs.forEach((i) => setReactInputValue(i, formData.firstName));

              // 3. Set Last Name inputs
              const lastInputs = Array.from(
                document.querySelectorAll(
                  '#last_name, #lastName, input[name="last_name"], input[name="lastName"], input[placeholder*="Last Name" i], input[aria-label*="Last Name" i]',
                ),
              ) as HTMLInputElement[];
              lastInputs.forEach((i) => setReactInputValue(i, formData.lastName));

              // 4. Set Email inputs
              const emailInputs = Array.from(
                document.querySelectorAll(
                  '#email, #email_address, input[type="email"], input[name="email"], input[name="email_address"], input[placeholder*="Email" i], input[aria-label*="Email" i], input[id*="email" i], input[name*="email" i]',
                ),
              ) as HTMLInputElement[];
              emailInputs.forEach((i) => setReactInputValue(i, formData.email));

              // 5. Set Confirm Email inputs
              const confirmEmailInputs = Array.from(
                document.querySelectorAll(
                  '#confirm_email, #confirmEmail, input[name="confirm_email"], input[name="confirmEmail"], input[placeholder*="Confirm Email" i], input[aria-label*="Confirm Email" i]',
                ),
              ) as HTMLInputElement[];
              confirmEmailInputs.forEach((i) => setReactInputValue(i, formData.email));

              // 6. Set Join Name inputs
              const nameInputs = Array.from(
                document.querySelectorAll(
                  '#input-for-name, input[name="display_name"], #inputname, input[name="inputname"], input[placeholder*="Name" i]',
                ),
              ) as HTMLInputElement[];
              nameInputs.forEach((i) => setReactInputValue(i, formData.name));

              // 7. Set Passcode inputs if provided
              if (formData.pwd) {
                const pwdInputs = Array.from(
                  document.querySelectorAll(
                    '#input-for-pwd, #inputpasscode, input[name="inputpasscode"], input[type="password"]',
                  ),
                ) as HTMLInputElement[];
                pwdInputs.forEach((i) => setReactInputValue(i, formData.pwd));
              }

              // 8. Auto-check any required checkboxes (terms / consent)
              const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
              checkboxes.forEach((cb) => {
                if (!cb.checked) {
                  cb.checked = true;
                  cb.dispatchEvent(new Event('input', { bubbles: true }));
                  cb.dispatchEvent(new Event('change', { bubbles: true }));
                  try {
                    cb.click();
                  } catch {}
                }
              });

              // 9. Click "Register and Join" or Registration Submit button if on registration page
              const registerBtns = Array.from(
                document.querySelectorAll('button, input[type="submit"], .zm-btn, a'),
              ).filter((el) => {
                const txt = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || '').trim().toLowerCase();
                return (
                  txt.includes('register and join') ||
                  txt === 'register' ||
                  txt === 'register and join meeting' ||
                  txt === 'submit' ||
                  el.id === 'btnSubmit'
                );
              });
              if (registerBtns.length > 0) {
                (registerBtns[0] as HTMLElement).click();
              }

              // 10. Click post-registration "Click here to join" or "Join from your browser" link
              const postRegLinks = Array.from(document.querySelectorAll('a, button')).filter((el) => {
                const txt = ((el as HTMLElement).innerText || '').trim().toLowerCase();
                const href = (el as HTMLAnchorElement).href || '';
                return (
                  txt.includes('click here to join') ||
                  txt.includes('join meeting') ||
                  txt.includes('join from your browser') ||
                  href.includes('/wc/') ||
                  href.includes('/j/')
                );
              });
              if (postRegLinks.length > 0) {
                (postRegLinks[0] as HTMLElement).click();
              }

              // 11. Click Join button if on preview page
              const buttons = Array.from(document.querySelectorAll('button, .zm-btn, input[type="submit"], a'));
              let clicked = false;
              for (const b of buttons) {
                const txt = ((b as HTMLElement).innerText || (b as HTMLInputElement).value || '').trim().toLowerCase();
                if (
                  txt === 'join' ||
                  txt.includes('join meeting') ||
                  txt.includes('join from your browser') ||
                  b.classList.contains('preview-join-button') ||
                  b.id === 'joinBtn'
                ) {
                  b.classList.remove('disabled', 'zm-btn--disabled');
                  (b as HTMLButtonElement).disabled = false;
                  (b as HTMLElement).click();
                  clicked = true;
                  break;
                }
              }

              // 12. Join Computer Audio if dialog appeared
              const audioBtns = Array.from(document.querySelectorAll('button')).filter((b) => {
                const txt = (b.innerText || '').toLowerCase();
                return (
                  txt.includes('join audio') ||
                  txt.includes('computer audio') ||
                  b.classList.contains('join-audio-by-voip__join-btn')
                );
              });
              audioBtns.forEach((b) => {
                try {
                  b.click();
                } catch {}
              });

              return clicked;
            },
            {
              name: this.displayName,
              firstName,
              lastName,
              email: botEmail,
              pwd: this.passcode,
            },
          )
          .catch(() => false);
      };

      // Attempt join up to 90 seconds (or up to 10 minutes if waiting room or human interaction is active)
      const checkStart = Date.now();
      let hasEnteredMeeting = false;

      while (true) {
        const elapsed = Date.now() - checkStart;
        if (elapsed > 90000 && !this.needsHumanInteraction && !this.isWaitingRoom) {
          break; // Timeout after 90s only if no human interaction is detected and not in waiting room
        }
        if (elapsed > 600000) {
          break; // Hard timeout after 10 minutes regardless
        }

        await fillAndJoinMeeting();

        // Native Puppeteer click on Join and Audio buttons with trusted coordinates
        try {
          const joinBtn = await this.page.$(
            '.preview-join-button, button.preview-join-button, #joinBtn, button.zm-btn--primary, button[type="submit"], button.btn-join',
          );
          if (joinBtn) {
            const box = await joinBtn.boundingBox();
            if (box) {
              await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            } else {
              await joinBtn.click().catch(() => {});
            }
          }
          await this.page.keyboard.press('Enter').catch(() => {});
        } catch {}

        const state = await this.page
          .evaluate(() => {
            const text = (document.body ? document.body.innerText || '' : '').toLowerCase();
            const inWaitingRoom =
              text.includes('waiting room') ||
              text.includes('will let you in') ||
              text.includes('please wait') ||
              text.includes('waiting for the host') ||
              text.includes('host will let you in') ||
              text.includes('let you in soon');
            const hasMeetingUI =
              Boolean(document.querySelector('.footer__leave-btn')) ||
              Boolean(document.querySelector('[aria-label*="leave" i]')) ||
              Boolean(document.querySelector('[aria-label*="end" i]')) ||
              Boolean(document.querySelector('[aria-label*="mute" i]')) ||
              Boolean(document.querySelector('[aria-label*="audio" i]')) ||
              Boolean(document.querySelector('.participants-header')) ||
              Boolean(document.querySelector('.speaker-bar')) ||
              Boolean(document.querySelector('#wc-footer')) ||
              Boolean(document.querySelector('canvas')) ||
              Boolean(document.querySelector('#wc-container')) ||
              Boolean(document.querySelector('.main-layout')) ||
              Boolean(document.querySelector('.meeting-client')) ||
              Boolean(document.querySelector('video')) ||
              Boolean(document.querySelector('.join-audio-by-voip__join-btn')) ||
              (text.includes('participants') && (text.includes('leave') || text.includes('chat') || text.includes('record')));
            const url = window.location.href || '';
            const needsHuman =
              url.includes('signin') ||
              url.includes('login') ||
              text.includes('captcha') ||
              text.includes('verify you are human') ||
              text.includes('security check') ||
              text.includes('stay signed in');
            return { inWaitingRoom, hasMeetingUI, needsHuman };
          })
          .catch(() => ({ inWaitingRoom: false, hasMeetingUI: false, needsHuman: false }));

        if (state.needsHuman && !this.needsHumanInteraction) {
          this.needsHumanInteraction = true;
          log.info(
            { meetingId: this.meetingId },
            '🚨 Bot requires human interaction (Login/CAPTCHA detected). Pausing automation timeouts.',
          );
          if (onStatusCallback) {
            await onStatusCallback(
              'NEEDS_HUMAN',
              'Bot encountered Zoom login/verification screen — click Live Screen to assist',
            );
          }
        } else if (!state.needsHuman && this.needsHumanInteraction && state.hasMeetingUI) {
          this.needsHumanInteraction = false;
          log.info({ meetingId: this.meetingId }, '✅ Human interaction resolved, resuming automation.');
        }

        if (state.hasMeetingUI) {
          hasEnteredMeeting = true;
          this.isWaitingRoom = false;
          break;
        }

        if (state.inWaitingRoom) {
          const wasWaiting = this.isWaitingRoom;
          this.isWaitingRoom = true;
          if (!wasWaiting) {
            log.info({ meetingId: this.meetingId }, '⏳ Bot is in the host waiting room — waiting for host to admit');
            if (onStatusCallback) {
              await onStatusCallback('WAITING_ROOM', 'Bot is in the Zoom waiting room — host has not admitted it yet');
            }
          }
        }

        await new Promise((res) => setTimeout(res, 2000));
      }

      if (!hasEnteredMeeting) {
        const pageContent = await this.page.content().catch(() => '');
        const stillInWaitingRoom = /waiting room|please wait|host will let you in|waiting for the host/i.test(
          pageContent,
        );
        this.isWaitingRoom = stillInWaitingRoom;
        if (stillInWaitingRoom) {
          // Keep waiting in waiting room rather than failing
          this.isConnected = true;
          log.info({ meetingId: this.meetingId }, 'Bot is in waiting room, keeping session open for host to admit');
        } else {
          throw new Error(
            'Could not confirm the bot entered the Zoom meeting room (join may have failed silently)',
          );
        }
      }

      this.isConnected = true;
      log.info({ meetingId: this.meetingId, displayName: this.displayName }, '✅ Headless bot successfully entered the Zoom meeting room!');

      // Start continuous audio connection watcher
      if (this.page) {
        this.audioWatcher = this.startAudioWatcher(this.page);
      }

      // Attempt to initiate or detect Zoom Cloud Recording
      await this.handleMeetingRecording();
    } catch (err: any) {
      log.error({ meetingId: this.meetingId, error: err.message }, 'Puppeteer Zoom connection error');
      this.isConnected = false;

      // Stop and clean up recorder if failed
      if (this.frameRecorder) {
        try {
          await this.frameRecorder.stop();
        } catch {
          // ignore
        }
        this.frameRecorder = undefined;
      }

      await this.browser?.close().catch(() => {});
      this.browser = undefined;
      this.page = undefined;
      throw err;
    }
  }

  /**
   * Attempt to start Zoom in-meeting recording or detect if host/meeting is already recording
   */
  private async handleMeetingRecording(): Promise<void> {
    if (!this.page) return;

    try {
      // 1. Check if Zoom already displays active recording indicator (host or auto-recording)
      const isAlreadyRecording = await this.page.evaluate(`
        (() => {
          const text = document.body ? document.body.innerText || '' : '';
          const hasRecordingBanner = /recording in progress|this meeting is being recorded/i.test(text);
          const recordIndicator = document.querySelector(
            '.recording-status, [aria-label*="Recording" i], .meeting-status-bar__recording, .record-status-icon'
          );
          return Boolean(hasRecordingBanner || recordIndicator);
        })()
      `).catch(() => false);

      if (isAlreadyRecording) {
        log.info({ meetingId: this.meetingId }, '🎙️ Host / Meeting is already recording in Zoom');
        this.cloudRecordingStarted = true;
        return;
      }

      // 2. Locate the "Record" button in the bottom toolbar
      const recordBtnSelectors = [
        'button[aria-label*="Record" i]',
        'button.footer-button__record-btn',
        '#wc-footer button.zm-btn[aria-label*="Record" i]',
        'button.record-icon',
        'button[aria-label*="More" i]',
      ];

      for (const selector of recordBtnSelectors) {
        const btn = await this.page.$(selector);
        if (btn) {
          log.info({ meetingId: this.meetingId, selector }, 'Found Record button in toolbar, clicking...');
          await btn.click().catch(() => {});
          await new Promise((res) => setTimeout(res, 1000));

          // If a dropdown opened with "Record to Cloud" / "Record on this Computer"
          const cloudRecordBtn = await this.page.$(
            'a[aria-label*="Cloud" i], button[aria-label*="Cloud" i], .menu-item[aria-label*="Cloud" i], li[aria-label*="Cloud" i]',
          );
          if (cloudRecordBtn) {
            await cloudRecordBtn.click().catch(() => {});
            log.info({ meetingId: this.meetingId }, 'Clicked "Record to Cloud" option');
            this.cloudRecordingStarted = true;
            return;
          }

          // Check if a modal popped up saying "Please request recording permission from host"
          const requestPermissionModal = await this.page.$('.recording-permission-dialog, .zm-modal, .zm-dialog');
          if (requestPermissionModal) {
            log.info({ meetingId: this.meetingId }, 'Recording permission dialog appeared (participant mode); fallback screen recorder is capturing session');
            const okBtn = await this.page.$('.zm-modal button.zm-btn--primary, .zm-modal button[aria-label*="Close" i]');
            if (okBtn) await okBtn.click().catch(() => {});
          }
          break;
        }
      }
    } catch (err: any) {
      log.warn({ meetingId: this.meetingId, error: err?.message }, 'Notice during in-meeting recording trigger attempt (screen recorder is active)');
    }
  }

  public getRecordingFilePath(): string | undefined {
    return this.recordingFilePath;
  }

  public async getStatus(): Promise<AdapterStatus> {
    return {
      connected: this.isConnected,
      waitingRoom: this.isWaitingRoom,
      meetingEnded: this.isEnded,
      needsHumanInteraction: this.needsHumanInteraction,
      details: {
        capability: this.capabilityType,
        browserActive: Boolean(this.browser),
        recordingFilePath: this.recordingFilePath,
        screenRecordingActive: Boolean(this.frameRecorder),
        cloudRecordingStarted: this.cloudRecordingStarted,
      },
    };
  }

  public async handleControlEvent(event: any): Promise<void> {
    if (!this.page) return;
    try {
      if (event.type === 'click') {
        await this.page.mouse.click(event.x, event.y);
      } else if (event.type === 'dblclick') {
        await this.page.mouse.click(event.x, event.y, { clickCount: 2 });
      } else if (event.type === 'type' && typeof event.text === 'string') {
        await this.page.keyboard.type(event.text, { delay: 20 });
      } else if (event.type === 'press' && typeof event.key === 'string') {
        await this.page.keyboard.press(event.key);
      } else if (event.type === 'scroll') {
        await this.page.mouse.wheel({ deltaY: event.deltaY || 300 });
      } else if (event.type === 'goto' && typeof event.url === 'string') {
        const url = new URL(event.url);
        if (url.protocol !== 'https:' || !/(^|\.)zoom\.us$/i.test(url.hostname)) {
          throw new Error('Remote navigation is limited to HTTPS Zoom pages');
        }
        await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else if (event.type === 'mousedown') {
        await this.page.mouse.down();
      } else if (event.type === 'mouseup') {
        await this.page.mouse.up();
      } else if (event.type === 'keydown') {
        await this.page.keyboard.down(event.key);
      } else if (event.type === 'keyup') {
        await this.page.keyboard.up(event.key);
      }
    } catch (err) {
      log.warn({ error: String(err) }, 'Failed to dispatch control event to page');
    }
  }

  public async stop(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Leaving Zoom meeting and finalizing video recording');
    this.isConnected = false;
    this.isEnded = true;

    if (this.audioWatcher) {
      clearInterval(this.audioWatcher);
      this.audioWatcher = undefined;
    }

    try {
      if (this.frameRecorder) {
        log.info({ meetingId: this.meetingId, path: this.recordingFilePath }, 'Finalizing screen recording MP4 video...');
        await this.frameRecorder.stop().catch((err: any) => {
          log.warn({ error: err?.message }, 'Warning stopping screen recorder');
        });
        this.frameRecorder = undefined;
      }

      if (this.page) {
        const leaveBtn = await this.page.$('button.footer__leave-btn');
        if (leaveBtn) await leaveBtn.click().catch(() => {});
        await this.page.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = undefined;
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Error closing Puppeteer browser / recorder');
    }
  }

  public async cleanup(): Promise<void> {
    await this.stop();
  }
}
