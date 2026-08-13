import type { MeetingAdapter, AdapterStatus } from './adapter-interface.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'rtms-adapter' });

export class RtmsMediaAdapter implements MeetingAdapter {
  public readonly capabilityType = 'RTMS_MEDIA';
  private isConnected = false;
  private isEnded = false;

  constructor(
    _userId: string,
    _accessToken: string,
    private readonly meetingId: string,
  ) {}



  public async initialize(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Initializing RTMS Media Adapter');
  }

  public async authenticate(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Authenticating RTMS media session');
  }

  public async connect(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Connecting RTMS media stream');
    this.isConnected = true;
  }

  public async getStatus(): Promise<AdapterStatus> {
    return {
      connected: this.isConnected,
      waitingRoom: false,
      meetingEnded: this.isEnded,
      details: { capability: this.capabilityType },
    };
  }

  public async stop(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Stopping RTMS media stream');
    this.isConnected = false;
    this.isEnded = true;
  }

  public async cleanup(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Cleaning up RTMS media resources');
    this.isConnected = false;
  }
}
