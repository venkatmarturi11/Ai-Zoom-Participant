import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/encryption.js';

describe('AES-256-GCM Encryption', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex = 32 bytes

  it('encrypts and decrypts correctly', () => {
    const originalText = 'secret_access_token_12345';
    const encrypted = encrypt(originalText, testKey);

    assert.notEqual(encrypted, originalText);
    assert.equal(typeof encrypted, 'string');

    const decrypted = decrypt(encrypted, testKey);
    assert.equal(decrypted, originalText);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const text = 'same_plaintext';
    const enc1 = encrypt(text, testKey);
    const enc2 = encrypt(text, testKey);

    assert.notEqual(enc1, enc2);
    assert.equal(decrypt(enc1, testKey), text);
    assert.equal(decrypt(enc2, testKey), text);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('sensitive_data', testKey);
    const tamperedBuf = Buffer.from(encrypted, 'base64');
    if (tamperedBuf.length > 0) {
      tamperedBuf[tamperedBuf.length - 1] = (tamperedBuf[tamperedBuf.length - 1] ?? 0) ^ 1;
    }

    const tampered = tamperedBuf.toString('base64');

    assert.throws(() => decrypt(tampered, testKey));
  });

  it('throws on invalid key length', () => {
    assert.throws(() => encrypt('test', 'short_key'));
  });
});
