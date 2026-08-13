import { getObfToken } from '../obf.js';
import { createLogger } from '@zoom-assistant/shared';

export interface ObfPocResult {
  success: boolean;
  obfTokenObtained: boolean;
  tokenLength?: number;
  error?: string;
  notes: string;
}

/**
 * Phase 2 POC Test B: OBF Token Capability Verification
 *
 * Verifies if the configured OAuth credentials can obtain an On Behalf Of (OBF) token
 * and documents external meeting presence constraints.
 */
export async function runObfPoc(userId: string, accessToken: string): Promise<ObfPocResult> {
  log.info({ userId }, 'Starting Phase 2 Test B: OBF Capability Verification');

  try {
    const token = await getObfToken(userId, accessToken);

    log.info({ userId, tokenLength: token.length }, 'OBF token successfully retrieved');

    return {
      success: true,
      obfTokenObtained: true,
      tokenLength: token.length,
      notes:
        'OBF token retrieved successfully. ' +
        'CRITICAL LIMITATION: For external meetings, Zoom requires the authorized user to be actively present in the meeting. ' +
        'If the user leaves, the OBF session terminates.',
    };
  } catch (err: any) {
    log.error({ userId, error: err.message }, 'OBF token retrieval failed');

    return {
      success: false,
      obfTokenObtained: false,
      error: err.message,
      notes: 'OBF token retrieval failed. Check OAuth scopes (user:read:token required).',
    };
  }
}

const log = createLogger({ module: 'obf-poc' });
