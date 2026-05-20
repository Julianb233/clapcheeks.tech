#!/usr/bin/env node

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const outputPath = process.env.CLAPCHEEKS_EVIDENCE_INDEX || '/tmp/clapcheeks-e2e-evidence-index-2026-05-18.json'
const maxArtifactAgeSeconds = Number.parseInt(process.env.CLAPCHEEKS_EVIDENCE_MAX_AGE_SECONDS || '3600', 10)

const paths = {
  safe: process.env.CLAPCHEEKS_E2E_EVIDENCE || '/tmp/clapcheeks-safe-e2e-readiness.json',
  browser: process.env.CLAPCHEEKS_BROWSER_EVIDENCE || '/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json',
  backend_doctor: process.env.CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE || '/tmp/clapcheeks-backend-doctor-2026-05-18.json',
  runtime_smoke: process.env.CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE || '/tmp/clapcheeks-runtime-smoke-evidence.json',
  inbound_repair: process.env.CLAPCHEEKS_INBOUND_REPAIR_EVIDENCE || '/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json',
  local_browser: process.env.CLAPCHEEKS_LOCAL_BROWSER_PROOF || '/tmp/clapcheeks-local-browser-proof-2026-05-18.json',
  live: process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json',
  live_preflight: process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json',
  sample_live_preflight: process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT || '/tmp/clapcheeks-live-send-sample-preflight.json',
  live_send_rehearsal: process.env.CLAPCHEEKS_LIVE_SEND_REHEARSAL || '/tmp/clapcheeks-live-send-rehearsal.json',
  approval_packet: process.env.CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET || '/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json',
  approval_packet_markdown: process.env.CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET_MD || '/tmp/clapcheeks-live-send-approval-packet-2026-05-18.md',
  production_cct: process.env.CLAPCHEEKS_PRODUCTION_CCT_LATEST || '/tmp/clapcheeks-production-cct-latest.json',
  completion: process.env.CLAPCHEEKS_COMPLETION_AUDIT || '/tmp/clapcheeks-completion-audit-2026-05-18.json',
  runbook: 'docs/e2e-live-send-runbook.md',
  audit_doc: 'docs/e2e-readiness-audit-2026-05-18.md',
}
const sampleRawPhone = '+17578312944'
const sampleRawBody = 'Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'
const sampleOverridePhrase = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'

function fileInfo(path) {
  if (!existsSync(path)) return { path, exists: false }
  const stat = statSync(path)
  const ageSeconds = Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 1000))
  return {
    path,
    exists: true,
    bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    age_seconds: ageSeconds,
    fresh: Number.isFinite(maxArtifactAgeSeconds) ? ageSeconds <= maxArtifactAgeSeconds : true,
  }
}

function loadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const safe = loadJson(paths.safe)
const browser = loadJson(paths.browser)
const backendDoctor = loadJson(paths.backend_doctor)
const runtimeSmoke = loadJson(paths.runtime_smoke)
const inboundRepair = loadJson(paths.inbound_repair)
const localBrowser = loadJson(paths.local_browser)
const live = loadJson(paths.live)
const livePreflight = loadJson(paths.live_preflight)
const sampleLivePreflight = loadJson(paths.sample_live_preflight)
const liveSendRehearsal = loadJson(paths.live_send_rehearsal)
const approvalPacket = loadJson(paths.approval_packet)
const productionCct = loadJson(paths.production_cct)
const sampleLivePreflightRaw = existsSync(paths.sample_live_preflight) ? readFileSync(paths.sample_live_preflight, 'utf8') : ''
const approvalPacketMarkdownRaw = existsSync(paths.approval_packet_markdown) ? readFileSync(paths.approval_packet_markdown, 'utf8') : ''
const sampleLivePreflightRawPhoneAbsent = !sampleLivePreflightRaw.includes(sampleRawPhone)
const sampleLivePreflightRawBodyAbsent = !sampleLivePreflightRaw.includes(sampleRawBody)
const approvalPacketMarkdownRawE164Absent = !approvalPacketMarkdownRaw.includes(sampleRawPhone)
const approvalPacketMarkdownRawBodyAbsent = !approvalPacketMarkdownRaw.includes(sampleRawBody)
const approvalPacketMarkdownSampleOverridePresent = approvalPacketMarkdownRaw.includes(sampleOverridePhrase)
const completion = loadJson(paths.completion)
const requirements = Array.isArray(completion?.requirements) ? completion.requirements : []
const proved = requirements.filter((item) => item.status === 'proved')
const unproved = requirements.filter((item) => item.status !== 'proved')
const completionFinalGate = completion?.final_gate && typeof completion.final_gate === 'object'
  ? completion.final_gate
  : null
