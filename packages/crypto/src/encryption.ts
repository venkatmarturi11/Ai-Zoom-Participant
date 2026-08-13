import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * AES-256-GCM authenticated encryption.
 *
 * Output format: base64( IV (12 bytes) || AuthTag (16 bytes) || Ciphertext )
 *
 * Each call generates a fresh random IV — safe for the same key.
 *
 * @param plaintext - The string to encrypt (e.g., access_token, refresh_token)
 * @param keyHex   - 64-character hex string (32 bytes)
 * @returns base64-encoded encrypted payload
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (64 hex characters)');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: IV || AuthTag || Ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * AES-256-GCM authenticated decryption.
 *
 * @param encryptedBase64 - base64-encoded payload from encrypt()
 * @param keyHex          - 64-character hex string (32 bytes), same key used for encryption
 * @returns the original plaintext string
 * @throws if the key is wrong, data is tampered, or format is invalid
 */
export function decrypt(encryptedBase64: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (64 hex characters)');
  }

  const packed = Buffer.from(encryptedBase64, 'base64');
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export { encrypt as encryptToken, decrypt as decryptToken };
