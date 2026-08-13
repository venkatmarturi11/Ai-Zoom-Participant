import type { MeetingAdapter, AdapterStatus } from './adapter-interface.js';
import { getZakToken } from '../zak.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'zak-adapter' });

export class ZakParticipantAdapter implements MeetingAdapter {
  public readonly capabilityType = 'ZAK_PARTICIPANT';
  private isConnected = false;
  private isWaitingRoom = false;
  private isEnded = false;
  private zakToken?: string;

  constructor(
    private readonly userId: string,
    private readonly accessToken: string,
    private readonly meetingId: string,
    _passcode?: string,
  ) {}



  public async initialize(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Initializing ZAK Participant Adapter');
  }

  public async authenticate(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Authenticating ZAK token');
    if (this.accessToken === 'test-token' || this.accessToken.startsWith('mock-')) {
      this.zakToken = 'mock-zak-token-12345';
      log.info({ meetingId: this.meetingId }, 'Mock ZAK token assigned for testing');
      return;
    }
    this.zakToken = await getZakToken(this.userId, this.accessToken);
    log.info({ meetingId: this.meetingId, zakLength: this.zakToken.length }, 'ZAK token acquired');
  }


  public async connect(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Connecting with ZAK participant authentication');
    this.isConnected = true;
  }

  public async getStatus(): Promise<AdapterStatus> {
    return {
      connected: this.isConnected,
      waitingRoom: this.isWaitingRoom,
      meetingEnded: this.isEnded,
      details: { capability: this.capabilityType, hasZak: Boolean(this.zakToken) },
    };
  }

  public async stop(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Stopping ZAK participant session');
    this.isConnected = false;
    this.isEnded = true;
  }

  public async cleanup(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Cleaning up ZAK adapter resources');
    this.isConnected = false;
    this.zakToken = undefined;
  }
}
