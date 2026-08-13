import {
  userRepo,
  zoomAccountRepo,
  meetingRepo,
  auditRepo,
  type Meeting,
} from '../index.js';
import { queueProducers } from '@zoom-assistant/queue';
import { resolveCapability, type CapabilityResolution } from '@zoom-assistant/zoom';
import { encryptToken } from '@zoom-assistant/crypto';
import { createLogger, ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

const log = createLogger({ module: 'meeting-service' });

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
    log.debug({ email: zoomAccount.zoomEmail }, 'Validated Zoom account');

    // Prevent duplicate active sessions
    const activeMeetings = await meetingRepo.findActiveByUserId(user.id);
    if (activeMeetings.length > 0) {
      throw new ZoomError(ZoomErrorCode.DUPLICATE_SESSION, 'Active meeting session already exists');
    }

    // Resolve capability
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

    // Encrypt passcode if provided
    const encryptionKey = process.env['ENCRYPTION_KEY'] ?? '';
    const passcodeEncrypted = params.passcode ? encryptToken(params.passcode, encryptionKey) : undefined;

    // Create DB meeting record
    const meeting = await meetingRepo.create({
      userId: user.id,
      zoomMeetingId: params.meetingId,
      meetingUrl: params.meetingUrl,
      passcodeEncrypted,
      displayName: params.displayName ?? process.env['DEFAULT_DISPLAY_NAME'] ?? 'Meeting Assistant',
      status: 'CREATED',
    });

    // Enqueue BullMQ start job with deterministic job ID
    const jobId = await queueProducers.enqueueMeetingStart({
      meetingId: meeting.id,
      userId: user.id,
      zoomMeetingId: params.meetingId,
      requestedAt: new Date().toISOString(),
      mode: params.mode,
    });

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
    const { user } = await this.validateUserAndAccount(params.telegramUserId);

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

    const meeting = await meetingRepo.create({
      userId: user.id,
      zoomMeetingId: params.meetingId,
      meetingUrl: params.meetingUrl,
      passcodeEncrypted,
      displayName: params.displayName ?? process.env['DEFAULT_DISPLAY_NAME'] ?? 'Meeting Assistant',
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
  public async stopMeeting(telegramUserId: bigint, meetingId: string, reason: string = 'USER_STOPPED'): Promise<Meeting> {
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

    // Update status to STOPPING
    const updated = await meetingRepo.updateStatus(meetingId, 'STOPPING');

    // Enqueue BullMQ stop job
    await queueProducers.enqueueMeetingStop({
      meetingId,
      userId: user.id,
      zoomMeetingId: meeting.zoomMeetingId,
      requestedAt: new Date().toISOString(),
      reason,
    });

    await auditRepo.log({
      userId: user.id,
      action: 'MEETING_STOP_REQUESTED',
      metadata: { meetingId, reason },
    });

    log.info({ meetingId, userId: user.id }, 'Meeting stop enqueued');
    return updated;
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
    const user = await userRepo.findByTelegramId(telegramUserId);
    if (!user) {
      throw new ZoomError(ZoomErrorCode.USER_NOT_AUTHORIZED, 'User not registered');
    }

    const zoomAccount = await zoomAccountRepo.findActiveByUserId(user.id);
    if (!zoomAccount) {
      throw new ZoomError(ZoomErrorCode.USER_NOT_AUTHORIZED, 'No active Zoom account connected');
    }

    return { user, zoomAccount };
  }
}

export const meetingService = new MeetingService();
