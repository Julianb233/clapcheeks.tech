// AI-8766 — Node-side tests for the platform-token vault.
//
// Uses node:test (already used by other tests in this repo) so no extra dep.
// Run with:
//     CLAPCHEEKS_TOKEN_MASTER_KEY=$(openssl rand -base64 32) \
//         node --test web/__tests__/token-vault.test.mjs
//
// The web package itself imports the helper via TypeScript path alias '@/'.
// We sidestep ts-node by inlining a tiny copy of the helper here that
// references the SAME crypto primitives, scrypt params, and wire format.
// If you change the production helper at web/lib/crypto/token-vault.ts,
// keep this in sync — the cross-language Python suite has the canonical
// roundtrip test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function deriveKey(masterB64, userId) {
  const cleaned = masterB64.trim().replace(/-/g, '+').replace(/_/g, '/')
  const master = Buffer.from(cleaned, 'base64')
  if (master.length !== KEY_BYTES) throw new Error(`bad master key length ${master.length}`)
  return scryptSync(master, Buffer.from(userId, 'utf8'), KEY_BYTES, SCRYPT)
}

function encryptToken(plain, userId, masterB64) {
  const key = deriveKey(masterB64, userId)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct])
}

function decryptToken(blob, userId, masterB64) {
  if (blob.length < HEADER_BYTES + 1) throw new Error('blob too short')
  const version = blob[0]
  if (version !== VERSION) throw new Error(`bad version ${version}`)
  const iv = blob.subarray(1, 1 + IV_BYTES)
  const tag = blob.subarray(1 + IV_BYTES, HEADER_BYTES)
  const ct = blob.subarray(HEADER_BYTES)
  const key = deriveKey(masterB64, userId)
  const dec = createDecipheriv('aes-256-gcm', key, iv)
  dec.setAuthTag(tag)
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8')
}

const MASTER = Buffer.alloc(32, 0x42).toString('base64')

test('encryptToken / decryptToken roundtrip', () => {
  const blob = encryptToken('test-token-abc', 'user-123', MASTER)
  assert.equal(blob[0], 1, 'version byte')
  assert.equal(decryptToken(blob, 'user-123', MASTER), 'test-token-abc')
})

test('decryptToken with wrong user_id throws', () => {
  const blob = encryptToken('secret', 'alice', MASTER)
  assert.throws(() => decryptToken(blob, 'bob', MASTER), /unable to authenticate/i)
})

test('decryptToken rejects unknown version byte', () => {
  const blob = encryptToken('secret', 'alice', MASTER)
  blob[0] = 99
  assert.throws(() => decryptToken(blob, 'alice', MASTER), /bad version/)
})

test('decryptToken rejects truncated input', () => {
  assert.throws(() => decryptToken(Buffer.from([1, 2, 3]), 'alice', MASTER), /too short/)
})

test('long JSON blob roundtrips', () => {
  const plain = JSON.stringify({
    sessionid: 'a'.repeat(64),
    ds_user_id: '12345',
    csrftoken: 'b'.repeat(32),
    mid: 'ZZ-MID',
  })
  const blob = encryptToken(plain, 'user-XYZ', MASTER)
  assert.equal(decryptToken(blob, 'user-XYZ', MASTER), plain)
})

test('non-deterministic ciphertext for same plaintext', () => {
  // GCM uses a fresh random IV each call — two encrypts of the same
  // plaintext under the same key must produce different ciphertexts.
  const a = encryptToken('same', 'alice', MASTER)
  const b = encryptToken('same', 'alice', MASTER)
  assert.notDeepEqual(a, b)
  // ...but both decrypt back to the original.
  assert.equal(decryptToken(a, 'alice', MASTER), 'same')
  assert.equal(decryptToken(b, 'alice', MASTER), 'same')
})
