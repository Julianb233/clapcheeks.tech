import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  compat: readFileSync('lib/convex/compat-client.ts', 'utf8'),
  leadsPage: readFileSync('app/(main)/leads/page.tsx', 'utf8'),
  leadsBoard: readFileSync('app/(main)/leads/leads-board.tsx', 'utf8'),
  backendDoctor: readFileSync('scripts/e2e-backend-doctor-safe.mjs', 'utf8'),
}

test('leads board reads live Convex-derived rows instead of an unmapped legacy table', () => {
  assert.match(files.leadsPage, /\.from\('clapcheeks_leads'\)/)
  assert.match(files.compat, /clapcheeks_leads: "__derived_from_matches_and_conversations__"/)
  assert.match(files.compat, /async function deriveLeadRows/)
  assert.match(files.compat, /matches:listForUser/)
  assert.match(files.compat, /conversations:listForUser/)
  assert.match(files.compat, /toLeadRow\(row, matchConversation\(row, conversations\)\)/)
  assert.match(files.compat, /leadStageFromMatch/)
})

test('leads edits persist through the server match PATCH route', () => {
  assert.match(files.leadsBoard, /async function patchLeadMatch/)
  assert.match(files.leadsBoard, /\/api\/matches\/\$\{encodeURIComponent\(leadId\)\}/)
  assert.match(files.leadsBoard, /match_intel_patch/)
  assert.match(files.leadsBoard, /lead_stage_entered_at/)
  assert.match(files.leadsBoard, /setSaveError/)
  assert.doesNotMatch(files.leadsBoard, /createClient/)
  assert.doesNotMatch(files.leadsBoard, /\.from\('clapcheeks_leads'\)[\s\S]*\.update/)
  assert.match(files.compat, /kind === "update" && mapped === "clapcheeks_leads"/)
  assert.match(files.compat, /matches:patch/)
  assert.match(files.compat, /lead_stage/)
  assert.match(files.compat, /lead_stage_entered_at/)
  assert.match(files.compat, /matchPatch\.match_intel = intel/)
  assert.match(files.compat, /leadStatusFromStage/)
  assert.match(files.backendDoctor, /clapcheeks_leads/)
  assert.match(files.backendDoctor, /matches:patch/)
})
