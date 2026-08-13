import type { WorkerStateMachine } from './state/state-machine.js';
import type { MeetingAdapter } from '@zoom-assistant/zoom';

export interface MeetingWorkerConfig {
  meetingId: string;
  userId: string;
  zoomMeetingId: string;
  zoomEmail: string;
  accessToken: string;
  passcode?: string;
  displayName?: string;
  isExternalMeeting?: boolean;
  isHostAccount?: boolean;
  userPresentInMeeting?: boolean;
}

export interface WorkerContext {
  readonly config: MeetingWorkerConfig;
  readonly stateMachine: WorkerStateMachine;
  adapter?: MeetingAdapter;
  lastHeartbeat?: Date;
  restartCount: number;
}
