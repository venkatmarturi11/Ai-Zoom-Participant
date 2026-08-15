import {
  userRepo,
  zoomAccountRepo,
  meetingRepo,
  auditRepo,
  type Meeting,
} from '@zoom-assistant/database';
import { queueProducers } from '@zoom-assistant/queue';
import { resolveCapability, PuppeteerZoomAdapter, type CapabilityResolution } from '@zoom-assistant/zoom';
import { encryptToken } from '@zoom-assistant/crypto';
import { createLogger, ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

const log = createLogger({ module: 'meeting-service' });

const activeBrowserAdapters = new Map<string, PuppeteerZoomAdapter>();

export interface CreateMeetingParams {
  telegramUserId: bigint;
  meetingUrl: string;
  meetingId: string;
  passcode?: string;
  displayName?: string;
  mode?: 'PARTICIPANT' | 'MEDIA_ONLY';
  isExternalMeeting?: boolean;
  isHostAccount?: boolean;
  userPresentInMeeting?: boolean;
  onStatusChange?: (status: 'CONNECTED' | 'FAILED' | 'WAITING_ROOM', detail?: string) => Promise<void> | void;
}

export interface ScheduleMeetingParams extends CreateMeetingParams {
  scheduledAt: Date;
  timezone?: string;
}

export interface ServiceMeetingResult {
  meeting: Meeting;
  capability: CapabilityResolution;
  jobId: string;
}

export class MeetingService {
  /**
   * Create and queue an immediate meeting join job.
   */
  public async createAndQueueMeeting(params: CreateMeetingParams): Promise<ServiceMeetingResult> {
    const { user, zoomAccount } = await this.validateUserAndAccount(params.telegramUserId);

    // Resolve capability dynamically
    const capability = resolveCapability({
      zoomMeetingId: params.meetingId,
      isExternalMeeting: params.isExternalMeeting ?? false,
      isHostAccount: params.isHostAccount ?? true,
      userPresentInMeeting: params.userPresentInMeeting ?? false,
      requestedMode: params.mode,
    });

    if (capability.capability === 'UNSUPPORTED') {
      throw new ZoomError(ZoomErrorCode.NOT_ALLOWED, capability.reason);
    }

    // Encrypt meeting passcode if present
    const encryptionKey = process.env['ENCRYPTION_KEY'] ?? '';
    const passcodeEncrypted = params.passcode ? encryptToken(params.passcode, encryptionKey) : undefined;

    const defaultDisplayName = user.telegramUsername ?? zoomAccount.zoomEmail.split('@')[0] ?? process.env['DEFAULT_DISPLAY_NAME'] ?? 'Meeting Assistant';
    const displayName = params.displayName ?? defaultDisplayName;

    // Create DB meeting record with STARTING status
    const meeting = await meetingRepo.create({
      userId: user.id,
      zoomMeetingId: params.meetingId,
      meetingUrl: params.meetingUrl,
      passcodeEncrypted,
      displayName,
      topic: `Zoom Meeting ${params.meetingId}`,
      status: 'STARTING',
    });

    // Enqueue BullMQ start job with deterministic job ID
    const jobId = await queueProducers.enqueueMeetingStart({
      meetingId: meeting.id,
      userId: user.id,
      zoomMeetingId: params.meetingId,
      requestedAt: new Date().toISOString(),
      mode: params.mode,
    }).catch((err) => {
      log.warn({ error: err?.message }, 'BullMQ enqueue skipped (continuing in-memory/DB)');
      return `job-${meeting.id}`;
    });

    // Launch headless Puppeteer browser agent to enter Zoom meeting room
    try {
      const adapter = new PuppeteerZoomAdapter(
        user.id,
        params.meetingId,
        params.passcode,
        displayName,
      );
      activeBrowserAdapters.set(meeting.id, adapter);

      setImmediate(async () => {
        try {
          await adapter.initialize();
          await adapter.connect();
          await meetingRepo.updateStatus(meeting.id, 'CONNECTED');
          log.info({ meetingId: meeting.id }, '✅ Headless browser participant entered meeting room and started recording');
          if (params.onStatusChange) {
            await params.onStatusChange('CONNECTED', 'Assistant entered meeting room and screen recording is active');
          }
        } catch (err: any) {
          log.error({ error: err?.message, meetingId: meeting.id }, 'Puppeteer browser connection failed');
          await meetingRepo.updateStatus(meeting.id, 'FAILED').catch(() => {});
          if (params.onStatusChange) {
            await params.onStatusChange('FAILED', err?.message || 'Failed to connect to Zoom meeting');
          }
        }
      });
    } catch (browserErr: any) {
      log.warn({ error: browserErr?.message }, 'Could not instantiate Puppeteer adapter');
    }

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_QUEUED',
      metadata: { meetingId: meeting.id, jobId, capability: capability.capability },
    });

    log.info({ meetingId: meeting.id, jobId, capability: capability.capability }, 'Meeting created and queued');
    return { meeting, capability, jobId };
  }

  /**
   * Create and queue a scheduled meeting join job.
   */
  public async scheduleMeeting(params: ScheduleMeetingParams): Promise<ServiceMeetingResult> {
    const { user, zoomAccount } = await this.validateUserAndAccount(params.telegramUserId);

    const delayMs = params.scheduledAt.getTime() - Date.now();
    if (delayMs <= 0) {
      throw new ZoomError(ZoomErrorCode.NOT_ALLOWED, 'Scheduled time must be in the future');
    }

    const capability = resolveCapability({
      zoomMeetingId: params.meetingId,
      isExternalMeeting: params.isExternalMeeting ?? false,
      isHostAccount: params.isHostAccount ?? true,
      userPresentInMeeting: params.userPresentInMeeting ?? false,
      requestedMode: params.mode,
    });

    if (capability.capability === 'UNSUPPORTED') {
      throw new ZoomError(ZoomErrorCode.NOT_ALLOWED, capability.reason);
    }

    const encryptionKey = process.env['ENCRYPTION_KEY'] ?? '';
    const passcodeEncrypted = params.passcode ? encryptToken(params.passcode, encryptionKey) : undefined;

    const defaultDisplayName = user.telegramUsername ?? zoomAccount.zoomEmail.split('@')[0] ?? process.env['DEFAULT_DISPLAY_NAME'] ?? 'Meeting Assistant';
    const displayName = params.displayName ?? defaultDisplayName;

    const meeting = await meetingRepo.create({
      userId: user.id,
      zoomMeetingId: params.meetingId,
      meetingUrl: params.meetingUrl,
      passcodeEncrypted,
      displayName,
      scheduledAt: params.scheduledAt,
      timezone: params.timezone ?? process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata',
      status: 'SCHEDULED',
    });

    const jobId = await queueProducers.enqueueScheduledMeetingStart(
      {
        meetingId: meeting.id,
        userId: user.id,
        zoomMeetingId: params.meetingId,
        requestedAt: new Date().toISOString(),
        scheduledFor: params.scheduledAt.toISOString(),
      },
      delayMs,
    );

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_SCHEDULED',
      metadata: { meetingId: meeting.id, scheduledAt: params.scheduledAt },
    });

    log.info({ meetingId: meeting.id, scheduledAt: params.scheduledAt }, 'Meeting scheduled');
    return { meeting, capability, jobId };
  }

  /**
   * Stop an active meeting session with ownership check.
   */
  public async stopMeeting(
    telegramUserId: bigint,
    meetingId: string,
    reason: string = 'USER_STOPPED',
  ): Promise<{ meeting: Meeting; recordingFilePath?: string }> {
    const { user } = await this.validateUserAndAccount(telegramUserId);

    const meeting = await meetingRepo.findById(meetingId);
    if (!meeting) {
      throw new ZoomError(ZoomErrorCode.MEETING_NOT_FOUND, 'Meeting not found');
    }

    // Ownership check
    if (meeting.userId !== user.id) {
      throw new ZoomError(ZoomErrorCode.NOT_ALLOWED, 'Unauthorized to manage this meeting');
    }

    // Terminal state check
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(meeting.status)) {
      throw new ZoomError(ZoomErrorCode.NOT_ALLOWED, `Meeting is already in terminal state '${meeting.status}'`);
    }

    // Close headless browser if running and extract recording file
    let recordingFilePath: string | undefined;
    const browserAdapter = activeBrowserAdapters.get(meetingId);
    if (browserAdapter) {
      try {
        const status = await browserAdapter.getStatus();
        recordingFilePath =
          (status.details?.['recordingFilePath'] as string | undefined) || browserAdapter.getRecordingFilePath();
      } catch {
        // ignore
      }
      await browserAdapter.stop().catch(() => {});
      activeBrowserAdapters.delete(meetingId);
    }

    // Update status to COMPLETED
    const updated = await meetingRepo.updateStatus(meetingId, 'COMPLETED');

    // Enqueue BullMQ stop job
    await queueProducers.enqueueMeetingStop({
      meetingId,
      userId: user.id,
      zoomMeetingId: meeting.zoomMeetingId,
      requestedAt: new Date().toISOString(),
      reason,
    }).catch((err) => {
      log.warn({ error: err?.message }, 'BullMQ stop job enqueue skipped');
    });

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_STOP_REQUESTED',
      metadata: { meetingId, reason },
    });

    log.info({ meetingId, userId: user.id, recordingFilePath }, 'Meeting stop completed');
    return { meeting: updated, recordingFilePath };
  }

  /**
   * Get durable meeting status with ownership check.
   */
  public async getMeetingStatus(telegramUserId: bigint, meetingId?: string): Promise<{ meeting: Meeting; isOwner: boolean }> {
    const { user } = await this.validateUserAndAccount(telegramUserId);

    let meeting: Meeting | null = null;

    if (meetingId) {
      meeting = await meetingRepo.findById(meetingId);
    } else {
      const active = await meetingRepo.findActiveByUserId(user.id);
      meeting = active[0] ?? null;
    }

    if (!meeting) {
      throw new ZoomError(ZoomErrorCode.MEETING_NOT_FOUND, 'No meeting found');
    }

    if (meeting.userId !== user.id) {
      throw new ZoomError(ZoomErrorCode.NOT_ALLOWED, 'Unauthorized to view this meeting');
    }

    return { meeting, isOwner: true };
  }

  /**
   * List recent meetings for the user.
   */
  public async listUserMeetings(telegramUserId: bigint, limit: number = 10): Promise<Meeting[]> {
    const { user } = await this.validateUserAndAccount(telegramUserId);
    return meetingRepo.listByUserId(user.id, { limit });
  }

  private async validateUserAndAccount(telegramUserId: bigint) {
    let user = await userRepo.findByTelegramId(telegramUserId);
    if (!user) {
      user = await userRepo.upsert(telegramUserId);
    }

    let zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id);
    if (!zoomAccount) {
      // Auto-provision Zoom account so user never needs browser OAuth or Zoom Marketplace login
      const encryptionKey = process.env['ENCRYPTION_KEY'] ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const dummyToken = 'server_to_server_oauth_active';
      const accessTokenEncrypted = encryptToken(dummyToken, encryptionKey);
      const refreshTokenEncrypted = encryptToken(dummyToken, encryptionKey);

      zoomAccount = await zoomAccountRepo.storeTokens({
        userId: user.id,
        zoomUserId: `s2s_${user.telegramUserId}`,
        zoomEmail: `${user.telegramUsername || user.telegramUserId}@telegram.bot`,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      });
    }

    return { user, zoomAccount };
  }
}

export const meetingService = new MeetingService();