const nextRequiredAction = completion?.next_required_action || completionFinalGate?.next_required_action || null
const safeSampleRequirement = requirements.find((item) => item.name === 'safe sample 757-831-2944 used without accidental real outbound send')
const scheduledRequirement = requirements.find((item) => item.name === 'scheduled message create approve dry-run cancel path works')
const messagesDb = safeSampleRequirement?.detail?.messages_db_read_only || null
const scheduledDryRunProvenance = scheduledRequirement?.detail?.dry_run_provenance || null
function getSafeCheck(name) {
  return Array.isArray(safe?.checks) ? safe.checks.find((item) => item.name === name) : null
}
const scheduledLivePreflightGate = getSafeCheck('scheduled live blocked by preflight gate')
const baseLiveSendEnv = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
]
const liveMissing = Array.isArray(live?.missing) ? live.missing : []
const preflightMissing = Array.isArray(livePreflight?.validation?.missing) ? livePreflight.validation.missing : []
const liveBaseMissing = baseLiveSendEnv.filter((name) => liveMissing.includes(name))
const sampleOverrideRequired = preflightMissing.includes('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944')
const livePreflightHash = livePreflight?.validation?.message_sha256 || null
const livePreflightLength = livePreflight?.validation?.message_length ?? null
const livePreflightLast4 = livePreflight?.validation?.phone_last4 || null
const sampleLivePreflightHash = sampleLivePreflight?.validation?.message_sha256 || null
const sampleLivePreflightLength = sampleLivePreflight?.validation?.message_length ?? null
const liveEvidenceHash = live?.message_sha256 || null
const liveEvidenceLength = live?.message_length ?? null
const liveEvidenceLast4 = live?.phone_last4 || null
const liveSendProvenance = live?.send_provenance || null
const liveSendProvenanceVerified = live?.send_provenance_verified === true &&
  liveSendProvenance?.source_label === 'clapcheeks_scheduled_messages_send_api' &&
  liveSendProvenance?.route === 'POST /api/scheduled-messages/send' &&
  liveSendProvenance?.message_sha256 === liveEvidenceHash &&
  liveSendProvenance?.message_length === liveEvidenceLength &&
  liveSendProvenance?.phone_last4 === liveEvidenceLast4
const liveEvidenceMatchesPreflight = Boolean(
  live?.live_send_performed === true &&
  livePreflight?.ok_to_run_live_harness === true &&
  livePreflightHash &&
  liveEvidenceHash &&
  livePreflightHash === liveEvidenceHash &&
  livePreflightLength === liveEvidenceLength &&
  livePreflightLast4 === liveEvidenceLast4,
)
const browserScreenshots = Array.isArray(browser?.screenshots)
  ? browser.screenshots.map((path) => fileInfo(path))
  : []
const mobileMetrics = browser?.checks?.mobile_metrics && typeof browser.checks.mobile_metrics === 'object'
  ? browser.checks.mobile_metrics
  : {}
const mobileMetricEntries = Object.values(mobileMetrics)
const mobileMetricOverflowFree = browser?.checks?.mobile_metrics_overflow_free === true &&
  mobileMetricEntries.length > 0 &&
  mobileMetricEntries.every((metric) => metric?.overflow_x === false)
const artifacts = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fileInfo(path)]))
const requiredFreshArtifactKeys = [
  'safe',
  'browser',
  'backend_doctor',
  'runtime_smoke',
  'inbound_repair',
  'local_browser',
  'live',
  'live_preflight',
  'sample_live_preflight',
  'live_send_rehearsal',
  'approval_packet',
  'approval_packet_markdown',
  'production_cct',
  'completion',
]
const requiredFreshArtifacts = [
  ...requiredFreshArtifactKeys.map((key) => ({ key, ...artifacts[key] })).filter((item) => item.path),
  ...browserScreenshots.map((item, index) => ({ key: `screenshot_${index + 1}`, ...item })),
]
const staleArtifacts = requiredFreshArtifacts
  .filter((artifact) => artifact.fresh !== true)
  .map((artifact) => ({
    key: artifact.key,
    path: artifact.path,
    exists: artifact.exists === true,
    age_seconds: artifact.age_seconds ?? null,
  }))
const oldestRequiredArtifactAgeSeconds = Math.max(
  0,
  ...requiredFreshArtifacts.map((item) => Number(item.age_seconds || 0)),
)

