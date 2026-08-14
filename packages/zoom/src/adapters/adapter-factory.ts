import type { MeetingAdapter } from './adapter-interface.js';
import { RtmsMediaAdapter } from './rtms-adapter.js';
import { PuppeteerZoomAdapter } from './puppeteer-adapter.js';
import type { ZoomCapability } from '../capabilities/capability-types.js';

export interface AdapterFactoryParams {
  capability: ZoomCapability;
  userId: string;
  accessToken: string;
  meetingId: string;
  passcode?: string;
  displayName?: string;
}

/**
 * Creates the appropriate capability-independent MeetingAdapter instance.
 */
export function createMeetingAdapter(params: AdapterFactoryParams): MeetingAdapter {
  switch (params.capability) {
    case 'RTMS_MEDIA':
      return new RtmsMediaAdapter(params.userId, params.accessToken, params.meetingId);
    default:
      return new PuppeteerZoomAdapter(
        params.userId,
        params.meetingId,
        params.passcode,
        params.displayName ?? 'Meeting Assistant',
      );
  }
}
