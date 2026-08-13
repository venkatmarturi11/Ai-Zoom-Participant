import { WorkerStateMachine, type WorkerState } from './state/state-machine.js';
import type { MeetingWorkerConfig, WorkerContext } from './worker-context.js';
import { resolveCapability, createMeetingAdapter } from '@zoom-assistant/zoom';
import { createLogger, LIMITS } from '@zoom-assistant/shared';

const log = createLogger({ module: 'meeting-worker' });

export class MeetingWorker {
  private readonly context: WorkerContext;
  private heartbeatInterval?: NodeJS.Timeout;
  private isStopping = false;

  constructor(config: MeetingWorkerConfig) {
    this.context = {
      config,
      stateMachine: new WorkerStateMachine(config.meetingId, config.userId, config.zoomMeetingId),
      restartCount: 0,
    };
  }

  public get meetingId(): string {
    return this.context.config.meetingId;
  }

  public get state(): WorkerState {
    return this.context.stateMachine.state;
  }

  public get isTerminal(): boolean {
    return this.context.stateMachine.isTerminal;
  }

  /**
   * Start the worker lifecycle with strict try/finally cleanup guarantees.
   */
  public async start(): Promise<void> {
    log.info({ meetingId: this.meetingId }, 'Starting MeetingWorker execution');

    try {
      this.context.stateMachine.transitionTo('STARTING');

      // 1. Resolve Zoom capability dynamically
      this.context.stateMachine.transitionTo('AUTHENTICATING');

      const capabilityResult = resolveCapability({
        zoomMeetingId: this.context.config.zoomMeetingId,
        isExternalMeeting: this.context.config.isExternalMeeting ?? false,
        isHostAccount: this.context.config.isHostAccount ?? true,
        userPresentInMeeting: this.context.config.userPresentInMeeting ?? false,
      });

      if (capabilityResult.capability === 'UNSUPPORTED') {
        throw new Error(`Capability unsupported: ${capabilityResult.reason}`);
      }

      // 2. Instantiate capability-independent adapter
      this.context.stateMachine.transitionTo('INITIALIZING');

      this.context.adapter = createMeetingAdapter({
        capability: capabilityResult.capability,
        userId: this.context.config.userId,
        accessToken: this.context.config.accessToken,
        meetingId: this.context.config.zoomMeetingId,
        passcode: this.context.config.passcode,
      });

      await this.context.adapter.initialize();
      await this.context.adapter.authenticate();

      // 3. Connect to meeting
      this.context.stateMachine.transitionTo('CONNECTING');
      await this.context.adapter.connect();

      // 4. Update state to CONNECTED and start monitoring
      this.context.stateMachine.transitionTo('CONNECTED');
      this.startHeartbeat();

      this.context.stateMachine.transitionTo('MONITORING');
    } catch (err: any) {
      log.error({ meetingId: this.meetingId, error: err.message }, 'Error in MeetingWorker start pipeline');
      throw err;
    } finally {
      // Guaranteed cleanup if startup failed before reaching MONITORING state
      if (this.context.stateMachine.state !== 'MONITORING' && !this.isTerminal) {
        await this.performCleanup('STARTUP_FAILED', 'Startup pipeline failed before reaching monitoring state');
      }
    }
  }

  /**
   * Stop the meeting worker gracefully.
   */
  public async stop(reason: string = 'USER_STOPPED'): Promise<void> {
    if (this.isStopping || this.isTerminal) return;
    this.isStopping = true;

    log.info({ meetingId: this.meetingId, reason }, 'Stopping MeetingWorker');

    try {
      if (this.context.stateMachine.state !== 'STOPPING') {
        this.context.stateMachine.transitionTo('STOPPING', { reason });
      }

      if (this.context.adapter) {
        await this.context.adapter.stop();
      }
    } catch (err: any) {
      log.error({ meetingId: this.meetingId, error: err.message }, 'Error stopping adapter');
    } finally {
      await this.performCleanup(reason);
    }
  }

  /**
   * Cleanup resources, stop heartbeat, and transition state machine to terminal state.
   */
  public async performCleanup(reason: string, error?: string): Promise<void> {
    this.stopHeartbeat();

    if (this.context.stateMachine.state !== 'CLEANING_UP' && !this.isTerminal) {
      try {
        this.context.stateMachine.transitionTo('CLEANING_UP', { reason }, error);
      } catch {
        // Ignore invalid transition errors during emergency cleanup
      }
    }

    if (this.context.adapter) {
      try {
        await this.context.adapter.cleanup();
      } catch (err: any) {
        log.error({ meetingId: this.meetingId, error: err.message }, 'Error during adapter cleanup');
      }
    }

    const finalState = error ? 'FAILED' : 'COMPLETED';
    if (!this.isTerminal) {
      try {
        this.context.stateMachine.transitionTo(finalState, { reason }, error);
      } catch {
        // Force terminal state if transition fails
      }
    }

    log.info({ meetingId: this.meetingId, finalState, reason }, 'MeetingWorker cleanup complete');
  }

  /**
   * Record a heartbeat timestamp for watchdog monitoring.
   */
  public recordHeartbeat(): void {
    this.context.lastHeartbeat = new Date();
  }

  public get lastHeartbeat(): Date | undefined {
    return this.context.lastHeartbeat;
  }

  private startHeartbeat(): void {
    this.recordHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.recordHeartbeat();
    }, LIMITS.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }
}
