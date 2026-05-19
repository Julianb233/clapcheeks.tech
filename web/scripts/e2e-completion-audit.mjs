#!/usr/bin/env node

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const safeEvidencePath = process.env.CLAPCHEEKS_E2E_EVIDENCE || '/tmp/clapcheeks-safe-e2e-readiness.json'
const browserEvidencePath = process.env.CLAPCHEEKS_BROWSER_EVIDENCE || '/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json'
const backendDoctorEvidencePath = process.env.CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE || '/tmp/clapcheeks-backend-doctor-2026-05-18.json'
const runtimeSmokeEvidencePath = process.env.CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE || '/tmp/clapcheeks-runtime-smoke-evidence.json'
const localBrowserEvidencePath = process.env.CLAPCHEEKS_LOCAL_BROWSER_PROOF || '/tmp/clapcheeks-local-browser-proof-2026-05-18.json'
const liveSendEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json'
const livePreflightEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const sampleLivePreflightEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT || '/tmp/clapcheeks-live-send-sample-preflight.json'
const liveSendRehearsalEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_REHEARSAL || '/tmp/clapcheeks-live-send-rehearsal.json'
const outputPath = process.env.CLAPCHEEKS_COMPLETION_AUDIT || '/tmp/clapcheeks-completion-audit-2026-05-18.json'
const maxArtifactAgeSeconds = Number.parseInt(process.env.CLAPCHEEKS_EVIDENCE_MAX_AGE_SECONDS || '3600', 10)
const sampleRawPhone = '+17578312944'
const sampleRawBody = 'Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'

function loadJson(path) {
  if (!existsSync(path)) return { ok: false, missing: true, path }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false, parse_error: error.message, path }
  }
}

function check(name, status, evidence, detail = {}) {
  return { name, status, evidence, detail }
}

function hasOkCheck(evidence, name) {
  return Array.isArray(evidence?.checks) && evidence.checks.some((item) => item.name === name && item.ok === true)
}

function getCheck(evidence, name) {
  return Array.isArray(evidence?.checks) ? evidence.checks.find((item) => item.name === name) : null
}

function fileReady(path) {
  return existsSync(path) && statSync(path).size > 0
}

function fileFresh(path) {
  if (!existsSync(path)) return { path, exists: false, fresh: false, age_seconds: null }
  const stat = statSync(path)
  const ageSeconds = Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 1000))
  return {
    path,
    exists: true,
    bytes: stat.size,
    age_seconds: ageSeconds,
    max_age_seconds: maxArtifactAgeSeconds,
    fresh: stat.size > 0 && (Number.isFinite(maxArtifactAgeSeconds) ? ageSeconds <= maxArtifactAgeSeconds : true),
    modified_at: stat.mtime.toISOString(),
  }
}

const safe = loadJson(safeEvidencePath)
const browser = loadJson(browserEvidencePath)
const backendDoctor = loadJson(backendDoctorEvidencePath)
const runtimeSmoke = loadJson(runtimeSmokeEvidencePath)
const localBrowser = loadJson(localBrowserEvidencePath)
const liveSend = loadJson(liveSendEvidencePath)
const livePreflight = loadJson(livePreflightEvidencePath)
const sampleLivePreflight = loadJson(sampleLivePreflightEvidencePath)
const liveSendRehearsal = loadJson(liveSendRehearsalEvidencePath)
const sampleLivePreflightRaw = existsSync(sampleLivePreflightEvidencePath) ? readFileSync(sampleLivePreflightEvidencePath, 'utf8') : ''
const sampleLivePreflightRawPhoneAbsent = !sampleLivePreflightRaw.includes(sampleRawPhone)
const sampleLivePreflightRawBodyAbsent = !sampleLivePreflightRaw.includes(sampleRawBody)
const baseLiveSendEnv = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
]
const scheduledDryRun = getCheck(safe, 'scheduled dry-run')
const scheduledDryRunProvenance = scheduledDryRun?.detail?.response?.send_provenance || null
const coreRouteMatrix = getCheck(safe, 'dashboard core route matrix')
const coreRouteFailures = Array.isArray(coreRouteMatrix?.detail?.routes)
  ? coreRouteMatrix.detail.routes.filter((item) => !item.ok)
  : []

