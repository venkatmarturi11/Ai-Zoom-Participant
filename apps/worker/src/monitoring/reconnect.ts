import { LIMITS, createLogger } from '@zoom-assistant/shared';
import type { WorkerStateMachine } from '../state/state-machine.js';

const log = createLogger({ module: 'reconnect-manager' });

export interface ReconnectOptions {
  maxRetries?: number;
  delaysMs?: readonly number[];
}

/**
 * Reconnection manager handling bounded exponential backoff recovery
 * for network interruptions.
 */
export class ReconnectManager {
  private retryCount = 0;
  private readonly maxRetries: number;
  private readonly delaysMs: readonly number[];

  constructor(options?: ReconnectOptions) {
    this.maxRetries = options?.maxRetries ?? LIMITS.MAX_RETRIES;
    this.delaysMs = options?.delaysMs ?? LIMITS.RETRY_DELAYS_MS;
  }

  public get attempts(): number {
    return this.retryCount;
  }

  public get canRetry(): boolean {
    return this.retryCount < this.maxRetries;
  }

  /**
   * Attempt a reconnection flow.
   * Updates state machine to RECONNECTING, waits backoff delay, then executes reconnectFn.
   * If reconnectFn succeeds, updates state machine to CONNECTED and resets retry counter.
   */
  public async executeReconnect(
    stateMachine: WorkerStateMachine,
    reconnectFn: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.canRetry) {
      log.error({ meetingId: stateMachine.meetingId, attempts: this.retryCount }, 'Max reconnection retries exceeded');
      return false;
    }

    const delayMs = this.delaysMs[this.retryCount] ?? 60_000;
    this.retryCount++;

    log.info(
      { meetingId: stateMachine.meetingId, attempt: this.retryCount, max: this.maxRetries, delayMs },
      `Executing reconnection attempt #${this.retryCount}`,
    );

    if (stateMachine.state !== 'RECONNECTING') {
      stateMachine.transitionTo('RECONNECTING', { attempt: this.retryCount });
    }

    // Wait backoff delay
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      await reconnectFn();
      stateMachine.transitionTo('CONNECTED', { reconnected: true, attempt: this.retryCount });
      log.info({ meetingId: stateMachine.meetingId }, 'Reconnection successful');
      this.reset();
      return true;
    } catch (err: any) {
      log.warn({ meetingId: stateMachine.meetingId, error: err.message }, `Reconnection attempt #${this.retryCount} failed`);
      return false;
    }
  }

  public reset(): void {
    this.retryCount = 0;
  }
}
