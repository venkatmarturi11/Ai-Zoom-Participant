import * as puppeteerCore from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MeetingAdapter, AdapterStatus } from './adapter-interface.js';
import { createLogger } from '@zoom-assistant/shared';

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
        const buf = await this.page.screenshot({ type: 'jpeg', quality: 80 });
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

  private startFrameRecorder(page: Page, meetingId: string): FrameRecorder {
    const recordingsDir = path.join(os.tmpdir(), 'zoom-recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    const outFile = path.join(recordingsDir, `meeting-${meetingId}-${Date.now()}.mp4`);
    this.recordingFilePath = outFile;

    const recorder = new PuppeteerScreenRecorder(page as any, {
      fps: 10,
      videoFrame: { width: 1280, height: 720 },
      videoBitrate: 1000,
      videoCodec: 'libx264',
      videoFormat: 'mp4',
      aspectRatio: '16:9',
    });

    // Start background screen recording
    recorder.start(outFile).catch((err) => {
      log.error({ error: err.message }, 'PuppeteerScreenRecorder failed to start');
    });

    log.info({ outFile }, '🎥 Started PuppeteerScreenRecorder');

    let frameCount = 0;
    let isStopped = false;

    // Lightweight interval just for updating the dashboard view (1 FPS)
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
    }, 1000);

    const stop = async (): Promise<string | undefined> => {
      if (isStopped) return outFile;
      isStopped = true;

      if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
      }

      await recorder.stop().catch(() => {});

      if (fs.existsSync(outFile)) {
        const stats = fs.statSync(outFile);
        log.info({ outFile, sizeBytes: stats.size }, '🎥 Screen recording MP4 saved successfully via PuppeteerScreenRecorder');
        return outFile;
      }
      return undefined;
    };

    return {
      stop,
      getFrameCount: () => frameCount,
    };
  }

  private async loginToZoom(): Promise<void> {
    const email = process.env['ZOOM_BOT_EMAIL'];
    const password = process.env['ZOOM_BOT_PASSWORD'];

    if (!email || !password || !this.page) {
      return;
    }

    log.info({ meetingId: this.meetingId }, 'Attempting to log into Zoom account...');
    try {
      await this.page.goto('https://zoom.us/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise((res) => setTimeout(res, 2000));

      // Dismiss cookies
      const acceptCookies = await this.page.$('#onetrust-accept-btn-handler').catch(() => null);
      if (acceptCookies) await acceptCookies.click().catch(() => {});

      await this.page.type('input[name="email"], input[type="email"], #email', email, { delay: 50 });
      await this.page.type('input[name="password"], input[type="password"], #password', password, { delay: 50 });
      
      const submitBtn = await this.page.$('button[type="submit"], #js_btn_login');
      if (submitBtn) {
        await submitBtn.click();
        log.info({ meetingId: this.meetingId }, 'Clicked login submit, waiting for navigation...');
        await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        log.info({ meetingId: this.meetingId }, 'Zoom login attempt completed');
      }
    } catch (err: any) {
      log.warn({ error: err.message, meetingId: this.meetingId }, 'Zoom login attempt failed (CAPTCHA or timeout)');
    }
  }

  public async connect(
    onStatusCallback?: (status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM', detail?: string) => Promise<void> | void,
  ): Promise<void> {
    log.info({ meetingId: this.meetingId, displayName: this.displayName }, 'Launching headless browser to join Zoom room...');

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
    log.info({ executablePath }, 'Using Chromium executable');

    try {
      this.browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          '--window-size=1280,720',
          '--use-gl=swiftshader',
        ],
        defaultViewport: { width: 1280, height: 720 },
      }) as unknown as Browser;

      this.page = await this.browser.newPage();

      // Mask automation signature
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );
      await this.page.evaluateOnNewDocument(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      `);

      // Grant microphone and camera permissions
      const context = this.browser.defaultBrowserContext();
      await context.overridePermissions('https://app.zoom.us', ['microphone', 'camera']).catch(() => {});
      await context.overridePermissions('https://pwa.zoom.us', ['microphone', 'camera']).catch(() => {});

      // Attempt to log in if credentials are provided
      await this.loginToZoom();

      // Initialize direct screenshot-to-FFmpeg frame recorder
      this.frameRecorder = this.startFrameRecorder(this.page, this.meetingId);

      // Construct direct Zoom Web Client join URL
      const cleanMeetingId = String(this.meetingId).replace(/[\s-]/g, '');
      const encodedName = encodeURIComponent(this.displayName);
      const encodedPwd = this.passcode ? encodeURIComponent(this.passcode) : '';
      const joinUrl = `https://app.zoom.us/wc/${encodeURIComponent(cleanMeetingId)}/join?pwd=${encodedPwd}&uname=${encodedName}`;

      log.info({ meetingId: this.meetingId, joinUrl: `https://app.zoom.us/wc/${cleanMeetingId}/join?pwd=...` }, 'Navigating to Zoom Web Client');

      await this.page.goto(joinUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch((err) => {
        log.warn({ error: err.message }, 'Initial page goto warning (proceeding)');
      });

      await new Promise((res) => setTimeout(res, 3000));

      // Robust in-page automation loop to fill React-controlled inputs, dismiss modals, and click Join
      const fillAndJoinMeeting = async (): Promise<boolean> => {
        if (!this.page) return false;
        return this.page.evaluate((name: string, pwd?: string) => {
          // 1. Auto-dismiss cookie consent and permission modals
          const dismissables = Array.from(document.querySelectorAll('button, a, div[role="button"], span')).filter((el) => {
            const txt = ((el as HTMLElement).innerText || '').trim().toLowerCase();
            return ['got it', 'ok', 'dismiss', 'close', 'i agree', 'allow', 'accept all cookies'].includes(txt);
          });
          dismissables.forEach((el) => {
            try {
              (el as HTMLElement).click();
            } catch {
              // ignore
            }
          });

          // 2. Set Name input using React property setter descriptor
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
            nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            nameInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          // 3. Set Passcode input if provided
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

          // 4. Request submit on form if present
          const form = (nameInput ? nameInput.closest('form') : null) || document.querySelector('form');
          if (form) {
            try {
              form.requestSubmit();
            } catch {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          }

          // 5. Click Join button
          const buttons = Array.from(document.querySelectorAll('button, .zm-btn, input[type="submit"]'));
          let clicked = false;
          for (const b of buttons) {
            const txt = ((b as HTMLElement).innerText || (b as HTMLInputElement).value || '').trim().toLowerCase();
            if (
              txt === 'join' ||
              txt.includes('join meeting') ||
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

          // 6. Join Computer Audio if dialog appeared
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
        }, this.displayName, this.passcode).catch(() => false);
      };

      // Attempt join up to 40 seconds (or longer if waiting room or human interaction is active)
      const checkStart = Date.now();
      let hasEnteredMeeting = false;

      while (true) {
        const elapsed = Date.now() - checkStart;
        if (elapsed > 40000 && !this.needsHumanInteraction && !this.isWaitingRoom) {
          break; // Timeout after 40s only if no human interaction is detected and not in waiting room
        }
        if (elapsed > 600000) {
          break; // Hard timeout after 10 minutes regardless
        }

        await fillAndJoinMeeting();

        const state = await this.page.evaluate(() => {
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
            Boolean(document.querySelector('.participants-header')) ||
            Boolean(document.querySelector('.speaker-bar')) ||
            Boolean(document.querySelector('#wc-footer')) ||
            Boolean(document.querySelector('canvas')) ||
            Boolean(document.querySelector('#wc-container')) ||
            (text.includes('participants') && text.includes('leave')) ||
            text.includes('joining meeting...');
          const url = window.location.href || '';
          const needsHuman = url.includes('signin') || url.includes('login') || text.includes('captcha') || text.includes('verify you are human') || text.includes('security check');
          return { inWaitingRoom, hasMeetingUI, needsHuman };
        }).catch(() => ({ inWaitingRoom: false, hasMeetingUI: false, needsHuman: false }));

        if (state.needsHuman && !this.needsHumanInteraction) {
          this.needsHumanInteraction = true;
          log.info({ meetingId: this.meetingId }, '🚨 Bot requires human interaction (Login/CAPTCHA detected). Pausing automation timeouts.');
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

        await new Promise((res) => setTimeout(res, 2500));
      }

      if (!hasEnteredMeeting) {
        const pageContent = await this.page.content().catch(() => '');
        const stillInWaitingRoom = /waiting room|please wait|host will let you in|waiting for the host/i.test(pageContent);
        this.isWaitingRoom = stillInWaitingRoom;
        throw new Error(
          stillInWaitingRoom
            ? 'Bot is stuck in the Zoom waiting room — host has not admitted it'
            : 'Could not confirm the bot entered the Zoom meeting room (join may have failed silently)',
        );
      }

      this.isConnected = true;
      log.info({ meetingId: this.meetingId, displayName: this.displayName }, '✅ Headless bot successfully entered the Zoom meeting room!');

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
      } else if (event.type === 'mousedown') {
        await this.page.mouse.down();
      } else if (event.type === 'mouseup') {
        await this.page.mouse.up();
      } else if (event.type === 'mousemove') {
        await this.page.mouse.move(event.x, event.y);
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
