import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  form: readFileSync('app/(main)/settings/ai/settings-form.tsx', 'utf8'),
  page: readFileSync('app/(main)/settings/ai/page.tsx', 'utf8'),
  route: readFileSync('app/api/ai-settings/route.ts', 'utf8'),
  autonomyRoute: readFileSync('app/api/autonomy-config/route.ts', 'utf8'),
  autonomyPage: readFileSync('app/(main)/autonomy/page.tsx', 'utf8'),
  autonomyDashboard: readFileSync('app/(main)/autonomy/components/autonomy-dashboard.tsx', 'utf8'),
  settings: readFileSync('lib/clapcheeks/user-settings.ts', 'utf8'),
  compat: readFileSync('lib/convex/compat-client.ts', 'utf8'),
  drip: readFileSync('/Users/julianbradley/clapcheeks-local/clapcheeks/followup/drip.py', 'utf8'),
  phaseF: readFileSync('/Users/julianbradley/clapcheeks-local/clapcheeks/imessage/phase_f_worker.py', 'utf8'),
}

test('AI Settings writes approval gates through the server Supabase settings API', () => {
  assert.match(files.form, /fetch\('\/api\/ai-settings'/)
  assert.match(files.route, /upsertClapCheeksUserSettings/)
  assert.match(files.route, /getClapCheeksUserSettings/)
  assert.match(files.settings, /clapcheeks_user_settings\?on_conflict=user_id/)
  assert.match(files.settings, /resolution=merge-duplicates,return=representation/)
  assert.match(files.settings, /SAFE_SETTINGS_COLUMNS/)
  assert.doesNotMatch(files.settings, /select=\*/)
  assert.match(files.settings, /"approve_openers"/)
  assert.match(files.settings, /"approve_replies"/)
  assert.match(files.settings, /"approve_date_asks"/)
  assert.match(files.settings, /"approve_bookings"/)
})

test('settings resolve Julian personal OAuth profile instead of the Convex fleet id', () => {
  assert.match(files.settings, /DEFAULT_OPERATOR_EMAIL = "julianb233@gmail.com"/)
  assert.match(files.settings, /profiles\?select=id,email/)
  assert.match(files.page, /getClapCheeksUserSettings/)
  assert.match(files.page, /dateCalendarEmail: row\?\.date_calendar_email \?\? 'julianb233@gmail.com'/)
  assert.match(files.compat, /email: process\.env\.CLAPCHEEKS_OPERATOR_EMAIL \|\| "julianb233@gmail.com"/)
})

test('backend workers interpret approve_replies false as approval gate off', () => {
  assert.match(files.drip, /approve_replies=false means "don't require approval" -> auto-send/)
  assert.match(files.drip, /rows\[0\]\.get\("approve_replies"\) is False/)
  assert.match(files.phaseF, /approve_replies: bool = False\s+# True => queue; False => auto-send/)
  assert.match(files.phaseF, /"status": "queued" if config\.approve_replies else "approved"/)
})

test('autonomy dashboard writes real runtime approval settings instead of dead config table', () => {
  assert.doesNotMatch(files.autonomyRoute, /clapcheeks_autonomy_config/)
  assert.doesNotMatch(files.autonomyPage, /clapcheeks_autonomy_config/)
  assert.doesNotMatch(files.autonomyDashboard, /clapcheeks_autonomy_config/)
  assert.match(files.autonomyRoute, /upsertClapCheeksUserSettings/)
  assert.match(files.autonomyRoute, /approve_replies/)
  assert.match(files.autonomyPage, /getClapCheeksUserSettings/)
  assert.match(files.autonomyDashboard, /fetch\('\/api\/autonomy-config'/)
  assert.match(files.autonomyDashboard, /Runtime Approval Gates/)
  assert.match(files.autonomyDashboard, /Preference model data is not exposed by the live Convex backend yet/)
  assert.match(files.autonomyDashboard, /aria-label=\{label\}/)
  assert.match(files.autonomyDashboard, /aria-pressed=\{enabled\}/)
})
