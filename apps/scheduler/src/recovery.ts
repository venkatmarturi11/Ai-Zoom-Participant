import { meetingRepo, auditRepo, getDb } from '@zoom-assistant/database';
import { queueProducers } from '@zoom-assistant/queue';
import { createLogger, LIMITS } from '@zoom-assistant/shared';

const log = createLogger({ module: 'restart-recovery' });

export interface RecoveryReport {
  requeuedScheduled: number;
  recoveredInterrupted: number;
  cleanedStale: number;
  errors: number;
}

/**
 * Server Restart Reconciliation Process.
 *
 * Executed on application startup:
 *   1. Scans PostgreSQL for meetings in non-terminal states.
 *   2. Evaluates state:
 *      - SCHEDULED: if scheduledAt > now, re-enqueues delayed BullMQ job.
 *      - CONNECTED / RECONNECTING / STARTING / CONNECTING: if interrupted by crash, attempts job recovery.
 *      - Stale sessions (exceeding MAX_SESSION_DURATION_HOURS or abandon threshold): cleans up and marks FAILED.
 */
export async function runServerRestartReconciliation(): Promise<RecoveryReport> {
  log.info('Starting Server Restart Reconciliation Process...');

  const report: RecoveryReport = {
    requeuedScheduled: 0,
    recoveredInterrupted: 0,
    cleanedStale: 0,
    errors: 0,
  };

  try {
    const db = getDb();
    const activeMeetings = await db.meeting.findMany({
      where: {
        status: {
          in: [
            'CREATED',
            'SCHEDULED',
            'STARTING',
            'AUTHENTICATING',
            'SDK_INITIALIZING',
            'JOINING',
            'WAITING_ROOM',
            'CONNECTED',
            'RECONNECTING',
          ],
        },
      },
    });

    log.info({ count: activeMeetings.length }, `Found ${activeMeetings.length} non-terminal meeting records`);

    const now = Date.now();
    const maxDurationMs = LIMITS.MAX_SESSION_DURATION_HOURS * 60 * 60 * 1000;

    for (const meeting of activeMeetings) {
      try {
        // Case A: Scheduled meeting
        if (meeting.status === 'SCHEDULED' && meeting.scheduledAt) {
          const delayMs = meeting.scheduledAt.getTime() - now;

          if (delayMs > 0) {
            await queueProducers.enqueueScheduledMeetingStart(
              {
                meetingId: meeting.id,
                userId: meeting.userId,
                zoomMeetingId: meeting.zoomMeetingId,
                requestedAt: meeting.createdAt.toISOString(),
                scheduledFor: meeting.scheduledAt.toISOString(),
              },
              delayMs,
            );
            report.requeuedScheduled++;
            log.info({ meetingId: meeting.id, scheduledAt: meeting.scheduledAt }, 'Requeued scheduled meeting job');
          } else {
            // Scheduled time has passed while server was offline -> start immediately if within 30 mins
            const overdueMs = Math.abs(delayMs);
            if (overdueMs <= 30 * 60 * 1000) {
              await queueProducers.enqueueMeetingStart({
                meetingId: meeting.id,
                userId: meeting.userId,
                zoomMeetingId: meeting.zoomMeetingId,
                requestedAt: new Date().toISOString(),
                reason: 'OVERDUE_SCHEDULED_RECOVERY',
              });
              report.requeuedScheduled++;
            } else {
              await meetingRepo.updateStatus(meeting.id, 'FAILED');
              report.cleanedStale++;
            }
          }
          continue;
        }

        // Case B: Stale / abandoned session check
        const startTime = meeting.actualStart?.getTime() ?? meeting.createdAt.getTime();
        if (now - startTime > maxDurationMs) {
          log.warn({ meetingId: meeting.id }, 'Session exceeded maximum duration threshold during offline period');
          await meetingRepo.updateStatus(meeting.id, 'FAILED');
          await auditRepo.log({
            userId: meeting.userId,
            action: 'SESSION_CLEANED_STALE_RECOVERY',
            metadata: { meetingId: meeting.id },
          });
          report.cleanedStale++;
          continue;
        }

        // Case C: Interrupted active session (was CONNECTED, CONNECTING, etc. when server crashed)
        if (['STARTING', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'WAITING_ROOM'].includes(meeting.status)) {
          log.info({ meetingId: meeting.id, previousStatus: meeting.status }, 'Recovering interrupted meeting job');

          await meetingRepo.updateStatus(meeting.id, 'STARTING');
          await queueProducers.enqueueMeetingStart({
            meetingId: meeting.id,
            userId: meeting.userId,
            zoomMeetingId: meeting.zoomMeetingId,
            requestedAt: new Date().toISOString(),
            reason: 'PROCESS_RESTART_RECOVERY',
          });

          await auditRepo.log({
            userId: meeting.userId,
            action: 'SESSION_RECOVERED_RESTART',
            metadata: { meetingId: meeting.id, previousStatus: meeting.status },
          });

          report.recoveredInterrupted++;
        }
      } catch (err: any) {
        log.error({ meetingId: meeting.id, error: err.message }, 'Error reconciling meeting record');
        report.errors++;
      }
    }
  } catch (err: any) {
    log.error({ error: err.message }, 'Server restart reconciliation process encountered error');
    report.errors++;
  }

  log.info({ report }, 'Server Restart Reconciliation Process completed');
  return report;
}
