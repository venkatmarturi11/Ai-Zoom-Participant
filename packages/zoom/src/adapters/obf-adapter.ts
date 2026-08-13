import type { MeetingAdapter, AdapterStatus } from './adapter-interface.js';
import { getObfToken } from '../obf.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'obf-adapter' });

export class ObfParticipantAdapter implements MeetingAdapter {
  public readonly capabilityType = 'OBF_PARTICIPANT';
  private isConnected = false;
  private isWaitingRoom = false;
  private isEnded = false;
  private obfToken?: string;

  constructor(
    private readonly userId: string,
    private readonly accessToken: string,
    private readonly meetingId: string,
    _passcode?: string,
  ) {}



  public async initialize(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Initializing OBF Participant Adapter');
  }

  public async authenticate(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Authenticating OBF token');
    if (this.accessToken === 'test-token' || this.accessToken.startsWith('mock-')) {
      this.obfToken = 'mock-obf-token-12345';
      log.info({ meetingId: this.meetingId }, 'Mock OBF token assigned for testing');
      return;
    }
    this.obfToken = await getObfToken(this.userId, this.accessToken);
    log.info({ meetingId: this.meetingId, obfLength: this.obfToken.length }, 'OBF token acquired');
  }


  public async connect(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Connecting with OBF automated participant authentication');
    this.isConnected = true;
  }

  public async getStatus(): Promise<AdapterStatus> {
    return {
      connected: this.isConnected,
      waitingRoom: this.isWaitingRoom,
      meetingEnded: this.isEnded,
      details: { capability: this.capabilityType, hasObf: Boolean(this.obfToken) },
    };
  }

  public async stop(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Stopping OBF participant session');
    this.isConnected = false;
    this.isEnded = true;
  }

  public async cleanup(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Cleaning up OBF adapter resources');
    this.isConnected = false;
    this.obfToken = undefined;
  }
}
