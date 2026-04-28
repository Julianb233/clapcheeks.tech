/**
 * AI-8766 — Token vault for Clapcheeks platform tokens.
 *
 * Provides application-level AES-256-GCM encryption / decryption for the
 * platform auth tokens (Tinder, Hinge, Bumble, Instagram) stored in
 * `clapcheeks_user_settings`. The encryption key is derived per-user from a
 * shared master key + the user_id (used as the scrypt salt) so:
 *
 *   - A leaked single-row blob does not reveal the master key.
 *   - Each user's blobs are independently keyed; cross-user replay is
 *     impossible even with master-key knowledge.
 *   - Master-key rotation = re-derive + re-encrypt all rows. The
 *     `token_enc_version` column is bumped to mark migrated rows.
 *
 * Wire format of an encrypted blob (Buffer):
 *
 *     byte 0       : version (currently 1)
 *     bytes 1..12  : iv (12 random bytes — GCM standard)
 *     bytes 13..28 : GCM auth tag (16 bytes)
 *     bytes 29..   : ciphertext
 *
 * This MUST stay byte-for-byte compatible with
 * `agent/clapcheeks/auth/token_vault.py`.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES // 29

// scrypt parameters — must match the Python side.
// N=16384 (2**14), r=8, p=1 is the default the cryptography Python lib uses
// and remains the recommended interactive baseline (RFC 7914 / OWASP 2024).
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

function masterKey(): Buffer {
  const raw = process.env.CLAPCHEEKS_TOKEN_MASTER_KEY
  if (!raw) {
    throw new Error(
      'CLAPCHEEKS_TOKEN_MASTER_KEY not set. ' +
        'Generate with: openssl rand -base64 32',
    )
  }
  // Allow base64 OR base64url; trim whitespace/newlines.
  const cleaned = raw.trim().replace(/-/g, '+').replace(/_/g, '/')
  const buf = Buffer.from(cleaned, 'base64')
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `CLAPCHEEKS_TOKEN_MASTER_KEY must decode to ${KEY_BYTES} bytes, ` +
        `got ${buf.length}. Generate with: openssl rand -base64 32`,
    )
  }
  return buf
}

function deriveKey(userId: string): Buffer {
  if (!userId) {
    throw new Error('deriveKey: userId required (used as scrypt salt)')
  }
  return scryptSync(masterKey(), Buffer.from(userId, 'utf8'), KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt's default maxmem is too small for N=16384; raise it.
    maxmem: 64 * 1024 * 1024,
  })
}

/**
 * Encrypt a UTF-8 string for `userId`.
 * Returns the wire-format Buffer. Caller writes it directly to a `bytea`
 * Postgres column.
 */
export function encryptToken(plaintext: string, userId: string): Buffer {
  if (typeof plaintext !== 'string') {
    throw new Error('encryptToken: plaintext must be a string')
  }
  const key = deriveKey(userId)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_BYTES) {
    throw new Error(`unexpected GCM tag length ${tag.length}`)
  }
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct])
}

/**
 * Decrypt a wire-format blob for `userId`. Throws if the blob was encrypted
 * for a different user, with a different master key, or if it was tampered
 * with (GCM auth tag will fail).
 */
export function decryptToken(blob: Buffer | Uint8Array, userId: string): string {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
  if (buf.length < HEADER_BYTES + 1) {
    throw new Error(`decryptToken: blob too short (${buf.length} bytes)`)
  }
  const version = buf[0]
  if (version !== VERSION) {
    throw new Error(`decryptToken: unsupported vault version ${version}`)
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, HEADER_BYTES)
  const ct = buf.subarray(HEADER_BYTES)
  const key = deriveKey(userId)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/**
 * Convenience for callers that already have a hex-encoded blob (e.g. read
 * from Supabase as the default \x-prefixed bytea representation).
 */
export function decryptTokenHex(hex: string, userId: string): string {
  // Postgres bytea hex format is `\x...`; strip the prefix if present.
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  return decryptToken(Buffer.from(clean, 'hex'), userId)
}

export const _internals = {
  VERSION,
  HEADER_BYTES,
  IV_BYTES,
  TAG_BYTES,
  KEY_BYTES,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  deriveKey,
}
