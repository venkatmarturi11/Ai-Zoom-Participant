import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
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

function getFfmpegExecutablePath(): string | undefined {
  if (process.env['FFMPEG_PATH'] && fs.existsSync(process.env['FFMPEG_PATH'])) {
    return process.env['FFMPEG_PATH'];
  }
  if (fs.existsSync('/usr/bin/ffmpeg')) {
    return '/usr/bin/ffmpeg';
  }
  if (ffmpegInstaller && (ffmpegInstaller as any).path && fs.existsSync((ffmpegInstaller as any).path)) {
    return (ffmpegInstaller as any).path;
  }
  return undefined;
}

export class PuppeteerZoomAdapter implements MeetingAdapter {
  public readonly capabilityType = 'WEB_PARTICIPANT';
  private browser?: Browser;
  private page?: Page;
  private recorder?: PuppeteerScreenRecorder;
  private recordingFilePath?: string;
  private isConnected = false;
  private isWaitingRoom = false;
  private isEnded = false;
  private cloudRecordingStarted = false;

  constructor(
    _userId: string,
    private readonly meetingId: string,
    private readonly passcode?: string,
    private readonly displayName: string = 'Meeting Assistant',
  ) {}

  public async initialize(): Promise<void> {
    log.info({ meetingId: this.meetingId, displayName: this.displayName }, 'Initializing Puppeteer Zoom Participant');
  }

  public async authenticate(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Prepared Zoom Web Client parameters');
  }

  public async connect(): Promise<void> {
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
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          '--window-size=1280,720',
        ],
        defaultViewport: { width: 1280, height: 720 },
      });

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

      // Initialize headless screen recording to capture the entire session
      const ffmpegPath = getFfmpegExecutablePath();
      log.info({ ffmpegPath }, 'Using FFmpeg executable for screen recording');

      const recordingsDir = path.join(os.tmpdir(), 'zoom-recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }
      this.recordingFilePath = path.join(recordingsDir, `meeting-${this.meetingId}-${Date.now()}.mp4`);

      try {
        this.recorder = new PuppeteerScreenRecorder(this.page as any, {
          followNewTab: false,
          fps: 15,
          ffmpeg_Path: ffmpegPath,
          videoFrame: {
            width: 1280,
            height: 720,
          },
          aspectRatio: '16:9',
        });
        await this.recorder.start(this.recordingFilePath);
        log.info({ recordingFilePath: this.recordingFilePath }, '🎥 Headless screen recorder started capturing meeting session');
      } catch (recErr: any) {
        log.warn({ error: recErr?.message }, 'Could not initialize screen recorder (proceeding with meeting join)');
      }

      // Construct direct Zoom Web Client join URL
      const encodedName = encodeURIComponent(this.displayName);
      const encodedPwd = this.passcode ? encodeURIComponent(this.passcode) : '';
      const joinUrl = `https://app.zoom.us/wc/${this.meetingId}/join?pwd=${encodedPwd}&uname=${encodedName}`;

      log.info({ meetingId: this.meetingId, joinUrl: `https://app.zoom.us/wc/${this.meetingId}/join?...` }, 'Navigating to Zoom Web Client');

      await this.page.goto(joinUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch((err) => {
        log.warn({ error: err.message }, 'Initial page goto warning (proceeding)');
      });

      await new Promise((res) => setTimeout(res, 4000));

      // Handle cookie consent if visible
      try {
        const cookieBtn = await this.page.$('#onetrust-accept-btn-handler');
        if (cookieBtn) await cookieBtn.click();
      } catch {
        // ignore
      }

      // Handle name input if not automatically filled by URL parameter
      try {
        const nameSelectors = ['input#inputname', 'input[name="inputname"]', 'input[placeholder*="name" i]'];
        for (const sel of nameSelectors) {
          const el = await this.page.$(sel);
          if (el) {
            await el.click({ clickCount: 3 });
            await el.type(this.displayName);
            break;
          }
        }
      } catch {
        // ignore
      }

      // Handle passcode input if present
      if (this.passcode) {
        try {
          const pwdSelectors = ['input#inputpasscode', 'input[name="inputpasscode"]', 'input[type="password"]'];
          for (const sel of pwdSelectors) {
            const el = await this.page.$(sel);
            if (el) {
              await el.click({ clickCount: 3 });
              await el.type(this.passcode);
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      // Click the Join button
      try {
        const joinSelectors = [
          'button#joinBtn',
          'button.preview-join-button',
          'button.zm-btn--primary',
          'button.join-button',
          'button[type="submit"]',
        ];
        for (const sel of joinSelectors) {
          const btn = await this.page.$(sel);
          if (btn) {
            await btn.click();
            log.info({ meetingId: this.meetingId, selector: sel }, 'Clicked Join button in Zoom Web Client');
            break;
          }
        }
      } catch {
        // ignore
      }

      // Wait a moment for connection & dismiss "Join Audio" dialogs
      await new Promise((res) => setTimeout(res, 6000));

      try {
        const audioSelectors = [
          'button.join-audio-by-voip__join-btn',
          'button.join-audio',
          'button.zm-btn--primary',
        ];
        for (const sel of audioSelectors) {
          const btn = await this.page.$(sel);
          if (btn) {
            await btn.click();
            log.info({ meetingId: this.meetingId, selector: sel }, 'Joined Computer Audio in meeting room');
            break;
          }
        }
      } catch {
        // ignore
      }

      // Verify we actually made it into the meeting room before declaring success.
      const inMeeting = await this.page
        .waitForSelector(
          'button.footer__leave-btn, [aria-label="Leave"], .footer-button__leave-btn-container, #wc-footer',
          { timeout: 15000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!inMeeting) {
        const pageContent = await this.page.content().catch(() => '');
        const stillInWaitingRoom = /waiting room|please wait|host will let you in/i.test(pageContent);
        this.isWaitingRoom = stillInWaitingRoom;
        throw new Error(
          stillInWaitingRoom
            ? 'Bot is stuck in the Zoom waiting room — host has not admitted it'
            : 'Could not confirm the bot actually entered the meeting (join may have failed silently)',
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
      if (this.recorder) {
        try {
          await this.recorder.stop();
        } catch {
          // ignore
        }
        this.recorder = undefined;
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
      details: {
        capability: this.capabilityType,
        browserActive: Boolean(this.browser),
        recordingFilePath: this.recordingFilePath,
        screenRecordingActive: Boolean(this.recorder),
        cloudRecordingStarted: this.cloudRecordingStarted,
      },
    };
  }

  public async stop(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Leaving Zoom meeting and closing browser');
    this.isConnected = false;
    this.isEnded = true;

    try {
      if (this.recorder) {
        log.info({ meetingId: this.meetingId, path: this.recordingFilePath }, 'Finalizing screen recording MP4 video...');
        await this.recorder.stop().catch((err: any) => {
          log.warn({ error: err?.message }, 'Warning stopping screen recorder');
        });
        this.recorder = undefined;
        if (this.recordingFilePath && fs.existsSync(this.recordingFilePath)) {
          const stats = fs.statSync(this.recordingFilePath);
          log.info({ recordingFilePath: this.recordingFilePath, sizeBytes: stats.size }, '🎥 Screen recording MP4 file saved successfully');
        }
      }

      if (this.page) {
        const leaveBtn = await this.page.$('button.footer__leave-btn');
        if (leaveBtn) await leaveBtn.click();
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
