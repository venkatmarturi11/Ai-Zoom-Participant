import { getZakToken } from '../zak.js';
import { createLogger } from '@zoom-assistant/shared';

const log = createLogger({ module: 'zak-poc' });

export interface ZakPocResult {
  success: boolean;
  zakTokenObtained: boolean;
  tokenLength?: number;
  error?: string;
  notes: string;
}

/**
 * Phase 2 POC Test A: ZAK Token Capability Verification
 *
 * Verifies if the configured OAuth credentials can obtain a valid ZAK token
 * for user-authenticated meeting participation.
 */
export async function runZakPoc(userId: string, accessToken: string): Promise<ZakPocResult> {
  log.info({ userId }, 'Starting Phase 2 Test A: ZAK Capability Verification');

  try {
    const token = await getZakToken(userId, accessToken);

    log.info({ userId, tokenLength: token.length }, 'ZAK token successfully retrieved');

    return {
      success: true,
      zakTokenObtained: true,
      tokenLength: token.length,
      notes:
        'ZAK token retrieved successfully. ZAK permits joining/starting meetings as the authenticated user. ' +
        'Valid for meetings within authorized user account.',
    };
  } catch (err: any) {
    log.error({ userId, error: err.message }, 'ZAK token retrieval failed');

    return {
      success: false,
      zakTokenObtained: false,
      error: err.message,
      notes: 'ZAK token retrieval failed. Check OAuth scopes (user:read or user:read:admin required).',
    };
  }
}
