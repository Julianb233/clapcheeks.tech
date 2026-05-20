import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  identity: readFileSync('lib/matches/identity.ts', 'utf8'),
  matchCard: readFileSync('components/matches/MatchCard.tsx', 'utf8'),
  legacyMatchDetail: readFileSync('components/matches/MatchDetail.tsx', 'utf8'),
  matchesPage: readFileSync('app/(main)/matches/page.tsx', 'utf8'),
  matchProfile: readFileSync('app/(main)/matches/[id]/match-profile-view.tsx', 'utf8'),
  leadsPage: readFileSync('app/(main)/leads/page.tsx', 'utf8'),
  leadsBoard: readFileSync('app/(main)/leads/leads-board.tsx', 'utf8'),
  rosterCard: readFileSync('components/roster/RosterCard.tsx', 'utf8'),
  dailyTopThree: readFileSync('components/roster/DailyTopThree.tsx', 'utf8'),
  dashboard: readFileSync('app/(main)/dashboard/page.tsx', 'utf8'),
}

test('match identity helper marks Hinge single-letter names as review-only identity', () => {
  assert.match(files.identity, /getMatchIdentityStatus/)
  assert.match(files.identity, /platform === 'hinge'/)
  assert.match(files.identity, /\^\[A-Za-z\]\$/)
  assert.match(files.identity, /identity_quality === 'hinge_initial_only'/)
  assert.match(files.identity, /Hinge initial only/)
  assert.match(files.identity, /photos and profile prompts are synced/)
})

test('production match surfaces render the Hinge initial-only review badge', () => {
  for (const [name, source] of Object.entries(files)) {
    if (name === 'identity') continue
    if (name === 'leadsBoard') continue
    assert.match(source, /getMatchIdentityStatus/, `${name} should use identity helper`)
  }
  assert.match(files.leadsPage, /match_intel, updated_at/)
  assert.match(files.leadsBoard, /identityLabel/)
  assert.match(files.dashboard, /identity\.displayName/)
})

test('match detail consumes structured prompts from match_intel', () => {
  assert.match(files.matchProfile, /function promptList/)
  assert.match(files.matchProfile, /prompts\?: Prompt\[\]/)
  assert.match(files.matchProfile, /match_intel as MatchIntel \| null\)\?\.prompts/)
})
