import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const route = readFileSync('app/api/matches/[id]/route.ts', 'utf8')
const view = readFileSync('app/(main)/matches/[id]/match-profile-view.tsx', 'utf8')
const convexMatches = readFileSync('convex/matches.ts', 'utf8')

test('match PATCH route accepts database-backed profile edit fields', () => {
  for (const field of [
    'name',
    'age',
    'bio',
    'job',
    'school',
    'instagram_handle',
    'zodiac',
    'birth_date',
    'met_at',
    'first_impression',
    'vision_summary',
  ]) {
    assert.match(route, new RegExp(`${field}\\?: unknown|${field}:`), `${field} is accepted by PATCH body`)
  }
  assert.match(route, /STRING_FIELD_LIMITS/, 'string field limits guard profile edits')
  assert.match(route, /match_intel_patch/, 'insight patches are still merged through match_intel')
  assert.match(route, /api\.matches\.patchByUser/, 'route writes through ownership-checked Convex mutation')
})

test('Convex match patch mutations round-trip date and profile fields', () => {
  assert.match(convexMatches, /met_at: v\.optional\(v\.string\(\)\)/, 'met_at can be patched')
  assert.match(convexMatches, /first_impression: v\.optional\(v\.string\(\)\)/, 'first_impression can be patched')
})

test('match profile page exposes timestamps, insights, and frontend edit controls', () => {
  assert.match(view, /RecordTimelineStrip/, 'date/timestamp strip is rendered')
  assert.match(view, /Created/, 'created date is visible')
  assert.match(view, /Updated/, 'updated date is visible')
  assert.match(view, /Last activity/, 'last activity date is visible')
  assert.match(view, /ProfileBackendEditor/, 'frontend editor is mounted')
  assert.match(view, /Profile Data/, 'profile data edit section is visible')
  assert.match(view, /match_intel_patch: matchIntelPatch/, 'editor persists insight arrays')
  assert.match(view, /Intel Snapshot/, 'raw intel snapshot remains visible')
})
