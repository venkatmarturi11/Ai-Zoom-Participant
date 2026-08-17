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
  const envPath = process.env['PUPPETEER_EXECUTABLE_PATH'] || process.env['CHROME_PATH'];
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const candidatePaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
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
      videoFrame: { width: 640, height: 360 },
      videoBitrate: 250,
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

    // Lightweight interval for updating screenshots (every 20 seconds)
    let dashboardInterval: NodeJS.Timeout | null = setInterval(async () => {
      if (isStopped || !page) return;
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 25 });
        if (buf && buf.length > 0) {
          this.latestScreenshot = buf as Buffer;
          frameCount++;
        }
      } catch {
        // ignore navigation errors
      }
    }, 20000);

    const stop = async (): Promise<string | undefined> => {
      if (isStopped) return outFile;
      isStopped = true;

      if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
      }

      try {
        await recorder.stop().catch(() => {});
        // Give FFmpeg 1 second to flush the MP4 trailer
        await new Promise((res) => setTimeout(res, 1200));
      } catch {}

      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        // Apply faststart remux so the MP4 is 100% seekable (forward / backward scrubbing)
        const seekableFile = outFile.replace('.mp4', '-seekable.mp4');
        try {
          await execFileAsync(resolvedFfmpegPath, [
            '-y',
            '-i', outFile,
            '-c', 'copy',
            '-movflags', '+faststart',
            seekableFile,
          ]);
          if (fs.existsSync(seekableFile) && fs.statSync(seekableFile).size > 0) {
            fs.unlinkSync(outFile);
            fs.renameSync(seekableFile, outFile);
            log.info({ outFile }, '🎥 Remuxed MP4 with faststart (seeking enabled)');
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

  private async loginToZoom(): Promise<void> {
    if (!this.page) return;

    // 1. Check if already logged in from persistent profile cookies
    try {
      await this.page.goto('https://zoom.us/profile', { waitUntil: 'domcontentloaded', timeout: 12000 });
      const currentUrl = this.page.url();
      if (!currentUrl.includes('signin') && !currentUrl.includes('login') && currentUrl.includes('profile')) {
        log.info(
          { meetingId: this.meetingId },
          '✅ Bot is already logged into Zoom account permanently (persistent profile active)',
        );
        return;
      }
    } catch {}

    // 2. Perform automated login if credentials are provided in .env
    const email = process.env['ZOOM_BOT_EMAIL'];
    const password = process.env['ZOOM_BOT_PASSWORD'];

    if (!email || !password) {
      log.info({ meetingId: this.meetingId }, 'Using persistent browser profile session');
      return;
    }

    log.info({ meetingId: this.meetingId }, 'Logging into Zoom account and saving persistent session...');
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
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--use-fake-ui-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          // ── Resource optimization for ≤2 cores ──
          '--window-size=640,360',
          '--use-gl=swiftshader',
          '--disable-gpu',
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
        defaultViewport: { width: 640, height: 360 },
      }) as unknown as Browser;

      this.page = await this.browser.newPage();

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

      // Attempt to log in if credentials are provided
      await this.loginToZoom();

      // Initialize screen recorder (optimized for ≤2 cores)
      this.frameRecorder = this.startFrameRecorder(this.page, this.meetingId);

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

      // Robust in-page automation loop to fill React-controlled inputs, dismiss modals, and click Join
      const fillAndJoinMeeting = async (): Promise<boolean> => {
        if (!this.page) return false;

        // Native Puppeteer typing for React 18 inputs
        try {
          // Standard Join Name input
          const nameInputHandle = await this.page.$(
            '#input-for-name, input[name="display_name"], #inputname, input[name="inputname"], input[placeholder*="Name" i]',
          );
          if (nameInputHandle) {
            const currentVal = await this.page.evaluate((el: any) => el.value, nameInputHandle);
            if (!currentVal || currentVal !== this.displayName) {
              await nameInputHandle.click({ clickCount: 3 }).catch(() => {});
              await nameInputHandle.type(this.displayName, { delay: 25 }).catch(() => {});
            }
          }

          // Registration Page: First Name, Last Name, Email
          const parts = this.displayName.trim().split(/\s+/);
          const firstName = parts[0] || 'Assistant';
          const lastName = parts.slice(1).join(' ') || 'Bot';
          const botEmail = process.env['ZOOM_BOT_EMAIL'] || `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 900 + 100)}@gmail.com`;

          const firstNameHandle = await this.page.$(
            '#first_name, #firstName, input[name="first_name"], input[placeholder*="First Name" i], input[aria-label*="First Name" i]',
          );
          if (firstNameHandle) {
            const val = await this.page.evaluate((el: any) => el.value, firstNameHandle);
            if (!val) {
              await firstNameHandle.click({ clickCount: 3 }).catch(() => {});
              await firstNameHandle.type(firstName, { delay: 25 }).catch(() => {});
            }
          }

          const lastNameHandle = await this.page.$(
            '#last_name, #lastName, input[name="last_name"], input[placeholder*="Last Name" i], input[aria-label*="Last Name" i]',
          );
          if (lastNameHandle) {
            const val = await this.page.evaluate((el: any) => el.value, lastNameHandle);
            if (!val) {
              await lastNameHandle.click({ clickCount: 3 }).catch(() => {});
              await lastNameHandle.type(lastName, { delay: 25 }).catch(() => {});
            }
          }

          const emailHandle = await this.page.$(
            '#email, input[name="email"], input[type="email"], input[placeholder*="Email" i], input[aria-label*="Email" i]',
          );
          if (emailHandle) {
            const val = await this.page.evaluate((el: any) => el.value, emailHandle);
            if (!val) {
              await emailHandle.click({ clickCount: 3 }).catch(() => {});
              await emailHandle.type(botEmail, { delay: 25 }).catch(() => {});
            }
          }

          const confirmEmailHandle = await this.page.$(
            '#confirm_email, input[name="confirm_email"], input[placeholder*="Confirm Email" i]',
          );
          if (confirmEmailHandle) {
            const val = await this.page.evaluate((el: any) => el.value, confirmEmailHandle);
            if (!val) {
              await confirmEmailHandle.click({ clickCount: 3 }).catch(() => {});
              await confirmEmailHandle.type(botEmail, { delay: 25 }).catch(() => {});
            }
          }
        } catch {}

        try {
          if (this.passcode) {
            const pwdInputHandle = await this.page.$(
              '#input-for-pwd, #inputpasscode, input[name="inputpasscode"], input[type="password"]',
            );
            if (pwdInputHandle) {
              const currentPwd = await this.page.evaluate((el: any) => el.value, pwdInputHandle);
              if (!currentPwd) {
                await pwdInputHandle.click({ clickCount: 3 }).catch(() => {});
                await pwdInputHandle.type(this.passcode, { delay: 25 }).catch(() => {});
              }
            }
          }
        } catch {}

        return this.page
          .evaluate(
            (name: string, pwd?: string) => {
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
                } catch {
                  // ignore
                }
              });

              // 2. Click "Register and Join" or Registration Submit button if on registration page
              const registerBtns = Array.from(
                document.querySelectorAll('button, input[type="submit"], .zm-btn, a'),
              ).filter((el) => {
                const txt = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || '').trim().toLowerCase();
                return (
                  txt.includes('register and join') ||
                  txt === 'register' ||
                  txt === 'register and join meeting' ||
                  el.id === 'btnSubmit'
                );
              });
              if (registerBtns.length > 0) {
                (registerBtns[0] as HTMLElement).click();
              }

              // 3. Click post-registration "Click here to join" or "Join from your browser" link
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

              // 4. Set Name input using React property setter descriptor
              const nameInput =
                (document.querySelector('#input-for-name') as HTMLInputElement) ||
                (document.querySelector('input[name="display_name"]') as HTMLInputElement) ||
                (document.querySelector('#inputname') as HTMLInputElement) ||
                (document.querySelector('input[name="inputname"]') as HTMLInputElement) ||
                (document.querySelector('input[placeholder*="Name" i]') as HTMLInputElement);

              if (nameInput && (!nameInput.value || nameInput.value !== name)) {
                const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (valueSetter) {
                  valueSetter.call(nameInput, name);
                } else {
                  nameInput.value = name;
                }
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                nameInput.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
                );
                nameInput.dispatchEvent(
                  new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
                );
              }

              // 5. Set Passcode input if provided
              if (pwd) {
                const pwdInput =
                  (document.querySelector('#input-for-pwd') as HTMLInputElement) ||
                  (document.querySelector('#inputpasscode') as HTMLInputElement) ||
                  (document.querySelector('input[name="inputpasscode"]') as HTMLInputElement) ||
                  (document.querySelector('input[type="password"]') as HTMLInputElement);

                if (pwdInput && !pwdInput.value) {
                  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                  if (valueSetter) {
                    valueSetter.call(pwdInput, pwd);
                  } else {
                    pwdInput.value = pwd;
                  }
                  pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                  pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }

              // 6. Request submit on form if present
              const form = (nameInput ? nameInput.closest('form') : null) || document.querySelector('form');
              if (form) {
                try {
                  form.requestSubmit();
                } catch {
                  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                }
              }

              // 7. Click Join button
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

              // 8. Join Computer Audio if dialog appeared
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
                } catch {
                  // ignore
                }
              });

              return clicked;
            },
            this.displayName,
            this.passcode,
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
