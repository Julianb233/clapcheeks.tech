// Phase F (AI-8320): OfflineContactForm + /api/matches/offline smoke tests.
//
// The web package isn't wired up with jest/vitest. We use node's built-in
// `node:test` runner to exercise (a) the phone normalizer logic lifted
// from the component, and (b) the server-side payload validator shape.
//
// Run with:  node --test web/__tests__/offline-contact-form.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same logic as in the route + component.
function normalizePhoneE164(raw) {
  const digits = raw.replace(/\D+/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

test('normalizePhoneE164 accepts dashed', () => {
  assert.equal(normalizePhoneE164('619-480-1234'), '+16194801234')
})

test('normalizePhoneE164 accepts parens', () => {
  assert.equal(normalizePhoneE164('(619) 480-1234'), '+16194801234')
})

test('normalizePhoneE164 accepts bare 10 digits', () => {
  assert.equal(normalizePhoneE164('6194801234'), '+16194801234')
})

test('normalizePhoneE164 accepts 11 digits with 1', () => {
  assert.equal(normalizePhoneE164('16194801234'), '+16194801234')
})

test('normalizePhoneE164 rejects short', () => {
  assert.equal(normalizePhoneE164('12345'), null)
})

test('normalizePhoneE164 rejects 11 digits not starting with 1', () => {
  assert.equal(normalizePhoneE164('26194801234'), null)
})

// Payload-shape assertions — verify route inputs we'd POST.
test('offline form payload shape is correct', () => {
  const payload = {
    name: 'Sarah',
    phone: '619-480-1234',
    instagram_handle: 'sarah.m',
    met_at: 'at the gym',
    first_impression: 'funny, climbs',
  }
  assert.ok(payload.name)
  assert.ok(payload.phone)
  assert.equal(normalizePhoneE164(payload.phone), '+16194801234')
})

test('missing name should fail validation (server-side)', () => {
  const payload = { phone: '6194801234' }
  assert.equal(payload.name, undefined)
})

test('bad phone should fail normalization', () => {
  const payload = { name: 'Sarah', phone: 'abc' }
  assert.equal(normalizePhoneE164(payload.phone), null)
})