const index = {
  generated_at: new Date().toISOString(),
  complete: completion?.complete === true,
  safe_non_live_gates_proved: completion?.safe_to_continue_without_live_send === true,
  summary: {
    proved_requirements: proved.length,
    unproved_requirements: unproved.length,
    remaining_gate: unproved.map((item) => item.name).join(', ') || null,
    no_live_send_performed: safe?.no_live_send_performed === true && browser?.no_live_send_performed === true && live?.live_send_performed !== true,
    live_preflight_ready: livePreflight?.ok_to_run_live_harness === true,
    live_preflight_no_send: livePreflight?.no_send_performed === true,
    sample_live_preflight_ready: sampleLivePreflight?.ok_to_run_live_harness === true,
    sample_live_preflight_no_send: sampleLivePreflight?.no_send_performed === true,
    sample_live_preflight_no_dashboard_mutation: sampleLivePreflight?.no_dashboard_mutation_performed === true,
    sample_live_preflight_last4: sampleLivePreflight?.validation?.phone_last4 || null,
    sample_live_preflight_redacted: sampleLivePreflight?.validation?.phone_redacted || null,
    sample_live_preflight_message_length: sampleLivePreflightLength,
    sample_live_preflight_message_sha256: sampleLivePreflightHash,
    sample_live_preflight_override_present: sampleLivePreflight?.validation?.sample_2944_override_present === true,
    sample_live_preflight_raw_phone_absent: sampleLivePreflightRawPhoneAbsent,
    sample_live_preflight_raw_body_absent: sampleLivePreflightRawBodyAbsent,
    live_send_rehearsal_ok: liveSendRehearsal?.ok === true,
    live_send_rehearsal_source: liveSendRehearsal?.source || null,
    live_send_rehearsal_no_send: liveSendRehearsal?.no_live_send_performed === true,
    live_send_rehearsal_dry_run_only: liveSendRehearsal?.dry_run_only === true,
    live_send_rehearsal_immediate_adapter: liveSendRehearsal?.dry_run?.immediate_adapter === true,
    live_send_rehearsal_hash_match: liveSendRehearsal?.dry_run?.message_sha256_match === true,
    live_send_rehearsal_last4_match: liveSendRehearsal?.dry_run?.destination_last4_match === true,
    live_send_rehearsal_cleanup_ok: liveSendRehearsal?.cleanup?.ok === true,
    approval_packet_ready: approvalPacket?.ok === true,
    approval_packet_no_send: approvalPacket?.no_send_performed === true,
    approval_packet_no_mutation: approvalPacket?.no_dashboard_mutation_performed === true,
    approval_packet_raw_phone_written: approvalPacket?.raw_phone_written === true,
    approval_packet_raw_body_written: approvalPacket?.raw_body_written === true,
    approval_packet_missing_base_env: Array.isArray(approvalPacket?.required_env?.missing_now)
      ? approvalPacket.required_env.missing_now
      : [],
    approval_packet_rehearsal_ok: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.ok === true,
    approval_packet_template_present: Array.isArray(approvalPacket?.approval_request_template?.required_response_lines) &&
      approvalPacket.approval_request_template.required_response_lines.length >= 4,
    approval_packet_template_raw_values_written: approvalPacket?.approval_request_template?.raw_values_written === true,
    approval_packet_markdown_exists: artifacts.approval_packet_markdown?.exists === true,
    approval_packet_markdown_raw_e164_absent: approvalPacketMarkdownRawE164Absent,
    approval_packet_markdown_raw_body_absent: approvalPacketMarkdownRawBodyAbsent,
    approval_packet_markdown_sample_override_present: approvalPacketMarkdownSampleOverridePresent,
    backend_doctor_ok: backendDoctor?.ok === true,
    backend_doctor_no_send: backendDoctor?.no_live_send_performed === true,
    backend_doctor_no_mutation: backendDoctor?.no_dashboard_mutation_performed === true,
    backend_doctor_checks_passed: Array.isArray(backendDoctor?.checks)
      ? backendDoctor.checks.filter((item) => item.ok === true).length
      : 0,
    backend_doctor_checks_total: Array.isArray(backendDoctor?.checks) ? backendDoctor.checks.length : 0,
    live_harness_missing_base_env: liveBaseMissing,
    live_preflight_sample_override_required: sampleOverrideRequired,
    final_gate_preflight_ready: completionFinalGate?.preflight_ready === true,
    final_gate_next_required_action: nextRequiredAction,
    final_gate_evidence_mismatch: liveBaseMissing.length > 0 && sampleOverrideRequired,
    live_evidence_matches_preflight: liveEvidenceMatchesPreflight,
    live_body_hash_match: livePreflightHash && liveEvidenceHash ? livePreflightHash === liveEvidenceHash : false,
    live_body_length_match: livePreflightLength != null && liveEvidenceLength != null ? livePreflightLength === liveEvidenceLength : false,
    live_destination_last4_match: livePreflightLast4 && liveEvidenceLast4 ? livePreflightLast4 === liveEvidenceLast4 : false,
    live_send_provenance_verified: liveSendProvenanceVerified,
    runtime_smoke_ok: runtimeSmoke?.ok === true,
    runtime_smoke_no_send: runtimeSmoke?.no_send === true,
    runtime_inbound_watcher_ok: runtimeSmoke?.inbound_watcher_ok === true,
    runtime_inbound_watcher_blocker: runtimeSmoke?.inbound_watcher_status?.last_error_kind || null,
    runtime_inbound_watcher_fda_alert_enabled: runtimeSmoke?.inbound_watcher_status?.fda_alert_imessage_enabled === true,
    runtime_terminal_proof_ok: runtimeSmoke?.inbound_terminal_proof_ok === true,
    runtime_terminal_proof_count: runtimeSmoke?.inbound_terminal_proof?.count ?? null,
    runtime_terminal_proof_no_send: runtimeSmoke?.inbound_terminal_proof?.no_send === true,
    runtime_terminal_proof_mutation: runtimeSmoke?.inbound_terminal_proof?.mutation === true,
    inbound_repair_ok: inboundRepair?.ok === true,
    inbound_repair_launchd_ready: inboundRepair?.launchd_ready === true,
    inbound_repair_terminal_proof_ok: inboundRepair?.terminal_proof_ok === true,
    inbound_repair_remaining_blocker: inboundRepair?.remaining_blocker || null,
    inbound_repair_no_send: inboundRepair?.no_live_send_performed === true,
    inbound_repair_runtime_smoke_exit: inboundRepair?.steps?.runtime_smoke?.exit_code ?? null,
    inbound_repair_tcc_python_row_count: inboundRepair?.full_disk_access_tcc?.python_row_count ?? null,
    inbound_repair_tcc_python_authorized: inboundRepair?.full_disk_access_tcc?.python_authorized === true,
    inbound_repair_tcc_python_denied_or_off: inboundRepair?.full_disk_access_tcc?.python_denied_or_off === true,
    inbound_repair_real_python: inboundRepair?.real_python || null,
    runtime_inbound_message_rows: runtimeSmoke?.inbound_message_rows ?? null,
    local_browser_proof_ok: localBrowser?.ok === true,
    local_browser_no_send: localBrowser?.no_live_send_performed === true,
    local_browser_no_mutation: localBrowser?.no_dashboard_mutation_performed === true,
    local_browser_active_route: localBrowser?.chrome?.active_route || null,
    local_browser_scheduled_pending: localBrowser?.scheduled?.counts?.pending ?? null,
    local_browser_scheduled_approved: localBrowser?.scheduled?.counts?.approved ?? null,
    local_browser_forbidden_fixture_present: localBrowser?.scheduled?.counts?.forbidden_fixture_present ?? null,
    local_browser_analytics_matches: localBrowser?.analytics?.summary?.matches ?? null,
    local_browser_analytics_conversations: localBrowser?.analytics?.summary?.conversations ?? null,
    production_cct_ok: productionCct?.passed === productionCct?.total && Number(productionCct?.total || 0) > 0,
    production_cct_checks_passed: productionCct?.passed ?? null,
    production_cct_checks_total: productionCct?.total ?? null,
    production_cct_no_live_send: productionCct?.noLiveOutboundSendPerformed === true,
    production_cct_active_profiles: productionCct?.inventory?.total ?? null,
    production_cct_hinge: productionCct?.inventory?.hinge ?? null,
    production_cct_hinge_with_images: productionCct?.inventory?.hingeWithImages ?? null,
    production_cct_generic_names: productionCct?.inventory?.genericNames ?? null,
    production_cct_fixture_archived: productionCct?.fixture?.archiveStatus === 200,
    production_cct_report_path: productionCct?.outDir ? `${productionCct.outDir}/report.json` : paths.production_cct,
    dashboard_navigation_integrity: browser?.checks?.dashboard_navigation_integrity === true,
    dashboard_health_blockers_quick_view: browser?.checks?.dashboard_health_blockers_quick_view === true,
    dashboard_health_blockers_expected: browser?.checks?.dashboard_health_blockers?.expected_blockers || [],
    dashboard_imessage_self_test_surface: browser?.checks?.dashboard_imessage_self_test_surface === true,
    dashboard_live_send_gate_ready: browser?.checks?.dashboard_imessage_self_test?.live_send_gate_ready === true,
    dashboard_live_send_gate_missing: Array.isArray(browser?.checks?.dashboard_imessage_self_test?.live_send_gate_missing)
      ? browser.checks.dashboard_imessage_self_test.live_send_gate_missing
      : [],
    dashboard_imessage_dry_run_click: browser?.checks?.dashboard_imessage_dry_run_click === true,
    dashboard_imessage_dry_run_no_queue_delta: browser?.checks?.dashboard_imessage_dry_run?.no_queue_delta === true,
    device_mobile_quick_view: browser?.checks?.device_mobile_quick_view === true,
    device_control_safety_surface: browser?.checks?.device_control_safety_surface === true,
    device_control_selected_line: browser?.checks?.device_control_status?.selected_line ?? null,
    device_control_current_blocker: browser?.checks?.device_control_status?.current_blocker || null,
    browser_screenshot_count: browserScreenshots.length,
    browser_screenshots_all_present: browserScreenshots.length > 0 && browserScreenshots.every((item) => item.exists === true && Number(item.bytes || 0) > 0),
    mobile_metric_count: mobileMetricEntries.length,
    mobile_metrics_overflow_free: mobileMetricOverflowFree,
    scheduled_ui_matches_api: browser?.checks?.scheduled_ui_matches_api === true,
    scheduled_api_counts_match: browser?.checks?.scheduled_api_binding?.counts_match === true,
    scheduled_api_total_messages: browser?.checks?.scheduled_api_binding?.total_messages ?? null,
    scheduled_mobile_form_filled: browser?.checks?.scheduled_mobile_form_filled === true,
    scheduled_mobile_form_no_submit: browser?.checks?.scheduled_mobile_form_no_submit === true,
    scheduled_send_confirmation_guardrail: browser?.checks?.scheduled_send_confirmation_guardrail === true,
    scheduled_send_confirmation_cleanup: browser?.checks?.scheduled_send_confirmation?.cleanup?.ok === true,
    scheduled_live_blocked_by_preflight_gate: scheduledLivePreflightGate?.ok === true,
    scheduled_live_preflight_no_send: scheduledLivePreflightGate?.detail?.response?.live_send_gate?.no_send_performed === true,
    scheduled_live_preflight_missing_count: Array.isArray(scheduledLivePreflightGate?.detail?.response?.live_send_gate?.missing)
      ? scheduledLivePreflightGate.detail.response.live_send_gate.missing.length
      : null,
    intelligence_ui_matches_api: browser?.checks?.intelligence_ui_matches_api === true,
    analytics_mobile_ui_matches_api: browser?.checks?.analytics_mobile_ui_matches_api === true,
    analytics_mobile_quick_view: browser?.checks?.analytics_mobile_quick_view === true,
    sample_last4: safe?.sample_last4 || null,
    messages_db_sample_rows: messagesDb?.sample_handle_rows ?? null,
    messages_db_sample_outbound_rows: messagesDb?.sample_outbound_rows ?? null,
    scheduled_dry_run_provenance_verified: scheduledRequirement?.detail?.dry_run_provenance_ok === true,
    evidence_max_age_seconds: maxArtifactAgeSeconds,
    evidence_artifacts_fresh: staleArtifacts.length === 0,
    stale_artifact_count: staleArtifacts.length,
    oldest_required_artifact_age_seconds: oldestRequiredArtifactAgeSeconds,
  },
  artifacts,
  evidence_highlights: {
    browser: browser?.checks || null,
    browser_screenshots: {
      all_present: browserScreenshots.length > 0 && browserScreenshots.every((item) => item.exists === true && Number(item.bytes || 0) > 0),
      count: browserScreenshots.length,
      files: browserScreenshots,
    },
    mobile_metrics: {
      overflow_free: mobileMetricOverflowFree,
      count: mobileMetricEntries.length,
      pages: mobileMetrics,
    },
    safe_checks: Array.isArray(safe?.checks)
      ? safe.checks.map((item) => ({ name: item.name, ok: item.ok, summary: item.detail?.summary }))
      : null,
    scheduled_dry_run: scheduledRequirement ? {
      status: scheduledRequirement.status,
      provenance_verified: scheduledRequirement.detail?.dry_run_provenance_ok === true,
      send_provenance: scheduledDryRunProvenance,
    } : null,
    scheduled_live_preflight_gate: scheduledLivePreflightGate ? {
      ok: scheduledLivePreflightGate.ok === true,
      no_send_performed: scheduledLivePreflightGate.detail?.response?.live_send_gate?.no_send_performed === true,
      missing: scheduledLivePreflightGate.detail?.response?.live_send_gate?.missing || [],
      issues: scheduledLivePreflightGate.detail?.response?.live_send_gate?.issues || [],
      redacted_execution_plan_present: Object.prototype.hasOwnProperty.call(
        scheduledLivePreflightGate.detail?.response?.live_send_gate || {},
        'redacted_execution_plan',
      ),
      message_sha256_present: typeof scheduledLivePreflightGate.detail?.response?.live_send_gate?.redacted_execution_plan?.message_sha256 === 'string',
      summary: scheduledLivePreflightGate.detail?.summary || null,
    } : null,
    artifact_freshness: {
      max_age_seconds: maxArtifactAgeSeconds,
      all_required_fresh: staleArtifacts.length === 0,
      oldest_required_age_seconds: oldestRequiredArtifactAgeSeconds,
      stale_artifacts: staleArtifacts,
    },
    final_gate: completionFinalGate ? {
      live_env_missing: Array.isArray(completionFinalGate.live_env_missing)
        ? completionFinalGate.live_env_missing
        : liveBaseMissing,
      preflight_ready: completionFinalGate.preflight_ready === true,
      preflight_missing: Array.isArray(completionFinalGate.preflight_missing)
        ? completionFinalGate.preflight_missing
        : preflightMissing,
      preflight_issues: Array.isArray(completionFinalGate.preflight_issues)
        ? completionFinalGate.preflight_issues
        : [],
      sample_override_required: completionFinalGate.sample_override_required === true,
      live_evidence_matches_preflight: completionFinalGate.live_evidence_matches_preflight === true,
      body_hash_match: completionFinalGate.body_hash_match === true,
      body_length_match: completionFinalGate.body_length_match === true,
      destination_last4_match: completionFinalGate.destination_last4_match === true,
      send_provenance_verified: completionFinalGate.send_provenance_verified === true,
      next_required_action: nextRequiredAction,
    } : {
      live_env_missing: liveBaseMissing,
      preflight_ready: livePreflight?.ok_to_run_live_harness === true,
      preflight_missing: preflightMissing,
      preflight_issues: [],
      sample_override_required: sampleOverrideRequired,
      live_evidence_matches_preflight: liveEvidenceMatchesPreflight,
      body_hash_match: livePreflightHash && liveEvidenceHash ? livePreflightHash === liveEvidenceHash : false,
      body_length_match: livePreflightLength != null && liveEvidenceLength != null ? livePreflightLength === liveEvidenceLength : false,
      destination_last4_match: livePreflightLast4 && liveEvidenceLast4 ? livePreflightLast4 === liveEvidenceLast4 : false,
      send_provenance_verified: liveSendProvenanceVerified,
      next_required_action: nextRequiredAction,
    },
    live_send: live ? {
      refused: live.refused === true,
      performed: live.live_send_performed === true,
      messages_db_verified: live.messages_db_verified === true,
      missing: live.missing || [],
      base_env_missing: liveBaseMissing,
      phone_last4: liveEvidenceLast4,
      message_length: liveEvidenceLength,
      message_sha256: liveEvidenceHash,
      send_provenance_verified: liveSendProvenanceVerified,
      send_provenance: liveSendProvenance,
    } : null,
    runtime_smoke: runtimeSmoke ? {
      ok: runtimeSmoke.ok === true,
      no_send: runtimeSmoke.no_send === true,
      inbound_watcher_ok: runtimeSmoke.inbound_watcher_ok === true,
      inbound_watcher_status_path: runtimeSmoke.inbound_watcher_status_path || null,
      inbound_watcher_status: runtimeSmoke.inbound_watcher_status || null,
      inbound_terminal_proof_ok: runtimeSmoke.inbound_terminal_proof_ok === true,
      inbound_terminal_proof_path: runtimeSmoke.inbound_terminal_proof_path || null,
      inbound_terminal_proof: runtimeSmoke.inbound_terminal_proof || null,
      inbound_message_rows: runtimeSmoke.inbound_message_rows ?? null,
      outbound_insert_skipped: runtimeSmoke.outbound_insert_skipped === true,
      drainer_skipped: runtimeSmoke.drainer_skipped === true,
    } : null,
    inbound_repair: inboundRepair ? {
      ok: inboundRepair.ok === true,
      launchd_ready: inboundRepair.launchd_ready === true,
      terminal_proof_ok: inboundRepair.terminal_proof_ok === true,
      remaining_blocker: inboundRepair.remaining_blocker || null,
      no_live_send_performed: inboundRepair.no_live_send_performed === true,
      convex_inbound_mutation_after_fda_possible: inboundRepair.convex_inbound_mutation_after_fda_possible === true,
      runtime_smoke_exit: inboundRepair.steps?.runtime_smoke?.exit_code ?? null,
      tcc_python_row_count: inboundRepair.full_disk_access_tcc?.python_row_count ?? null,
      tcc_python_authorized: inboundRepair.full_disk_access_tcc?.python_authorized === true,
      tcc_python_denied_or_off: inboundRepair.full_disk_access_tcc?.python_denied_or_off === true,
      real_python: inboundRepair.real_python || null,
      evidence_path: paths.inbound_repair,
    } : null,
    local_browser: localBrowser ? {
      ok: localBrowser.ok === true,
      no_live_send_performed: localBrowser.no_live_send_performed === true,
      no_dashboard_mutation_performed: localBrowser.no_dashboard_mutation_performed === true,
      active_route: localBrowser.chrome?.active_route || null,
      active_url_matches_local_app: localBrowser.chrome?.active_url_matches_local_app === true,
      scheduled_counts: localBrowser.scheduled?.counts || null,
      analytics_summary: localBrowser.analytics?.summary || null,
      assertions: localBrowser.assertions || null,
    } : null,
    production_cct: productionCct ? {
      evidence_path: paths.production_cct,
      out_dir: productionCct.outDir || null,
      base_url: productionCct.baseUrl || null,
      ok: productionCct.passed === productionCct.total && Number(productionCct.total || 0) > 0,
      passed: productionCct.passed ?? null,
      total: productionCct.total ?? null,
      no_live_outbound_send_performed: productionCct.noLiveOutboundSendPerformed === true,
      inventory: productionCct.inventory || null,
      fixture: productionCct.fixture ? {
        id: productionCct.fixture.id || null,
        status: productionCct.fixture.status ?? null,
        patchStatus: productionCct.fixture.patchStatus ?? null,
        archiveStatus: productionCct.fixture.archiveStatus ?? null,
      } : null,
      screenshots: Array.isArray(productionCct.pages)
        ? productionCct.pages.filter((page) => page.screenshotPath).map((page) => page.screenshotPath)
        : [],
      failed_checks: Array.isArray(productionCct.checks)
        ? productionCct.checks.filter((check) => check.pass !== true).map((check) => check.name)
        : [],
    } : null,
    live_preflight: livePreflight ? {
      ok_to_run_live_harness: livePreflight.ok_to_run_live_harness === true,
      no_send_performed: livePreflight.no_send_performed === true,
      no_dashboard_mutation_performed: livePreflight.no_dashboard_mutation_performed === true,
      safe_non_live_gates_proved: livePreflight.current_readiness?.safe_non_live_gates_proved === true,
      missing: livePreflight.validation?.missing || [],
      issues: livePreflight.validation?.issues || [],
      phone_last4: livePreflight.validation?.phone_last4 || null,
      message_length: livePreflight.validation?.message_length ?? null,
      message_sha256: livePreflight.validation?.message_sha256 || null,
      body_hash_matches_live: livePreflightHash && liveEvidenceHash ? livePreflightHash === liveEvidenceHash : false,
      body_length_matches_live: livePreflightLength != null && liveEvidenceLength != null ? livePreflightLength === liveEvidenceLength : false,
      destination_last4_matches_live: livePreflightLast4 && liveEvidenceLast4 ? livePreflightLast4 === liveEvidenceLast4 : false,
      live_evidence_matches_preflight: liveEvidenceMatchesPreflight,
      sample_override_required: sampleOverrideRequired,
    } : null,
    sample_live_preflight: sampleLivePreflight ? {
      ok_to_run_live_harness: sampleLivePreflight.ok_to_run_live_harness === true,
      no_send_performed: sampleLivePreflight.no_send_performed === true,
      no_dashboard_mutation_performed: sampleLivePreflight.no_dashboard_mutation_performed === true,
      safe_non_live_gates_proved: sampleLivePreflight.current_readiness?.safe_non_live_gates_proved === true,
      missing: sampleLivePreflight.validation?.missing || [],
      issues: sampleLivePreflight.validation?.issues || [],
      phone_last4: sampleLivePreflight.validation?.phone_last4 || null,
      phone_redacted: sampleLivePreflight.validation?.phone_redacted || null,
      message_length: sampleLivePreflightLength,
      message_sha256: sampleLivePreflightHash,
      sample_override_required: sampleLivePreflight.validation?.sample_2944_override_required === true,
      sample_override_present: sampleLivePreflight.validation?.sample_2944_override_present === true,
      raw_phone_absent: sampleLivePreflightRawPhoneAbsent,
      raw_body_absent: sampleLivePreflightRawBodyAbsent,
    } : null,
    live_send_rehearsal: liveSendRehearsal ? {
      ok: liveSendRehearsal.ok === true,
      source: liveSendRehearsal.source || null,
      no_live_send_performed: liveSendRehearsal.no_live_send_performed === true,
      dry_run_only: liveSendRehearsal.dry_run_only === true,
      preflight_ready: liveSendRehearsal.preflight_ready === true,
      redacted_plan: liveSendRehearsal.redacted_plan || null,
      dry_run: liveSendRehearsal.dry_run || null,
      cleanup: liveSendRehearsal.cleanup || null,
      no_raw_phone_written: liveSendRehearsal.no_raw_phone_written === true,
      no_raw_body_written: liveSendRehearsal.no_raw_body_written === true,
    } : null,
    approval_packet: approvalPacket ? {
      ok: approvalPacket.ok === true,
      no_send_performed: approvalPacket.no_send_performed === true,
      no_dashboard_mutation_performed: approvalPacket.no_dashboard_mutation_performed === true,
      raw_phone_written: approvalPacket.raw_phone_written === true,
      raw_body_written: approvalPacket.raw_body_written === true,
      missing_base_env: approvalPacket.required_env?.missing_now || [],
      required_permission_phrase: approvalPacket.required_current_approval?.explicit_permission_phrase || null,
      sample_2944_override_required_if_destination_ends_2944: approvalPacket.required_current_approval?.sample_2944_override_required_if_destination_ends_2944 || null,
      live_send_rehearsal: approvalPacket.current_safe_evidence?.live_send_rehearsal || null,
      operator_sequence: approvalPacket.operator_sequence || [],
      approval_request_template: approvalPacket.approval_request_template || null,
      command_reference: approvalPacket.command_reference || null,
      markdown_raw_e164_absent: approvalPacketMarkdownRawE164Absent,
      markdown_raw_body_absent: approvalPacketMarkdownRawBodyAbsent,
      markdown_sample_override_phrase_present: approvalPacketMarkdownSampleOverridePresent,
    } : null,
    backend_doctor: backendDoctor ? {
      ok: backendDoctor.ok === true,
      no_live_send_performed: backendDoctor.no_live_send_performed === true,
      no_dashboard_mutation_performed: backendDoctor.no_dashboard_mutation_performed === true,
      checked_scope: backendDoctor.checked_scope || [],
      checks: Array.isArray(backendDoctor.checks)
        ? backendDoctor.checks.map((item) => ({ name: item.name, ok: item.ok, summary: item.detail?.summary }))
        : [],
    } : null,
    messages_db: messagesDb ? {
      checked: messagesDb.checked === true,
      sample_last4: messagesDb.sample_last4 || null,
      sample_handle_rows: messagesDb.sample_handle_rows ?? null,
      sample_outbound_rows: messagesDb.sample_outbound_rows ?? null,
      total_rows: messagesDb.total_rows ?? null,
      content_logged: messagesDb.content_logged === true,
    } : null,
    completion_requirements: requirements.map((item) => ({
      name: item.name,
      status: item.status,
      evidence: item.evidence,
    })),
  },
  repeatable_commands: [
    'npm run test:e2e:readiness:local',
    'npm run test:e2e:backend-doctor',
    'npm run test:e2e:runtime',
    'npm run test:e2e:local-browser',
    'npm run test:e2e:live:approval-packet',
    'npm run test:e2e:live:sample-preflight',
    'npm run test:e2e:live:rehearsal',
    'npm run test:e2e:production-cct',
    'npm run test:e2e:status',
    'npm run test:e2e:audit',
    'npm exec -- node --test __tests__/*.test.mjs',
  ],
  final_gate_command_reference: 'docs/e2e-live-send-runbook.md',
}

