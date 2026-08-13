/**
 * Supported Zoom integration capabilities determined dynamically by the resolver.
 */
export type ZoomCapability =
  | 'ZAK_PARTICIPANT'  // Joins as authenticated Zoom user (Host or same-account user)
  | 'OBF_PARTICIPANT'  // Joins as automated participant app (requires authorized user presence for external meetings)
  | 'RTMS_MEDIA'        // Real Time Media Streams (autonomous audio/video/transcript without participant tile)
  | 'UNSUPPORTED';      // Permitted integration path not available for requested parameters

export interface CapabilityContext {
  zoomMeetingId: string;
  isExternalMeeting: boolean;
  isHostAccount: boolean;
  userPresentInMeeting: boolean;
  requestedMode?: 'PARTICIPANT' | 'MEDIA_ONLY';
}

export interface CapabilityResolution {
  capability: ZoomCapability;
  reason: string;
  requiresUserPresence: boolean;
  requiresAppReview: boolean;
}
