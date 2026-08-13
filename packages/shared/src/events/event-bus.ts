import { EventEmitter } from 'node:events';
import { createLogger } from '../logger.js';

const log = createLogger({ module: 'event-bus' });

export const MEETING_EVENTS = {
  MEETING_CREATED: 'MEETING_CREATED',
  MEETING_STARTING: 'MEETING_STARTING',
  MEETING_AUTHENTICATING: 'MEETING_AUTHENTICATING',
  MEETING_JOINING: 'MEETING_JOINING',
  MEETING_WAITING_ROOM: 'MEETING_WAITING_ROOM',
  MEETING_CONNECTED: 'MEETING_CONNECTED',
  MEETING_RECONNECTING: 'MEETING_RECONNECTING',
  MEETING_ENDED: 'MEETING_ENDED',
  MEETING_STOPPED: 'MEETING_STOPPED',
  MEETING_FAILED: 'MEETING_FAILED',
  MEETING_CLEANED: 'MEETING_CLEANED',
} as const;

export type MeetingEventType = (typeof MEETING_EVENTS)[keyof typeof MEETING_EVENTS];

export interface MeetingEventPayload {
  meetingId: string;
  userId: string;
  zoomMeetingId: string;
  event: MeetingEventType;
  timestamp: Date;
  details?: Record<string, unknown>;
  error?: string;
}

class SystemEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  public publish(payload: MeetingEventPayload): void {
    log.info({ event: payload.event, meetingId: payload.meetingId }, `Event published: ${payload.event}`);
    this.emit(payload.event, payload);
    this.emit('*', payload);
  }

  public subscribe(event: MeetingEventType | '*', handler: (payload: MeetingEventPayload) => void): () => void {
    this.on(event, handler);
    return () => this.off(event, handler);
  }
}

/** Singleton system-wide event bus */
export const eventBus = new SystemEventBus();
