import { randomBytes } from 'node:crypto';
import { getDb } from '../client.js';


export const oauthStateRepo = {
  /**
   * Create a cryptographically random OAuth state and store it.
   * The state expires after `expiryMinutes` (default: 10).
   */
  async create(telegramUserId: bigint, expiryMinutes: number = 10): Promise<string> {
    const state = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    await getDb().oAuthState.create({
      data: { state, telegramUserId, expiresAt },
    });

    return state;
  },

  /**
   * Consume an OAuth state: find it, verify it hasn't expired,
   * delete it (one-time use), and return the associated Telegram user ID.
   * Returns null if the state is invalid or expired.
   */
  async consumeAndDelete(state: string): Promise<bigint | null> {
    const record = await getDb().oAuthState.findUnique({ where: { state } });

    if (!record) return null;
    if (record.expiresAt < new Date()) {
      // Expired — clean up and reject
      await getDb().oAuthState.delete({ where: { state } }).catch(() => {});
      return null;
    }

    // Delete immediately to prevent replay
    await getDb().oAuthState.delete({ where: { state } });
    return record.telegramUserId;
  },

  /** Clean up all expired states (call periodically) */
  async cleanExpired(): Promise<number> {
    const result = await getDb().oAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  },
};