const screenshotResults = Array.isArray(browser?.screenshots)
  ? browser.screenshots.map((path) => ({ path, ok: fileReady(path) }))
  : []
const requiredFreshArtifacts = {
  safe: fileFresh(safeEvidencePath),
  browser: fileFresh(browserEvidencePath),
  backend_doctor: fileFresh(backendDoctorEvidencePath),
  runtime_smoke: fileFresh(runtimeSmokeEvidencePath),
  local_browser: fileFresh(localBrowserEvidencePath),
  live_send: fileFresh(liveSendEvidencePath),
  live_preflight: fileFresh(livePreflightEvidencePath),
  sample_live_preflight: fileFresh(sampleLivePreflightEvidencePath),
  live_send_rehearsal: fileFresh(liveSendRehearsalEvidencePath),
  ...Object.fromEntries(
    (Array.isArray(browser?.screenshots) ? browser.screenshots : []).map((path, index) => [
      `screenshot_${index + 1}`,
      fileFresh(path),
    ]),
  ),
}
const staleArtifacts = Object.entries(requiredFreshArtifacts)
  .filter(([, artifact]) => artifact.fresh !== true)
  .map(([key, artifact]) => ({ key, ...artifact }))
const livePreflightHash = livePreflight?.validation?.message_sha256 || null
const livePreflightLength = livePreflight?.validation?.message_length ?? null
const livePreflightLast4 = livePreflight?.validation?.phone_last4 || null
const liveEvidenceHash = liveSend?.message_sha256 || null
const liveEvidenceLength = liveSend?.message_length ?? null
const liveEvidenceLast4 = liveSend?.phone_last4 || null
const liveSendProvenance = liveSend?.send_provenance || null
const liveSendProvenanceVerified = liveSend?.send_provenance_verified === true &&
  liveSendProvenance?.source_label === 'clapcheeks_scheduled_messages_send_api' &&
  liveSendProvenance?.route === 'POST /api/scheduled-messages/send' &&
  liveSendProvenance?.message_sha256 === liveEvidenceHash &&
  liveSendProvenance?.message_length === liveEvidenceLength &&
  liveSendProvenance?.phone_last4 === liveEvidenceLast4
const liveEvidenceMatchesPreflight = Boolean(
  liveSend?.live_send_performed === true &&
  livePreflight?.ok_to_run_live_harness === true &&
  livePreflightHash &&
  liveEvidenceHash &&
  livePreflightHash === liveEvidenceHash &&
  livePreflightLength === liveEvidenceLength &&
  livePreflightLast4 === liveEvidenceLast4,
)

