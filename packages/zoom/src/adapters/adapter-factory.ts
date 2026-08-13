import type { MeetingAdapter } from './adapter-interface.js';
import { ZakParticipantAdapter } from './zak-adapter.js';
import { ObfParticipantAdapter } from './obf-adapter.js';
import { RtmsMediaAdapter } from './rtms-adapter.js';
import type { ZoomCapability } from '../capabilities/capability-types.js';
import { ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

export interface AdapterFactoryParams {
  capability: ZoomCapability;
  userId: string;
  accessToken: string;
  meetingId: string;
  passcode?: string;
}

/**
 * Creates the appropriate capability-independent MeetingAdapter instance.
 */
export function createMeetingAdapter(params: AdapterFactoryParams): MeetingAdapter {
  switch (params.capability) {
    case 'ZAK_PARTICIPANT':
      return new ZakParticipantAdapter(params.userId, params.accessToken, params.meetingId, params.passcode);
    case 'OBF_PARTICIPANT':
      return new ObfParticipantAdapter(params.userId, params.accessToken, params.meetingId, params.passcode);
    case 'RTMS_MEDIA':
      return new RtmsMediaAdapter(params.userId, params.accessToken, params.meetingId);
    case 'UNSUPPORTED':
    default:
      throw new ZoomError(
        ZoomErrorCode.NOT_ALLOWED,
        `Cannot create adapter for capability '${params.capability}'. Zoom authorization requirements not met.`,
      );
  }
}
