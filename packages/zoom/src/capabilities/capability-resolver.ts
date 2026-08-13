import type { CapabilityContext, CapabilityResolution } from './capability-types.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'capability-resolver' });

/**
 * Resolves which Zoom authorization mechanism (ZAK, OBF, or RTMS) is legally
 * and technically applicable for a given meeting context.
 *
 * Rules (reflecting March 2026+ Zoom authorization enforcement):
 *   1. If user requested MEDIA_ONLY: resolve to RTMS_MEDIA (autonomous, no tile).
 *   2. If meeting is inside app owner's account or user is Host: resolve to ZAK_PARTICIPANT.
 *   3. If meeting is external AND user is present: resolve to OBF_PARTICIPANT.
 *   4. If meeting is external AND user is absent AND participant requested: UNSUPPORTED with explanatory reason.
 */
export function resolveCapability(context: CapabilityContext): CapabilityResolution {
  log.debug({ context }, 'Resolving Zoom capability');

  if (context.requestedMode === 'MEDIA_ONLY') {
    return {
      capability: 'RTMS_MEDIA',
      reason: 'Requested real-time media/transcript processing without visible participant tile.',
      requiresUserPresence: false,
      requiresAppReview: true,
    };
  }

  // Host or internal account meeting
  if (!context.isExternalMeeting || context.isHostAccount) {
    return {
      capability: 'ZAK_PARTICIPANT',
      reason: 'Meeting is hosted by user or within account. ZAK token user login permitted.',
      requiresUserPresence: false,
      requiresAppReview: false,
    };
  }

  // External meeting: check OBF requirements
  if (context.isExternalMeeting) {
    if (context.userPresentInMeeting) {
      return {
        capability: 'OBF_PARTICIPANT',
        reason: 'External meeting with authorized user present. OBF automated participant permitted.',
        requiresUserPresence: true,
        requiresAppReview: true,
      };
    }

    // External meeting + user absent + participant tile requested = UNSUPPORTED by Zoom policy
    return {
      capability: 'UNSUPPORTED',
      reason:
        'Zoom requires the authorized user to be present in external meetings for OBF bot participants. ' +
        'For autonomous operation while absent, RTMS_MEDIA must be used.',
      requiresUserPresence: true,
      requiresAppReview: true,
    };
  }

  return {
    capability: 'UNSUPPORTED',
    reason: 'Unable to determine valid Zoom authorization path for context.',
    requiresUserPresence: false,
    requiresAppReview: false,
  };
}