const requirements = [
  check(
    'required E2E evidence artifacts are fresh',
    staleArtifacts.length === 0 ? 'proved' : 'missing_or_unproved',
    `${safeEvidencePath}, ${browserEvidencePath}, ${backendDoctorEvidencePath}, ${runtimeSmokeEvidencePath}, ${liveSendEvidencePath}, ${livePreflightEvidencePath}`,
    {
      max_age_seconds: maxArtifactAgeSeconds,
      artifacts: requiredFreshArtifacts,
      stale_artifacts: staleArtifacts,
    },
  ),
  check(
    'final live-send no-send rehearsal matches redacted preflight plan',
    liveSendRehearsal?.ok === true &&
      liveSendRehearsal?.no_live_send_performed === true &&
      liveSendRehearsal?.dry_run_only === true &&
      liveSendRehearsal?.preflight_ready === true &&
      liveSendRehearsal?.dry_run?.source_label === 'clapcheeks_scheduled_messages_send_api' &&
      liveSendRehearsal?.dry_run?.immediate_adapter === true &&
      liveSendRehearsal?.dry_run?.message_sha256_match === true &&
      liveSendRehearsal?.dry_run?.destination_last4_match === true &&
      liveSendRehearsal?.dry_run?.send_confirmation_present === true &&
      liveSendRehearsal?.cleanup?.ok === true &&
      liveSendRehearsal?.no_raw_phone_written === true &&
      liveSendRehearsal?.no_raw_body_written === true
      ? 'proved'
      : 'missing_or_unproved',
    liveSendRehearsalEvidencePath,
    {
      source: liveSendRehearsal?.source || null,
      preflight_ready: liveSendRehearsal?.preflight_ready === true,
      redacted_plan: liveSendRehearsal?.redacted_plan || null,
      dry_run: liveSendRehearsal?.dry_run || null,
      cleanup: liveSendRehearsal?.cleanup || null,
      no_live_send_performed: liveSendRehearsal?.no_live_send_performed === true,
      no_raw_phone_written: liveSendRehearsal?.no_raw_phone_written === true,
      no_raw_body_written: liveSendRehearsal?.no_raw_body_written === true,
    },
  ),
  check(
    'backend Convex and schema route coverage doctor passes',
    backendDoctor?.ok === true &&
      backendDoctor?.no_live_send_performed === true &&
      backendDoctor?.no_dashboard_mutation_performed === true &&
      hasOkCheck(backendDoctor, 'no runtime Supabase imports in dashboard path') &&
      hasOkCheck(backendDoctor, 'Convex facade mapping coverage') &&
      hasOkCheck(backendDoctor, 'backend API route matrix')
      ? 'proved'
      : 'missing_or_unproved',
    backendDoctorEvidencePath,
    {
      checked_scope: backendDoctor?.checked_scope || [],
      checks: backendDoctor?.checks || [],
    },
  ),
  check(
    'runtime inbound source of truth is reachable in no-send mode',
    runtimeSmoke?.ok === true &&
      runtimeSmoke?.no_send === true &&
      runtimeSmoke?.outbound_insert_skipped === true &&
      runtimeSmoke?.drainer_skipped === true &&
      Number(runtimeSmoke?.inbound_message_rows || 0) > 0
      ? 'proved'
      : 'missing_or_unproved',
    runtimeSmokeEvidencePath,
    {
      inbound_message_rows: runtimeSmoke?.inbound_message_rows ?? null,
      outbound_insert_skipped: runtimeSmoke?.outbound_insert_skipped === true,
      drainer_skipped: runtimeSmoke?.drainer_skipped === true,
      checks: runtimeSmoke?.checks || [],
    },
  ),
  check(
    'local Chrome browser proof from Julian computer is current and read-only',
    localBrowser?.ok === true &&
      localBrowser?.no_live_send_performed === true &&
      localBrowser?.no_dashboard_mutation_performed === true &&
      localBrowser?.chrome?.active_url_matches_local_app === true &&
      localBrowser?.chrome?.active_route === '/analytics' &&
      localBrowser?.scheduled?.counts?.pending === 0 &&
      localBrowser?.scheduled?.counts?.approved === 0 &&
      localBrowser?.scheduled?.counts?.forbidden_fixture_present === false &&
      localBrowser?.analytics?.summary?.matches === 22 &&
      localBrowser?.analytics?.summary?.conversations === 200
      ? 'proved'
      : 'missing_or_unproved',
    localBrowserEvidencePath,
    {
      no_live_send_performed: localBrowser?.no_live_send_performed === true,
      no_dashboard_mutation_performed: localBrowser?.no_dashboard_mutation_performed === true,
      chrome: localBrowser?.chrome || null,
      scheduled: localBrowser?.scheduled || null,
      analytics: localBrowser?.analytics || null,
      assertions: localBrowser?.assertions || null,
    },
  ),
  check(
    'dashboard works end to end',
      browser?.ok === true &&
      browser?.checks?.dashboard_desktop === true &&
      browser?.checks?.dashboard_navigation_integrity === true &&
      browser?.checks?.dashboard_health_blockers_quick_view === true &&
      browser?.checks?.dashboard_imessage_self_test_surface === true &&
      browser?.checks?.dashboard_imessage_dry_run_click === true &&
      browser?.checks?.dashboard_mobile_quick_view === true &&
      browser?.checks?.device_mobile_quick_view === true &&
      browser?.checks?.device_control_safety_surface === true &&
      screenshotResults.some((item) => item.path.includes('dashboard') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('device-mobile') && item.ok) &&
      hasOkCheck(safe, 'dashboard core route matrix') &&
      hasOkCheck(safe, 'dashboard runtime health contract') &&
      backendDoctor?.ok === true &&
      coreRouteFailures.length === 0
      ? 'proved'
      : 'missing_or_unproved',
    browserEvidencePath,
    {
      dashboard_desktop: browser?.checks?.dashboard_desktop,
      dashboard_navigation_integrity: browser?.checks?.dashboard_navigation_integrity,
      dashboard_navigation: browser?.checks?.dashboard_navigation,
      dashboard_health_blockers_quick_view: browser?.checks?.dashboard_health_blockers_quick_view,
      dashboard_health_blockers: browser?.checks?.dashboard_health_blockers,
      dashboard_imessage_self_test_surface: browser?.checks?.dashboard_imessage_self_test_surface,
      dashboard_imessage_self_test: browser?.checks?.dashboard_imessage_self_test,
      dashboard_imessage_dry_run_click: browser?.checks?.dashboard_imessage_dry_run_click,
      dashboard_imessage_dry_run: browser?.checks?.dashboard_imessage_dry_run,
      dashboard_mobile_quick_view: browser?.checks?.dashboard_mobile_quick_view,
      device_mobile_quick_view: browser?.checks?.device_mobile_quick_view,
      device_control_safety_surface: browser?.checks?.device_control_safety_surface,
      device_control_status: browser?.checks?.device_control_status,
      screenshots: screenshotResults.filter((item) => item.path.includes('dashboard')),
      device_screenshots: screenshotResults.filter((item) => item.path.includes('device-mobile')),
      route_matrix: hasOkCheck(safe, 'dashboard core route matrix'),
      route_matrix_summary: coreRouteMatrix?.detail?.summary,
      route_matrix_failures: coreRouteFailures,
      runtime_health_contract: getCheck(safe, 'dashboard runtime health contract')?.detail,
      backend_doctor: backendDoctorEvidencePath,
    },
  ),
  check(
    'insights are functional',
    browser?.ok === true &&
      browser?.checks?.intelligence_desktop === true &&
      browser?.checks?.intelligence_ui_matches_api === true &&
      browser?.checks?.intelligence_mobile_quick_view === true &&
      browser?.checks?.analytics_mobile_quick_view === true &&
      browser?.checks?.analytics_mobile_ui_matches_api === true &&
      screenshotResults.some((item) => item.path.includes('intelligence-mobile') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('analytics-mobile') && item.ok) &&
      hasOkCheck(safe, 'analytics summary contract') &&
      browser?.checks?.analytics_summary?.matches === 22 &&
      browser?.checks?.analytics_summary?.conversations === 200
      ? 'proved'
      : 'missing_or_unproved',
    browserEvidencePath,
    {
      intelligence_desktop: browser?.checks?.intelligence_desktop,
      intelligence_ui_matches_api: browser?.checks?.intelligence_ui_matches_api,
      intelligence_api_binding: browser?.checks?.intelligence_api_binding,
      intelligence_mobile_quick_view: browser?.checks?.intelligence_mobile_quick_view,
      analytics_mobile_quick_view: browser?.checks?.analytics_mobile_quick_view,
      analytics_mobile_ui_matches_api: browser?.checks?.analytics_mobile_ui_matches_api,
      analytics_mobile_api_binding: browser?.checks?.analytics_mobile_api_binding,
      screenshots: screenshotResults.filter((item) => item.path.includes('intelligence')),
      analytics_summary: browser?.checks?.analytics_summary,
      analytics_contract: getCheck(safe, 'analytics summary contract')?.detail,
    },
  ),
  check(
    'scheduled message create approve dry-run cancel path works',
    safe?.ok === true &&
      hasOkCheck(safe, 'scheduled create') &&
      hasOkCheck(safe, 'scheduled approve') &&
      hasOkCheck(safe, 'scheduled live blocked without phrase') &&
      hasOkCheck(safe, 'scheduled live blocked by preflight gate') &&
      hasOkCheck(safe, 'scheduled dry-run') &&
      scheduledDryRun?.detail?.provenance_ok === true &&
      hasOkCheck(safe, 'scheduled cleanup cancel') &&
      hasOkCheck(safe, 'scheduled fixture cleanup') &&
      browser?.checks?.scheduled_ui_matches_api === true &&
      browser?.checks?.scheduled_send_confirmation_guardrail === true &&
      browser?.checks?.scheduled_send_confirmation?.guardrail?.send_disabled_with_wrong_phrase === true &&
      browser?.checks?.scheduled_send_confirmation?.cleanup?.ok === true
      ? 'proved'
      : 'missing_or_unproved',
    safeEvidencePath,
    {
      sample_last4: safe?.sample_last4,
      dry_run_provenance_ok: scheduledDryRun?.detail?.provenance_ok === true,
      dry_run_provenance: scheduledDryRunProvenance,
      scheduled_ui_matches_api: browser?.checks?.scheduled_ui_matches_api,
      scheduled_api_binding: browser?.checks?.scheduled_api_binding,
      scheduled_send_confirmation_guardrail: browser?.checks?.scheduled_send_confirmation_guardrail,
      scheduled_send_confirmation: browser?.checks?.scheduled_send_confirmation,
    },
  ),
  check(
    'dashboard imessage self-test dry-run works',
    safe?.ok === true &&
      hasOkCheck(safe, 'imessage metadata') &&
      hasOkCheck(safe, 'imessage dry-run') &&
      hasOkCheck(safe, 'imessage live blocked without phrase') &&
      hasOkCheck(safe, 'imessage live blocked by preflight gate') &&
      browser?.checks?.dashboard_imessage_dry_run_click === true &&
      browser?.checks?.dashboard_imessage_dry_run?.no_queue_delta === true
      ? 'proved'
      : 'missing_or_unproved',
    safeEvidencePath,
    {
      self_test_recipient: browser?.checks?.imessage_self_test_recipient,
      dashboard_imessage_dry_run: browser?.checks?.dashboard_imessage_dry_run,
    },
  ),
  check(
    'mobile quick-view UX works',
    browser?.ok === true &&
      browser?.checks?.dashboard_mobile_quick_view === true &&
      browser?.checks?.device_mobile_quick_view === true &&
      browser?.checks?.device_control_safety_surface === true &&
      browser?.checks?.scheduled_mobile_quick_view === true &&
      browser?.checks?.scheduled_ui_matches_api === true &&
      browser?.checks?.scheduled_mobile_modal === true &&
      browser?.checks?.scheduled_mobile_form_filled === true &&
      browser?.checks?.scheduled_mobile_form_no_submit === true &&
      browser?.checks?.scheduled_send_confirmation_guardrail === true &&
      browser?.checks?.scheduled_mobile_form?.sample_last4 === '2944' &&
      browser?.checks?.intelligence_mobile_quick_view === true &&
      browser?.checks?.analytics_mobile_quick_view === true &&
      browser?.checks?.mobile_metrics_overflow_free === true &&
      screenshotResults.some((item) => item.path.includes('dashboard-mobile') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('device-mobile') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('scheduled-mobile-2026') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('scheduled-mobile-modal') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('scheduled-send-confirmation-modal') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('intelligence-mobile') && item.ok) &&
      screenshotResults.some((item) => item.path.includes('analytics-mobile') && item.ok)
      ? 'proved'
      : 'missing_or_unproved',
    browserEvidencePath,
    {
      dashboard_mobile_quick_view: browser?.checks?.dashboard_mobile_quick_view,
      device_mobile_quick_view: browser?.checks?.device_mobile_quick_view,
      device_control_safety_surface: browser?.checks?.device_control_safety_surface,
      device_control_status: browser?.checks?.device_control_status,
      scheduled_mobile_quick_view: browser?.checks?.scheduled_mobile_quick_view,
      scheduled_ui_matches_api: browser?.checks?.scheduled_ui_matches_api,
      scheduled_api_binding: browser?.checks?.scheduled_api_binding,
      scheduled_mobile_modal: browser?.checks?.scheduled_mobile_modal,
      scheduled_mobile_form_filled: browser?.checks?.scheduled_mobile_form_filled,
      scheduled_mobile_form_no_submit: browser?.checks?.scheduled_mobile_form_no_submit,
      scheduled_mobile_form: browser?.checks?.scheduled_mobile_form,
      scheduled_send_confirmation_guardrail: browser?.checks?.scheduled_send_confirmation_guardrail,
      scheduled_send_confirmation: browser?.checks?.scheduled_send_confirmation,
      intelligence_mobile_quick_view: browser?.checks?.intelligence_mobile_quick_view,
      analytics_mobile_quick_view: browser?.checks?.analytics_mobile_quick_view,
      analytics_mobile_api_binding: browser?.checks?.analytics_mobile_api_binding,
      mobile_metrics_overflow_free: browser?.checks?.mobile_metrics_overflow_free,
      mobile_metrics: browser?.checks?.mobile_metrics,
    },
  ),
  check(
    'safe sample 757-831-2944 used without accidental real outbound send',
    safe?.sample_last4 === '2944' &&
      safe?.no_live_send_performed === true &&
      browser?.no_live_send_performed === true &&
      hasOkCheck(safe, 'messages db read-only sample lookup') &&
      sampleLivePreflight?.ok_to_run_live_harness === true &&
      sampleLivePreflight?.no_send_performed === true &&
      sampleLivePreflight?.no_dashboard_mutation_performed === true &&
      sampleLivePreflight?.validation?.phone_last4 === '2944' &&
      sampleLivePreflight?.validation?.sample_2944_override_present === true &&
      sampleLivePreflightRawPhoneAbsent &&
      sampleLivePreflightRawBodyAbsent
      ? 'proved'
      : 'missing_or_unproved',
    `${safeEvidencePath}, ${browserEvidencePath}, ${sampleLivePreflightEvidencePath}`,
    {
      sample_last4: safe?.sample_last4,
      safe_no_live_send: safe?.no_live_send_performed,
      browser_no_live_send: browser?.no_live_send_performed,
      messages_db_read_only: getCheck(safe, 'messages db read-only sample lookup')?.detail,
      sample_live_preflight: {
        evidence: sampleLivePreflightEvidencePath,
        ready: sampleLivePreflight?.ok_to_run_live_harness === true,
        no_send_performed: sampleLivePreflight?.no_send_performed === true,
        no_dashboard_mutation_performed: sampleLivePreflight?.no_dashboard_mutation_performed === true,
        phone_last4: sampleLivePreflight?.validation?.phone_last4 || null,
        phone_redacted: sampleLivePreflight?.validation?.phone_redacted || null,
        message_length: sampleLivePreflight?.validation?.message_length ?? null,
        message_sha256: sampleLivePreflight?.validation?.message_sha256 || null,
        sample_2944_override_present: sampleLivePreflight?.validation?.sample_2944_override_present === true,
        raw_phone_absent: sampleLivePreflightRawPhoneAbsent,
        raw_body_absent: sampleLivePreflightRawBodyAbsent,
      },
    },
  ),
  check(
    'real outbound send-to-Julian test',
    liveSend?.ok === true &&
      liveSend?.live_send_performed === true &&
      liveSend?.messages_db_verified === true &&
      liveSendProvenanceVerified &&
      liveEvidenceMatchesPreflight
      ? 'proved'
      : 'unproved_requires_explicit_live_permission',
    liveSendEvidencePath,
    {
      missing_live_send_evidence: liveSend?.missing === true || liveSend?.ok !== true,
      preflight_evidence: livePreflightEvidencePath,
      preflight_ready: livePreflight?.ok_to_run_live_harness === true,
      body_hash_match: livePreflightHash && liveEvidenceHash ? livePreflightHash === liveEvidenceHash : false,
      body_length_match: livePreflightLength != null && liveEvidenceLength != null ? livePreflightLength === liveEvidenceLength : false,
      destination_last4_match: livePreflightLast4 && liveEvidenceLast4 ? livePreflightLast4 === liveEvidenceLast4 : false,
      live_evidence_matches_preflight: liveEvidenceMatchesPreflight,
      send_provenance_verified: liveSendProvenanceVerified,
      send_provenance: liveSendProvenance,
    },
  ),
]