writeFileSync(outputPath, JSON.stringify(index, null, 2))

console.log(`Evidence index: ${outputPath}`)
console.log(`Complete: ${index.complete}`)
console.log(`Safe non-live gates proved: ${index.safe_non_live_gates_proved}`)
console.log(`Proved requirements: ${index.summary.proved_requirements}`)
console.log(`Unproved requirements: ${index.summary.unproved_requirements}`)
console.log(`Remaining gate: ${index.summary.remaining_gate}`)
if (index.evidence_highlights.messages_db?.checked) {
  console.log(`Messages DB sample proof: last4=${index.evidence_highlights.messages_db.sample_last4} rows=${index.evidence_highlights.messages_db.sample_handle_rows} outbound=${index.evidence_highlights.messages_db.sample_outbound_rows} content_logged=${index.evidence_highlights.messages_db.content_logged}`)
}
if (index.evidence_highlights.browser_screenshots) {
  console.log(`Browser screenshots: count=${index.evidence_highlights.browser_screenshots.count} all_present=${index.evidence_highlights.browser_screenshots.all_present}`)
}
if (index.evidence_highlights.mobile_metrics) {
  console.log(`Mobile metrics: count=${index.evidence_highlights.mobile_metrics.count} overflow_free=${index.evidence_highlights.mobile_metrics.overflow_free}`)
}
if (index.evidence_highlights.production_cct) {
  console.log(`Production CCT: ok=${index.evidence_highlights.production_cct.ok} checks=${index.evidence_highlights.production_cct.passed}/${index.evidence_highlights.production_cct.total} profiles=${index.evidence_highlights.production_cct.inventory?.total ?? 'n/a'} hinge_images=${index.evidence_highlights.production_cct.inventory?.hingeWithImages ?? 'n/a'}/${index.evidence_highlights.production_cct.inventory?.hinge ?? 'n/a'} generic=${index.evidence_highlights.production_cct.inventory?.genericNames ?? 'n/a'} no_send=${index.evidence_highlights.production_cct.no_live_outbound_send_performed}`)
}
if (index.evidence_highlights.scheduled_live_preflight_gate) {
  console.log(`Scheduled live gate: blocked_by_preflight=${index.evidence_highlights.scheduled_live_preflight_gate.ok} no_send=${index.evidence_highlights.scheduled_live_preflight_gate.no_send_performed} missing=${index.evidence_highlights.scheduled_live_preflight_gate.missing.length}`)
}
console.log(`Artifact freshness: fresh=${index.summary.evidence_artifacts_fresh} max_age=${index.summary.evidence_max_age_seconds}s stale=${index.summary.stale_artifact_count} oldest=${index.summary.oldest_required_artifact_age_seconds}s`)
if (index.evidence_highlights.live_preflight) {
  console.log(`Live preflight: ready=${index.evidence_highlights.live_preflight.ok_to_run_live_harness} no_send=${index.evidence_highlights.live_preflight.no_send_performed} missing=${index.evidence_highlights.live_preflight.missing.length}`)
}
if (index.evidence_highlights.sample_live_preflight) {
  console.log(`Sample 757 preflight: ready=${index.evidence_highlights.sample_live_preflight.ok_to_run_live_harness} no_send=${index.evidence_highlights.sample_live_preflight.no_send_performed} last4=${index.evidence_highlights.sample_live_preflight.phone_last4 ?? 'n/a'} override=${index.evidence_highlights.sample_live_preflight.sample_override_present}`)
}
if (index.evidence_highlights.live_send_rehearsal) {
  console.log(`Live-send rehearsal: ok=${index.evidence_highlights.live_send_rehearsal.ok} source=${index.evidence_highlights.live_send_rehearsal.source ?? 'n/a'} no_send=${index.evidence_highlights.live_send_rehearsal.no_live_send_performed} immediate=${index.evidence_highlights.live_send_rehearsal.dry_run?.immediate_adapter ?? false} hash=${index.evidence_highlights.live_send_rehearsal.dry_run?.message_sha256_match ?? false} last4=${index.evidence_highlights.live_send_rehearsal.dry_run?.destination_last4_match ?? false} cleanup=${index.evidence_highlights.live_send_rehearsal.cleanup?.ok ?? false}`)
}
if (index.evidence_highlights.live_send) {
  console.log(`Final gate blockers: live_env_missing=${index.evidence_highlights.live_send.base_env_missing.length} sample_override_required=${sampleOverrideRequired} evidence_mismatch=${index.summary.final_gate_evidence_mismatch}`)
  console.log(`Live/preflight match: ${index.summary.live_evidence_matches_preflight}`)
}
if (index.evidence_highlights.final_gate?.next_required_action) {
  console.log(`Next required action: ${index.evidence_highlights.final_gate.next_required_action}`)
}
if (index.evidence_highlights.runtime_smoke) {
  console.log(`Runtime smoke: ok=${index.evidence_highlights.runtime_smoke.ok} no_send=${index.evidence_highlights.runtime_smoke.no_send} inbound_rows=${index.evidence_highlights.runtime_smoke.inbound_message_rows ?? 'n/a'} inbound_watcher=${index.evidence_highlights.runtime_smoke.inbound_watcher_ok} blocker=${index.evidence_highlights.runtime_smoke.inbound_watcher_status?.last_error_kind ?? 'none'}`)
  console.log(`Runtime terminal proof: ok=${index.evidence_highlights.runtime_smoke.inbound_terminal_proof_ok} count=${index.evidence_highlights.runtime_smoke.inbound_terminal_proof?.count ?? 'n/a'} no_send=${index.evidence_highlights.runtime_smoke.inbound_terminal_proof?.no_send === true} mutation=${index.evidence_highlights.runtime_smoke.inbound_terminal_proof?.mutation === true}`)
}
if (index.evidence_highlights.inbound_repair) {
  console.log(`Inbound repair harness: ok=${index.evidence_highlights.inbound_repair.ok} launchd_ready=${index.evidence_highlights.inbound_repair.launchd_ready} terminal=${index.evidence_highlights.inbound_repair.terminal_proof_ok} blocker=${index.evidence_highlights.inbound_repair.remaining_blocker ?? 'none'} no_send=${index.evidence_highlights.inbound_repair.no_live_send_performed}`)
  console.log(`Inbound repair TCC: python_authorized=${index.evidence_highlights.inbound_repair.tcc_python_authorized} denied_or_off=${index.evidence_highlights.inbound_repair.tcc_python_denied_or_off} rows=${index.evidence_highlights.inbound_repair.tcc_python_row_count ?? 'n/a'} real_python=${index.evidence_highlights.inbound_repair.real_python ?? 'n/a'}`)
}
if (index.evidence_highlights.local_browser) {
  console.log(`Local Chrome proof: ok=${index.evidence_highlights.local_browser.ok} route=${index.evidence_highlights.local_browser.active_route ?? 'n/a'} no_send=${index.evidence_highlights.local_browser.no_live_send_performed} pending=${index.evidence_highlights.local_browser.scheduled_counts?.pending ?? 'n/a'} approved=${index.evidence_highlights.local_browser.scheduled_counts?.approved ?? 'n/a'} forbidden_fixture=${index.evidence_highlights.local_browser.scheduled_counts?.forbidden_fixture_present ?? 'n/a'}`)
}
if (index.evidence_highlights.approval_packet) {
  console.log(`Approval packet: ready=${index.evidence_highlights.approval_packet.ok} no_send=${index.evidence_highlights.approval_packet.no_send_performed} missing_base_env=${index.evidence_highlights.approval_packet.missing_base_env.length} rehearsal=${index.evidence_highlights.approval_packet.live_send_rehearsal?.ok === true} template=${Array.isArray(index.evidence_highlights.approval_packet.approval_request_template?.required_response_lines)} markdown=${index.artifacts.approval_packet_markdown?.exists === true} markdown_e164_absent=${index.evidence_highlights.approval_packet.markdown_raw_e164_absent} markdown_body_absent=${index.evidence_highlights.approval_packet.markdown_raw_body_absent} raw_phone_written=${index.evidence_highlights.approval_packet.raw_phone_written} raw_body_written=${index.evidence_highlights.approval_packet.raw_body_written}`)
}
if (index.evidence_highlights.backend_doctor) {
  console.log(`Backend doctor: ok=${index.evidence_highlights.backend_doctor.ok} no_send=${index.evidence_highlights.backend_doctor.no_live_send_performed} checks=${index.summary.backend_doctor_checks_passed}/${index.summary.backend_doctor_checks_total}`)
}

if (index.safe_non_live_gates_proved !== true) process.exit(1)
