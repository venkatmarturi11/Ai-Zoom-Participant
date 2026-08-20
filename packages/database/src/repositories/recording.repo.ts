import { getDb } from '../client.js';
import type { MeetingRecording } from '@prisma/client';

export const recordingRepo = {
  async saveRecording(data: {
    meetingId: string;
    zoomMeetingId: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    videoData: Buffer;
    downloadUrl?: string;
  }): Promise<MeetingRecording> {
    return getDb().meetingRecording.create({
      data: {
        meetingId: data.meetingId,
        zoomMeetingId: data.zoomMeetingId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType ?? 'video/mp4',
        videoData: data.videoData,
        downloadUrl: data.downloadUrl,
      },
    });
  },

  async findById(id: string): Promise<MeetingRecording | null> {
    return getDb().meetingRecording.findUnique({
      where: { id },
    });
  },

  async findLatestByMeetingId(meetingId: string): Promise<MeetingRecording | null> {
    return getDb().meetingRecording.findFirst({
      where: { meetingId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async listRecent(limit = 10): Promise<Array<Omit<MeetingRecording, 'videoData'>>> {
    return getDb().meetingRecording.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        meetingId: true,
        zoomMeetingId: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        downloadUrl: true,
        createdAt: true,
      },
    });
  },

  async delete(id: string): Promise<MeetingRecording> {
    return getDb().meetingRecording.delete({
      where: { id },
    });
  },

  async deleteAll(): Promise<{ count: number }> {
    return getDb().meetingRecording.deleteMany({});
  },
};
