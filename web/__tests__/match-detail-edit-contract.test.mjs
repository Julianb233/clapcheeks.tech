import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  route: readFileSync('app/api/matches/[id]/route.ts', 'utf8'),
  matchView: readFileSync('app/(main)/matches/[id]/match-profile-view.tsx', 'utf8'),
}

test('match detail API accepts profile, date, and insight edit fields', () => {
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
    assert.match(files.route, new RegExp(`${field}\\?: unknown`))
  }

  assert.match(files.route, /STRING_FIELD_LIMITS/)
  assert.match(files.route, /INTEL_STRING_FIELD_LIMITS/)
  assert.match(files.route, /birth_date must be YYYY-MM-DD/)
  assert.match(files.route, /age must be an integer 18-100/)
  assert.match(files.route, /match_intel_patch must be an object/)
  assert.match(files.route, /updated\.status === 'error'/)
  assert.match(files.route, /\.from\('clapcheeks_matches'\)/)
  assert.match(files.route, /\.update\(update\)/)
})

test('match detail dashboard shows record dates and editable backend profile fields', () => {
  for (const label of [
    'Created',
    'Updated',
    'Last activity',
    'Date met',
    'Profile Data',
    'Save edits',
    'Birthday',
    'First impression',
    'Photo vision summary',
    'Interests',
    'Prompt themes',
    'Green flags',
    'Red flags',
  ]) {
    assert.match(files.matchView, new RegExp(label))
  }

  assert.match(files.matchView, /RecordTimelineStrip/)
  assert.match(files.matchView, /ProfileBackendEditor/)
  assert.match(files.matchView, /match_intel_patch: matchIntelPatch/)
  assert.match(files.matchView, /toast\.success\('Profile data saved'\)/)
})
