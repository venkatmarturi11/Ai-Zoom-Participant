// ============================================================
// Zoom meeting URL parser
// ============================================================
// Supported formats:
//   https://zoom.us/j/123456789
//   https://us06web.zoom.us/j/123456789?pwd=XXXXXXXX
//   https://zoom.us/j/123456789?pwd=abc123
//   https://zoom.us/my/vanity-name
//   https://us02web.zoom.us/j/99999999999?pwd=xxx
//
// Rejects:
//   javascript:, file:, data:, localhost, non-Zoom domains
// ============================================================

export interface ParsedMeeting {
  meetingId: string;
  passcode: string | null;
  domain: string;
  isVanityUrl: boolean;
  originalUrl: string;
}

export interface ParseResult {
  success: true;
  meeting: ParsedMeeting;
}

export interface ParseError {
  success: false;
  error: string;
}

export type MeetingParseResult = ParseResult | ParseError;

/** Allowlisted Zoom hostname patterns */
const ZOOM_HOST_PATTERN = /^([a-z0-9-]+\.)?zoom\.us$/i;

/** Meeting ID path pattern: /j/{id}, /w/{id}, /wc/{id}, /wc/{id}/join, /wc/{id}/start */
const MEETING_PATH_PATTERN = /^\/(?:j|w|wc)\/(\d{9,11})(?:\/(?:join|start))?$/i;

/** Vanity URL path pattern: /my/{name} */
const VANITY_PATH_PATTERN = /^\/my\/([a-zA-Z0-9._-]+)$/;

/** Dangerous URL schemes that must be rejected */
const BLOCKED_SCHEMES = new Set(['javascript:', 'file:', 'data:', 'vbscript:']);

/**
 * Parse a Zoom meeting invitation URL and extract meeting ID + passcode.
 *
 * Security:
 *   - Only accepts HTTPS URLs on verified Zoom domains
 *   - Rejects javascript:, file:, data:, and other dangerous schemes
 *   - Validates meeting ID format (9-11 digits)
 *   - Does not execute or follow the URL
 */
export function parseMeetingUrl(input: string): MeetingParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { success: false, error: 'No URL provided. Please send a Zoom meeting link.' };
  }

  // Block dangerous schemes before URL parsing
  const lowerInput = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerInput.startsWith(scheme)) {
      return { success: false, error: 'Invalid URL scheme. Please send a valid Zoom HTTPS link.' };
    }
  }

  // Parse as URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { success: false, error: 'Invalid URL format. Please send a valid Zoom meeting link.' };
  }

  // Enforce HTTPS
  if (url.protocol !== 'https:') {
    return { success: false, error: 'Only HTTPS Zoom links are accepted.' };
  }

  // Verify Zoom domain
  if (!ZOOM_HOST_PATTERN.test(url.hostname)) {
    return { success: false, error: 'This is not a Zoom meeting link. Please send a zoom.us URL.' };
  }

  // Try standard meeting path: /j/{meetingId} or /w/{meetingId} or /s/{meetingId}
  const meetingMatch = MEETING_PATH_PATTERN.exec(url.pathname);
  if (meetingMatch?.[1]) {
    const meetingId = meetingMatch[1];
    const passcode = url.searchParams.get('pwd') || null;

    return {
      success: true,
      meeting: {
        meetingId,
        passcode,
        domain: url.hostname,
        isVanityUrl: false,
        originalUrl: trimmed,
      },
    };
  }

  // Try registration URL: /meeting/register/{token} or /webinar/register/{token}
  const regMatch = /^\/(?:meeting|webinar)\/register\/([^/?#]+)/i.exec(url.pathname);
  if (regMatch?.[1]) {
    return {
      success: true,
      meeting: {
        meetingId: regMatch[1],
        passcode: url.searchParams.get('pwd') || null,
        domain: url.hostname,
        isVanityUrl: false,
        originalUrl: trimmed,
      },
    };
  }

  // Try vanity URL: /my/{name}
  const vanityMatch = VANITY_PATH_PATTERN.exec(url.pathname);
  if (vanityMatch?.[1]) {
    // Vanity URLs don't contain a numeric meeting ID directly.
    // The meeting ID must be resolved via Zoom API or by joining with the vanity name.
    return {
      success: true,
      meeting: {
        meetingId: vanityMatch[1], // This is the vanity name, not the numeric ID
        passcode: url.searchParams.get('pwd') || null,
        domain: url.hostname,
        isVanityUrl: true,
        originalUrl: trimmed,
      },
    };
  }

  return {
    success: false,
    error:
      'Could not extract a meeting ID from this URL.\nExpected format: https://zoom.us/j/123456789',
  };
}

/**
 * Validate a standalone meeting ID string (without URL).
 * Meeting IDs are 9–11 digits.
 */
export function isValidMeetingId(id: string): boolean {
  return /^\d{9,11}$/.test(id.trim());
}

/**
 * Extract text that looks like a Zoom URL from a longer message.
 * Useful when users paste an entire invitation block.
 */
export function extractZoomUrl(text: string): string | null {
  const urlPattern = /https:\/\/[a-z0-9.-]*zoom\.us\/[^\s]+/i;
  const match = urlPattern.exec(text);
  return match ? match[0] : null;
}
