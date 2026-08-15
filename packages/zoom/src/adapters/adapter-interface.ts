export interface AdapterStatus {
  connected: boolean;
  waitingRoom: boolean;
  meetingEnded: boolean;
  needsHumanInteraction?: boolean;
  errorCode?: string;
  details?: Record<string, unknown>;
}

/**
 * Capability-independent Meeting Adapter interface.
 * Decouples the worker engine from specific Zoom authorization & communication mechanisms.
 */
export interface MeetingAdapter {
  readonly capabilityType: string;

  /** Initialize native SDK or streaming client */
  initialize(): Promise<void>;

  /** Authenticate credentials (ZAK, OBF, or OAuth) */
  authenticate(): Promise<void>;

  /** Connect to the meeting */
  connect(onStatusCallback?: (status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM', detail?: string) => Promise<void> | void): Promise<void>;

  /** Handle remote human-in-the-loop control events */
  handleControlEvent?(event: any): Promise<void>;

  /** Get current operational status */
  getStatus(): Promise<AdapterStatus>;

  /** Gracefully leave/stop the meeting */
  stop(): Promise<void>;

  /** Cleanup resources, listeners, and handles */
  cleanup(): Promise<void>;
}
