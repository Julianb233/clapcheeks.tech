import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  visibility: readFileSync('lib/matches/visibility.ts', 'utf8'),
  matchProfileRoute: readFileSync('app/api/match-profile/add/route.ts', 'utf8'),
  matchesPage: readFileSync('app/(main)/matches/page.tsx', 'utf8'),
  dashboardPage: readFileSync('app/(main)/dashboard/page.tsx', 'utf8'),
  rosterPage: readFileSync('app/(main)/dashboard/roster/page.tsx', 'utf8'),
  dashboardMatchesGrid: readFileSync('app/(main)/dashboard/matches/matches-grid.tsx', 'utf8'),
}

test('match visibility helper hides archived and transport-only Hinge placeholders', () => {
  assert.match(files.visibility, /isArchivedMatch/)
  assert.match(files.visibility, /isTransportOnlyPlaceholder/)
  assert.match(files.visibility, /sendbird_channel/)
  assert.match(files.visibility, /matchPhotoCount\(row\) === 0/)
  assert.match(files.visibility, /name === 'hinge chat'/)
  assert.match(files.visibility, /name === 'group channel'/)
  assert.match(files.visibility, /isDisplayableMatchProfile/)
})

test('profile list and match pages use visibility helper by default', () => {
  assert.match(files.matchProfileRoute, /include_archived/)
  assert.match(files.matchProfileRoute, /include_placeholders/)
  assert.match(files.matchProfileRoute, /isArchivedMatch\(row\)/)
  assert.match(files.matchProfileRoute, /isTransportOnlyPlaceholder\(row\)/)
  assert.match(files.matchesPage, /isDisplayableMatchProfile/)
  assert.match(files.matchesPage, /status, health_score/)
  assert.match(files.dashboardMatchesGrid, /isTransportOnlyPlaceholder\(m\)/)
  assert.match(files.dashboardMatchesGrid, /isArchivedMatch\(m\)/)
  assert.match(files.dashboardPage, /isDisplayableMatchProfile/)
  assert.match(files.rosterPage, /isDisplayableMatchProfile/)
})
