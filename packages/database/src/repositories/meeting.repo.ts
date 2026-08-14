import { getDb } from '../client.js';
import type { Meeting, MeetingStatus } from '@prisma/client';

export const meetingRepo = {
  async create(data: {
    userId: string;
    zoomMeetingId: string;
    meetingUrl: string;
    passcodeEncrypted?: string;
    topic?: string;
    displayName?: string;
    scheduledAt?: Date;
    timezone?: string;
    status?: MeetingStatus;
    actualStart?: Date;
  }): Promise<Meeting> {
    return getDb().meeting.create({ data });
  },

  async findById(id: string): Promise<Meeting | null> {
    return getDb().meeting.findUnique({
      where: { id },
      include: { botSessions: true },
    });
  },

  async findActiveByUserId(userId: string): Promise<Meeting[]> {
    return getDb().meeting.findMany({
      where: {
        userId,
        status: {
          in: [
            'CREATED', 'SCHEDULED', 'STARTING', 'AUTHENTICATING',
            'SDK_INITIALIZING', 'JOINING', 'WAITING_ROOM',
            'CONNECTED', 'RECONNECTING',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findByUserIdAndMeetingId(
    userId: string,
    zoomMeetingId: string,
  ): Promise<Meeting | null> {
    return getDb().meeting.findFirst({
      where: {
        userId,
        zoomMeetingId,
        status: {
          notIn: ['COMPLETED', 'FAILED', 'CANCELLED'],
        },
      },
    });
  },

  async updateStatus(id: string, status: MeetingStatus): Promise<Meeting> {
    const data: Record<string, unknown> = { status };
    if (status === 'CONNECTED') data['actualStart'] = new Date();
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) data['actualEnd'] = new Date();

    return getDb().meeting.update({ where: { id }, data });
  },

  async listByUserId(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Meeting[]> {
    return getDb().meeting.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 10,
      skip: options?.offset ?? 0,
    });
  },
};