const unproved = requirements.filter((item) => item.status !== 'proved')
const missingRequiredEvidence = requirements.filter((item) => item.status === 'missing_or_unproved')
const complete = unproved.length === 0
const safeToContinueWithoutLiveSend = missingRequiredEvidence.length === 0 && unproved.every((item) => item.status === 'unproved_requires_explicit_live_permission')
const liveBaseMissing = baseLiveSendEnv.filter((name) => Array.isArray(liveSend?.missing) && liveSend.missing.includes(name))
const preflightMissing = Array.isArray(livePreflight?.validation?.missing) ? livePreflight.validation.missing : []
const preflightIssues = Array.isArray(livePreflight?.validation?.issues) ? livePreflight.validation.issues : []
const sampleOverrideRequired = preflightMissing.includes('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944')

function nextRequiredAction() {
  if (complete) return 'Review final live evidence, then mark the persistent goal complete.'
  const runtimeInboundMissing = missingRequiredEvidence.some((item) => item.name === 'runtime inbound source of truth is reachable in no-send mode')
  if (runtimeInboundMissing || runtimeSmoke?.inbound_watcher_ok === false) {
    const blocker = runtimeSmoke?.inbound_watcher_status?.last_error_kind ||
      runtimeSmoke?.inbound_watcher_blocker ||
      'runtime_inbound_source_of_truth_missing'
    return `Repair missing non-live evidence first: runtime inbound source of truth is reachable in no-send mode. Run cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh, grant Full Disk Access to launchd Python, then rerun npm run test:e2e:runtime and npm run test:e2e:audit. Current blocker: ${blocker}.`
  }
  if (missingRequiredEvidence.length > 0) {
    return `Repair missing non-live evidence first: ${missingRequiredEvidence.map((item) => item.name).join(', ')}.`
  }
  if (liveBaseMissing.length > 0) {
    return `Get current explicit live-send approval, exact destination, and exact body; set missing env ${liveBaseMissing.join(', ')}; rerun npm run test:e2e:live:preflight before npm run test:e2e:live.`
  }
  if (sampleOverrideRequired) {
    return 'Destination ends in 2944; set CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 exactly as documented only if 757-831-2944 is intentionally the live destination.'
  }
  if (preflightMissing.length > 0 || preflightIssues.length > 0) {
    return `Resolve live preflight blockers: missing=${preflightMissing.join(', ') || 'none'} issues=${preflightIssues.join('; ') || 'none'}.`
  }
  if (livePreflight?.ok_to_run_live_harness === true) {
    return 'Live preflight is ready; run npm run test:e2e:live only after reviewing the redacted plan and confirming this is the intended live send.'
  }
  return 'Follow docs/e2e-live-send-runbook.md to produce verified live-send evidence.'
}

