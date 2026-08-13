import { eventBus, MEETING_EVENTS, createLogger } from '@zoom-assistant/shared';

export type WorkerState =
  | 'CREATED'
  | 'QUEUED'
  | 'STARTING'
  | 'AUTHENTICATING'
  | 'INITIALIZING'
  | 'CONNECTING'
  | 'WAITING_ROOM'
  | 'CONNECTED'
  | 'MONITORING'
  | 'RECONNECTING'
  | 'STOPPING'
  | 'CLEANING_UP'
  | 'COMPLETED'
  | 'FAILED';

const log = createLogger({ module: 'worker-state-machine' });

/** Terminal states from which no further state transitions are permitted */
const TERMINAL_STATES: ReadonlySet<WorkerState> = new Set(['COMPLETED', 'FAILED']);

/** Valid state transitions map */
const VALID_TRANSITIONS: Readonly<Record<WorkerState, ReadonlySet<WorkerState>>> = {
  CREATED: new Set(['QUEUED', 'STARTING', 'CLEANING_UP', 'FAILED']),
  QUEUED: new Set(['STARTING', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  STARTING: new Set(['AUTHENTICATING', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  AUTHENTICATING: new Set(['INITIALIZING', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  INITIALIZING: new Set(['CONNECTING', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  CONNECTING: new Set(['WAITING_ROOM', 'CONNECTED', 'RECONNECTING', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  WAITING_ROOM: new Set(['CONNECTED', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  CONNECTED: new Set(['MONITORING', 'RECONNECTING', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  MONITORING: new Set(['CONNECTED', 'RECONNECTING', 'STOPPING', 'CLEANING_UP', 'FAILED', 'COMPLETED']),
  RECONNECTING: new Set(['CONNECTED', 'STOPPING', 'CLEANING_UP', 'FAILED']),
  STOPPING: new Set(['CLEANING_UP', 'FAILED']),
  CLEANING_UP: new Set(['COMPLETED', 'FAILED']),
  COMPLETED: new Set(),
  FAILED: new Set(),
};

export class WorkerStateMachine {
  private currentState: WorkerState = 'CREATED';
  private readonly history: WorkerState[] = ['CREATED'];

  constructor(
    public readonly meetingId: string,
    public readonly userId: string,
    public readonly zoomMeetingId: string,
  ) {}

  public get state(): WorkerState {
    return this.currentState;
  }

  public get isTerminal(): boolean {
    return TERMINAL_STATES.has(this.currentState);
  }

  public get stateHistory(): readonly WorkerState[] {
    return [...this.history];
  }

  /**
   * Attempt a state transition.
   * Throws Error if the transition is invalid or attempted from a terminal state.
   */
  public transitionTo(nextState: WorkerState, details?: Record<string, unknown>, error?: string): void {
    if (this.currentState === nextState) {
      log.debug({ meetingId: this.meetingId, state: this.currentState }, 'Duplicate state transition ignored');
      return;
    }

    if (this.isTerminal) {
      throw new Error(`Cannot transition from terminal state '${this.currentState}' to '${nextState}'`);
    }

    const allowed = VALID_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.has(nextState)) {
      throw new Error(`Invalid state transition: '${this.currentState}' -> '${nextState}' is not permitted`);
    }

    log.info(
      { meetingId: this.meetingId, from: this.currentState, to: nextState },
      `State transition: ${this.currentState} -> ${nextState}`,
    );

    this.currentState = nextState;
    this.history.push(nextState);

    // Publish event to system event bus
    const eventName = mapStateToEvent(nextState);
    if (eventName) {
      eventBus.publish({
        meetingId: this.meetingId,
        userId: this.userId,
        zoomMeetingId: this.zoomMeetingId,
        event: eventName,
        timestamp: new Date(),
        details,
        error,
      });
    }
  }
}

function mapStateToEvent(state: WorkerState): (typeof MEETING_EVENTS)[keyof typeof MEETING_EVENTS] | null {
  switch (state) {
    case 'STARTING':
      return MEETING_EVENTS.MEETING_STARTING;
    case 'AUTHENTICATING':
      return MEETING_EVENTS.MEETING_AUTHENTICATING;
    case 'JOINING':
    case 'CONNECTING':
      return MEETING_EVENTS.MEETING_JOINING;
    case 'WAITING_ROOM':
      return MEETING_EVENTS.MEETING_WAITING_ROOM;
    case 'CONNECTED':
      return MEETING_EVENTS.MEETING_CONNECTED;
    case 'RECONNECTING':
      return MEETING_EVENTS.MEETING_RECONNECTING;
    case 'STOPPING':
      return MEETING_EVENTS.MEETING_STOPPED;
    case 'CLEANING_UP':
      return MEETING_EVENTS.MEETING_CLEANED;
    case 'COMPLETED':
      return MEETING_EVENTS.MEETING_ENDED;
    case 'FAILED':
      return MEETING_EVENTS.MEETING_FAILED;
    default:
      return null;
  }
}
