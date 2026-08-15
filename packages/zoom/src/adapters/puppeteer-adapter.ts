import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import fs from 'node:fs';
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
  for (const path of candidatePaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  return '/usr/bin/chromium';
}

export class PuppeteerZoomAdapter implements MeetingAdapter {
  public readonly capabilityType = 'WEB_PARTICIPANT';
  private browser?: Browser;
  private page?: Page;
  private isConnected = false;
  private isWaitingRoom = false;
  private isEnded = false;

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
      // Checks for the in-meeting toolbar/leave button; if it's not present, we're
      // still stuck on an error screen, waiting room, or rejected-join screen.
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
    } catch (err: any) {
      log.error({ meetingId: this.meetingId, error: err.message }, 'Puppeteer Zoom connection error');
      this.isConnected = false;
      // Clean up the browser we may have partially launched before failing.
      await this.browser?.close().catch(() => {});
      this.browser = undefined;
      this.page = undefined;
      throw err;
    }
  }

  public async getStatus(): Promise<AdapterStatus> {
    return {
      connected: this.isConnected,
      waitingRoom: this.isWaitingRoom,
      meetingEnded: this.isEnded,
      details: { capability: this.capabilityType, browserActive: Boolean(this.browser) },
    };
  }

  public async stop(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Leaving Zoom meeting and closing browser');
    this.isConnected = false;
    this.isEnded = true;

    try {
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
      log.warn({ error: err.message }, 'Error closing Puppeteer browser');
    }
  }

  public async cleanup(): Promise<void> {
    await this.stop();
  }
}