const finalGate = {
  live_env_missing: liveBaseMissing,
  preflight_ready: livePreflight?.ok_to_run_live_harness === true,
  preflight_missing: preflightMissing,
  preflight_issues: preflightIssues,
  sample_override_required: sampleOverrideRequired,
  live_evidence_matches_preflight: liveEvidenceMatchesPreflight,
  body_hash_match: livePreflightHash && liveEvidenceHash ? livePreflightHash === liveEvidenceHash : false,
  body_length_match: livePreflightLength != null && liveEvidenceLength != null ? livePreflightLength === liveEvidenceLength : false,
  destination_last4_match: livePreflightLast4 && liveEvidenceLast4 ? livePreflightLast4 === liveEvidenceLast4 : false,
  send_provenance_verified: liveSendProvenanceVerified,
  next_required_action: nextRequiredAction(),
}

const audit = {
  complete,
  safe_to_continue_without_live_send: safeToContinueWithoutLiveSend,
  generated_at: new Date().toISOString(),
  output_path: outputPath,
  evidence: {
    safe: safeEvidencePath,
    browser: browserEvidencePath,
    backend_doctor: backendDoctorEvidencePath,
    runtime_smoke: runtimeSmokeEvidencePath,
    local_browser: localBrowserEvidencePath,
    live_send: liveSendEvidencePath,
    live_preflight: livePreflightEvidencePath,
    sample_live_preflight: sampleLivePreflightEvidencePath,
    live_send_rehearsal: liveSendRehearsalEvidencePath,
  },
  final_gate: finalGate,
  next_required_action: finalGate.next_required_action,
  requirements,
}

writeFileSync(outputPath, JSON.stringify(audit, null, 2))

console.log(`Completion audit: ${complete ? 'complete' : 'not complete'}`)
console.log(`Safe proved scope: ${safeToContinueWithoutLiveSend ? 'all non-live gates proved' : 'missing non-live evidence'}`)
console.log(`Evidence: ${outputPath}`)
console.log(`Final gate blockers: live_env_missing=${finalGate.live_env_missing.length} sample_override_required=${finalGate.sample_override_required} preflight_ready=${finalGate.preflight_ready}`)
console.log(`Next required action: ${finalGate.next_required_action}`)
for (const item of requirements) {
  console.log(`[${item.status}] ${item.name}`)
}

if (missingRequiredEvidence.length > 0) process.exit(1)
