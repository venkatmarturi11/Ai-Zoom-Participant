import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'zoom-recordings' });

export interface RecordingFile {
  id: string;
  meetingId: string;
  recordingStart: string;
  recordingEnd: string;
  fileType: string;
  fileSize: number;
  playUrl: string;
  downloadUrl: string;
  status: string;
}

export interface MeetingRecordingsResult {
  id: string;
  topic: string;
  duration: number;
  totalSize: number;
  recordingCount: number;
  shareUrl?: string;
  recordingFiles: RecordingFile[];
}

/**
 * Fetch cloud recordings for a specific Zoom meeting.
 */
export async function getMeetingRecordings(
  meetingId: string,
  accessToken: string,
): Promise<MeetingRecordingsResult | null> {
  const url = `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/recordings`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      log.info({ meetingId }, 'No cloud recordings found yet for meeting (may still be processing)');
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn({ meetingId, status: response.status, body }, 'Failed to fetch Zoom recordings');
      return null;
    }

    const data = (await response.json()) as any;

    const files: RecordingFile[] = (data.recording_files || []).map((f: any) => ({
      id: f.id,
      meetingId: f.meeting_id,
      recordingStart: f.recording_start,
      recordingEnd: f.recording_end,
      fileType: f.file_type,
      fileSize: f.file_size,
      playUrl: f.play_url,
      downloadUrl: f.download_url,
      status: f.status,
    }));

    return {
      id: String(data.id || meetingId),
      topic: data.topic || 'Zoom Meeting',
      duration: data.duration || 0,
      totalSize: data.total_size || 0,
      recordingCount: data.recording_count || files.length,
      shareUrl: data.share_url,
      recordingFiles: files,
    };
  } catch (err: any) {
    log.error({ meetingId, error: err.message }, 'Error requesting Zoom recordings API');
    return null;
  }
}
