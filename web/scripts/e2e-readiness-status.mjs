#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const auditPath = process.env.CLAPCHEEKS_COMPLETION_AUDIT || '/tmp/clapcheeks-completion-audit-2026-05-18.json'
const safeEvidencePath = process.env.CLAPCHEEKS_E2E_EVIDENCE || '/tmp/clapcheeks-safe-e2e-readiness.json'
const liveEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json'
const livePreflightPath = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const sampleLivePreflightPath = process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT || '/tmp/clapcheeks-live-send-sample-preflight.json'
const liveSendRehearsalPath = process.env.CLAPCHEEKS_LIVE_SEND_REHEARSAL || '/tmp/clapcheeks-live-send-rehearsal.json'
const runtimeSmokePath = process.env.CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE || '/tmp/clapcheeks-runtime-smoke-evidence.json'
const inboundRepairPath = process.env.CLAPCHEEKS_INBOUND_REPAIR_EVIDENCE || '/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json'
const backendDoctorPath = process.env.CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE || '/tmp/clapcheeks-backend-doctor-2026-05-18.json'
const evidenceIndexPath = process.env.CLAPCHEEKS_EVIDENCE_INDEX || '/tmp/clapcheeks-e2e-evidence-index-2026-05-18.json'
const approvalPacketPath = process.env.CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET || '/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json'
const approvalPacketMarkdownPath = process.env.CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET_MD || '/tmp/clapcheeks-live-send-approval-packet-2026-05-18.md'
const productionCctPath = process.env.CLAPCHEEKS_PRODUCTION_CCT_LATEST || '/tmp/clapcheeks-production-cct-latest.json'
const deviceBlockerCctPath = process.env.CLAPCHEEKS_DEVICE_BLOCKER_CCT_LATEST || '/tmp/clapcheeks-prod-device-blocker-cct-latest.json'
const physicalDeviceAuditPath = process.env.CLAPCHEEKS_PHYSICAL_DEVICE_AUDIT || `${process.env.HOME || ''}/.clapcheeks-local/device-control/proof-runs/latest-completion-audit.json`
const physicalTransportDiagnosticsPath = process.env.CLAPCHEEKS_PHYSICAL_TRANSPORT_DIAGNOSTICS || `${process.env.HOME || ''}/.clapcheeks-local/device-control/proof-runs/latest-transport-diagnostics.json`
const runbookPath = 'docs/e2e-live-send-runbook.md'
const sampleRawPhone = '+17578312944'
const sampleRawBody = 'Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'
const sampleOverridePhrase = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'
const transportBlockerNames = new Set([
  'usbmux_no_bound_udid',
  'ios_deploy_no_bound_udid',
  'pairing_record_missing_for_bound_udid',
  'coredevice_no_bound_udid',
  'coredevice_list_failed',
])

function refreshEvidenceIndex() {
  if (process.env.CLAPCHEEKS_SKIP_EVIDENCE_INDEX_REFRESH === '1') return

  const evidenceIndexScript = fileURLToPath(new URL('./e2e-evidence-index.mjs', import.meta.url))
  spawnSync(process.execPath, [evidenceIndexScript], {
    env: process.env,
    stdio: 'ignore',
  })
}

function load(path) {
  if (!existsSync(path)) return { missing: true, path }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { parse_error: error instanceof Error ? error.message : String(error), path }
  }
}

refreshEvidenceIndex()

const audit = load(auditPath)
const safe = load(safeEvidencePath)
const live = load(liveEvidencePath)
const livePreflight = load(livePreflightPath)
const sampleLivePreflight = load(sampleLivePreflightPath)
const sampleLivePreflightRaw = existsSync(sampleLivePreflightPath) ? readFileSync(sampleLivePreflightPath, 'utf8') : ''
const liveSendRehearsal = load(liveSendRehearsalPath)
const runtimeSmoke = load(runtimeSmokePath)
const inboundRepair = load(inboundRepairPath)
const backendDoctor = load(backendDoctorPath)
const evidenceIndex = load(evidenceIndexPath)
const approvalPacket = load(approvalPacketPath)
const productionCct = load(productionCctPath)
const deviceBlockerCct = load(deviceBlockerCctPath)
const physicalDeviceAudit = load(physicalDeviceAuditPath)
const physicalTransportDiagnostics = load(physicalTransportDiagnosticsPath)
const approvalPacketMarkdownRaw = existsSync(approvalPacketMarkdownPath) ? readFileSync(approvalPacketMarkdownPath, 'utf8') : ''
const requirements = Array.isArray(audit?.requirements) ? audit.requirements : []
const proved = requirements.filter((item) => item.status === 'proved')
const unproved = requirements.filter((item) => item.status !== 'proved')
const liveGate = requirements.find((item) => item.name === 'real outbound send-to-Julian test')
const safeSample = requirements.find((item) => item.name === 'safe sample 757-831-2944 used without accidental real outbound send')
const scheduledGate = requirements.find((item) => item.name === 'scheduled message create approve dry-run cancel path works')
const insightsGate = requirements.find((item) => item.name === 'insights are functional')
const dashboardGate = requirements.find((item) => item.name === 'dashboard works end to end')
const messagesDb = safeSample?.detail?.messages_db_read_only || null
const baseLiveSendEnv = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
]

function getSafeCheck(name) {
  return Array.isArray(safe?.checks) ? safe.checks.find((item) => item.name === name) : null
}

function ageSeconds(isoTimestamp) {
  const time = Date.parse(isoTimestamp || '')
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.round((Date.now() - time) / 1000))
}

function finalGateSummary() {
  const liveMissing = Array.isArray(live?.missing) ? live.missing : []
  const preflightMissing = Array.isArray(livePreflight?.validation?.missing) ? livePreflight.validation.missing : []
  const preflightIssues = Array.isArray(livePreflight?.validation?.issues) ? livePreflight.validation.issues : []
  const baseMissing = baseLiveSendEnv.filter((name) => liveMissing.includes(name))
  const sampleOverrideMissing = preflightMissing.includes('CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944')
  const evidenceMismatch = baseMissing.length > 0 && sampleOverrideMissing
  const preflightHash = livePreflight?.validation?.message_sha256 || null
  const liveHash = live?.message_sha256 || null
  const preflightLength = livePreflight?.validation?.message_length ?? null
  const liveLength = live?.message_length ?? null
  const preflightLast4 = livePreflight?.validation?.phone_last4 || null
  const liveLast4 = live?.phone_last4 || null
  const liveSendProvenance = live?.send_provenance || null
  const sendProvenanceVerified = live?.send_provenance_verified === true &&
    liveSendProvenance?.source_label === 'clapcheeks_scheduled_messages_send_api' &&
    liveSendProvenance?.route === 'POST /api/scheduled-messages/send' &&
    liveSendProvenance?.message_sha256 === liveHash &&
    liveSendProvenance?.message_length === liveLength &&
    liveSendProvenance?.phone_last4 === liveLast4
  const liveEvidenceMatchesPreflight = Boolean(
    live?.live_send_performed === true &&
    livePreflight?.ok_to_run_live_harness === true &&
    preflightHash &&
    liveHash &&
    preflightHash === liveHash &&
    preflightLength === liveLength &&
    preflightLast4 === liveLast4,
  )

  return {
    complete: live?.ok === true && live?.live_send_performed === true && live?.messages_db_verified === true && sendProvenanceVerified && liveEvidenceMatchesPreflight,
    live_harness_ready: baseMissing.length === 0 && live?.live_send_performed !== true,
    live_harness_missing_base_env: baseMissing,
    preflight_ready: livePreflight?.ok_to_run_live_harness === true,
    preflight_missing: preflightMissing,
    preflight_issues: preflightIssues,
    sample_override_required: sampleOverrideMissing,
    evidence_mismatch: evidenceMismatch,
    live_evidence_matches_preflight: liveEvidenceMatchesPreflight,
    body_hash_match: preflightHash && liveHash ? preflightHash === liveHash : false,
    body_length_match: preflightLength != null && liveLength != null ? preflightLength === liveLength : false,
    destination_last4_match: preflightLast4 && liveLast4 ? preflightLast4 === liveLast4 : false,
    send_provenance_verified: sendProvenanceVerified,
    send_provenance: liveSendProvenance,
  }
}

function nextRequiredAction() {
  if (audit?.complete === true) return 'Goal can be marked complete after final evidence is reviewed.'
  if (physicalDeviceAudit?.completion_audit && physicalDeviceAudit.completion_audit !== 'passed') {
    const latestTransportBlockers = Array.isArray(physicalTransportDiagnostics?.blockers) ? physicalTransportDiagnostics.blockers : []
    const auditBlockers = Array.isArray(physicalDeviceAudit.blockers) ? physicalDeviceAudit.blockers : []
    const baseAuditBlockers = latestTransportBlockers.length > 0
      ? auditBlockers.filter((blocker) => !transportBlockerNames.has(blocker))
      : auditBlockers
    const blockers = [...new Set([...baseAuditBlockers, ...latestTransportBlockers])].join(', ') || 'physical iOS proof unavailable'
    return `Clear physical sender iPhone readiness before live completion: ${blockers}. Run ${physicalDeviceAudit.readiness_command || 'cd ~/clapcheeks-local && scripts/prepare-device-control-readiness.sh 2'} after unlocking the secondary iPhone, connecting USB, trusting this computer, and enabling Developer Mode.`
  }
  const runtimeInboundMissing = unproved.some((item) => item.name === 'runtime inbound source of truth is reachable in no-send mode')
  if (runtimeInboundMissing || inboundRepair?.launchd_ready === false || runtimeSmoke?.inbound_watcher_ok === false) {
    const blocker = inboundRepair?.remaining_blocker ||
      (inboundRepair?.launchd_ready === false ? 'full_disk_access_missing' : null) ||
      runtimeSmoke?.inbound_watcher_status?.last_error_kind ||
      'runtime_inbound_source_of_truth_missing'
    return `Repair missing non-live evidence first: runtime inbound source of truth is reachable in no-send mode. Run cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh, grant Full Disk Access to launchd Python, then rerun npm run test:e2e:runtime. Current blocker: ${blocker}.`
  }

  const missing = Array.isArray(livePreflight?.validation?.missing) ? livePreflight.validation.missing : []
  const issues = Array.isArray(livePreflight?.validation?.issues) ? livePreflight.validation.issues : []
  const liveMissing = Array.isArray(live?.missing) ? live.missing : []
  const baseMissing = baseLiveSendEnv.filter((name) => liveMissing.includes(name))
  if (baseMissing.length > 0) {
    return `Set Julian-confirmed live-send env and rerun npm run test:e2e:live:preflight before the live harness. Missing live harness env: ${baseMissing.join(', ')}.`
  }
  if (missing.length === 1 && missing[0] === 'CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944') {
    return 'Julian has selected a destination ending in 2944. Confirm whether 757-831-2944 is intentionally the live destination; if yes, set CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 exactly as documented before running the live harness.'
  }
  if (missing.length > 0 || issues.length > 0) {
    return `Resolve live preflight blockers: missing=${missing.join(', ') || 'none'}; issues=${issues.join('; ') || 'none'}.`
  }
  if (livePreflight?.ok_to_run_live_harness === true) {
    return 'Live preflight is ready. Run npm run test:e2e:live only after reviewing the redacted plan and confirming this is the intended live send.'
  }
  return 'Get Julian-confirmed destination phone, exact message body, and explicit live-send permission, then follow docs/e2e-live-send-runbook.md.'
}

const status = {
  complete: audit?.complete === true,
  safe_to_continue_without_live_send: audit?.safe_to_continue_without_live_send === true,
  proved_count: proved.length,
  unproved_count: unproved.length,
  unproved: unproved.map((item) => ({
    name: item.name,
    status: item.status,
    evidence: item.evidence,
  })),
  live_send: {
    evidence_path: liveEvidencePath,
    refused: live?.refused === true,
    performed: live?.live_send_performed === true,
    messages_db_verified: live?.messages_db_verified === true,
    required_permission: live?.required_permission || 'SEND LIVE TO JULIAN',
    missing: live?.missing || [],
  },
  production_cct: {
    evidence_path: productionCctPath,
    ok: productionCct?.passed === productionCct?.total && Number(productionCct?.total || 0) > 0,
    passed: productionCct?.passed ?? null,
    total: productionCct?.total ?? null,
    no_live_outbound_send_performed: productionCct?.noLiveOutboundSendPerformed === true,
    inventory: productionCct?.inventory || null,
    fixture: productionCct?.fixture ? {
      id: productionCct.fixture.id || null,
      status: productionCct.fixture.status ?? null,
      patchStatus: productionCct.fixture.patchStatus ?? null,
      archiveStatus: productionCct.fixture.archiveStatus ?? null,
    } : null,
    failed_checks: Array.isArray(productionCct?.checks)
      ? productionCct.checks.filter((check) => check.pass !== true).map((check) => check.name)
      : [],
  },
  physical_device_audit: {
    evidence_path: physicalDeviceAuditPath,
    latest_transport_diagnostics_path: physicalTransportDiagnosticsPath,
    status: physicalDeviceAudit?.completion_audit || null,
    audit_log: physicalDeviceAudit?.audit_log || null,
    failed_checks: Array.isArray(physicalDeviceAudit?.failed_checks) ? physicalDeviceAudit.failed_checks : [],
    audit_blockers: Array.isArray(physicalDeviceAudit?.blockers) ? physicalDeviceAudit.blockers : [],
    blockers: (() => {
      const auditBlockers = Array.isArray(physicalDeviceAudit?.blockers) ? physicalDeviceAudit.blockers : []
      const latestTransportBlockers = Array.isArray(physicalTransportDiagnostics?.blockers) ? physicalTransportDiagnostics.blockers : []
      const baseAuditBlockers = latestTransportBlockers.length > 0
        ? auditBlockers.filter((blocker) => !transportBlockerNames.has(blocker))
        : auditBlockers
      return [...new Set([...baseAuditBlockers, ...latestTransportBlockers])]
    })(),
    transport_visibility: physicalTransportDiagnostics?.missing === true || physicalTransportDiagnostics?.parse_error
      ? physicalDeviceAudit?.transport_visibility || null
      : physicalTransportDiagnostics,
    latest_transport_diagnostics: physicalTransportDiagnostics?.missing === true || physicalTransportDiagnostics?.parse_error
      ? null
      : physicalTransportDiagnostics,
    readiness_command: physicalDeviceAudit?.readiness_command || 'cd ~/clapcheeks-local && scripts/prepare-device-control-readiness.sh 2',
    physical_png_required: physicalDeviceAudit?.physical_png_required === true,
  },
  live_preflight: {
    evidence_path: livePreflightPath,
    ready: livePreflight?.ok_to_run_live_harness === true,
    no_send_performed: livePreflight?.no_send_performed === true,
    no_dashboard_mutation_performed: livePreflight?.no_dashboard_mutation_performed === true,
    safe_non_live_gates_proved: livePreflight?.current_readiness?.safe_non_live_gates_proved === true,
    missing: livePreflight?.validation?.missing || [],
    issues: livePreflight?.validation?.issues || [],
    phone_redacted: livePreflight?.validation?.phone_redacted || null,
    phone_last4: livePreflight?.validation?.phone_last4 || null,
    message_length: livePreflight?.validation?.message_length ?? null,
    message_sha256: livePreflight?.validation?.message_sha256 || null,
  },
  sample_live_preflight: {
    evidence_path: sampleLivePreflightPath,
    ready: sampleLivePreflight?.ok_to_run_live_harness === true,
    no_send_performed: sampleLivePreflight?.no_send_performed === true,
    no_dashboard_mutation_performed: sampleLivePreflight?.no_dashboard_mutation_performed === true,
    safe_non_live_gates_proved: sampleLivePreflight?.current_readiness?.safe_non_live_gates_proved === true,
    missing: sampleLivePreflight?.validation?.missing || [],
    issues: sampleLivePreflight?.validation?.issues || [],
    phone_redacted: sampleLivePreflight?.validation?.phone_redacted || null,
    phone_last4: sampleLivePreflight?.validation?.phone_last4 || null,
    message_length: sampleLivePreflight?.validation?.message_length ?? null,
    message_sha256: sampleLivePreflight?.validation?.message_sha256 || null,
    sample_2944_override_required: sampleLivePreflight?.validation?.sample_2944_override_required === true,
    sample_2944_override_present: sampleLivePreflight?.validation?.sample_2944_override_present === true,
    raw_phone_absent: !sampleLivePreflightRaw.includes(sampleRawPhone),
    raw_body_absent: !sampleLivePreflightRaw.includes(sampleRawBody),
  },
  approval_packet: {
    evidence_path: approvalPacketPath,
    markdown_path: approvalPacketMarkdownPath,
    markdown_exists: existsSync(approvalPacketMarkdownPath),
    markdown_raw_e164_absent: !approvalPacketMarkdownRaw.includes(sampleRawPhone),
    markdown_raw_body_absent: !approvalPacketMarkdownRaw.includes(sampleRawBody),
    markdown_sample_override_phrase_present: approvalPacketMarkdownRaw.includes(sampleOverridePhrase),
    ready: approvalPacket?.ok === true,
    no_send_performed: approvalPacket?.no_send_performed === true,
    no_dashboard_mutation_performed: approvalPacket?.no_dashboard_mutation_performed === true,
    raw_phone_written: approvalPacket?.raw_phone_written === true,
    raw_body_written: approvalPacket?.raw_body_written === true,
    missing_base_env: Array.isArray(approvalPacket?.required_env?.missing_now)
      ? approvalPacket.required_env.missing_now
      : [],
    required_permission: approvalPacket?.required_current_approval?.explicit_permission_phrase || 'SEND LIVE TO JULIAN',
    sample_2944_override_phrase: approvalPacket?.required_current_approval?.sample_2944_override_required_if_destination_ends_2944 || 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION',
    approval_template_present: Array.isArray(approvalPacket?.approval_request_template?.required_response_lines) &&
      approvalPacket.approval_request_template.required_response_lines.length >= 4,
    approval_template_raw_values_written: approvalPacket?.approval_request_template?.raw_values_written === true,
    safe_non_live_gates_proved: approvalPacket?.current_status?.safe_non_live_gates_proved === true,
    proved_requirements: approvalPacket?.current_status?.proved_requirements ?? null,
    unproved_requirements: approvalPacket?.current_status?.unproved_requirements ?? null,
    live_gate_status: approvalPacket?.current_status?.live_gate_status || null,
    local_browser_ok: approvalPacket?.current_safe_evidence?.local_browser?.ok === true,
    local_browser_route: approvalPacket?.current_safe_evidence?.local_browser?.active_route || null,
    sample_preflight_ready: approvalPacket?.current_safe_evidence?.sample_preflight?.ready === true,
    sample_preflight_last4: approvalPacket?.current_safe_evidence?.sample_preflight?.phone_last4 || null,
    rehearsal_ok: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.ok === true,
    rehearsal_no_send: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.no_live_send_performed === true,
    rehearsal_immediate_adapter: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.immediate_adapter === true,
    rehearsal_hash_match: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.message_sha256_match === true,
    rehearsal_last4_match: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.destination_last4_match === true,
    rehearsal_cleanup_ok: approvalPacket?.current_safe_evidence?.live_send_rehearsal?.cleanup_ok === true,
  },
  live_send_rehearsal: {
    evidence_path: liveSendRehearsalPath,
    ok: liveSendRehearsal?.ok === true,
    source: liveSendRehearsal?.source || null,
    no_live_send_performed: liveSendRehearsal?.no_live_send_performed === true,
    dry_run_only: liveSendRehearsal?.dry_run_only === true,
    preflight_ready: liveSendRehearsal?.preflight_ready === true,
    destination: liveSendRehearsal?.redacted_plan?.destination || null,
    message_sha256: liveSendRehearsal?.redacted_plan?.message_sha256 || null,
    message_length: liveSendRehearsal?.redacted_plan?.message_length ?? null,
    immediate_adapter: liveSendRehearsal?.dry_run?.immediate_adapter === true,
    message_sha256_match: liveSendRehearsal?.dry_run?.message_sha256_match === true,
    destination_last4_match: liveSendRehearsal?.dry_run?.destination_last4_match === true,
    cleanup_ok: liveSendRehearsal?.cleanup?.ok === true,
    no_raw_phone_written: liveSendRehearsal?.no_raw_phone_written === true,
    no_raw_body_written: liveSendRehearsal?.no_raw_body_written === true,
  },
  backend_doctor: {
    evidence_path: backendDoctorPath,
    ok: backendDoctor?.ok === true,
    no_send_performed: backendDoctor?.no_live_send_performed === true,
    no_dashboard_mutation_performed: backendDoctor?.no_dashboard_mutation_performed === true,
    checks_passed: Array.isArray(backendDoctor?.checks) ? backendDoctor.checks.filter((item) => item.ok === true).length : 0,
    checks_total: Array.isArray(backendDoctor?.checks) ? backendDoctor.checks.length : 0,
    scope: backendDoctor?.checked_scope || [],
    checks: Array.isArray(backendDoctor?.checks)
      ? backendDoctor.checks.map((item) => ({ name: item.name, ok: item.ok, summary: item.detail?.summary || null }))
      : [],
  },
  runtime_smoke: {
    evidence_path: runtimeSmokePath,
    ok: runtimeSmoke?.ok === true,
    no_send: runtimeSmoke?.no_send === true,
    inbound_watcher_ok: runtimeSmoke?.inbound_watcher_ok === true,
    inbound_watcher_status_path: runtimeSmoke?.inbound_watcher_status_path || null,
    inbound_watcher_blocker: runtimeSmoke?.inbound_watcher_status?.last_error_kind || null,
    inbound_watcher_fda_alert_enabled: runtimeSmoke?.inbound_watcher_status?.fda_alert_imessage_enabled === true,
    inbound_terminal_proof_ok: runtimeSmoke?.inbound_terminal_proof_ok === true,
    inbound_terminal_proof_path: runtimeSmoke?.inbound_terminal_proof_path || null,
    inbound_terminal_proof_count: runtimeSmoke?.inbound_terminal_proof?.count ?? null,
    inbound_terminal_proof_no_send: runtimeSmoke?.inbound_terminal_proof?.no_send === true,
    inbound_terminal_proof_mutation: runtimeSmoke?.inbound_terminal_proof?.mutation === true,
    inbound_message_rows: runtimeSmoke?.inbound_message_rows ?? null,
    outbound_insert_skipped: runtimeSmoke?.outbound_insert_skipped === true,
    drainer_skipped: runtimeSmoke?.drainer_skipped === true,
  },
  inbound_repair: {
    evidence_path: inboundRepairPath,
    ok: inboundRepair?.ok === true,
    launchd_ready: inboundRepair?.launchd_ready === true,
    terminal_proof_ok: inboundRepair?.terminal_proof_ok === true,
    remaining_blocker: inboundRepair?.remaining_blocker || null,
    no_send: inboundRepair?.no_live_send_performed === true,
    convex_inbound_mutation_after_fda_possible: inboundRepair?.convex_inbound_mutation_after_fda_possible === true,
    runtime_smoke_exit: inboundRepair?.steps?.runtime_smoke?.exit_code ?? null,
    tcc_python_row_count: inboundRepair?.full_disk_access_tcc?.python_row_count ?? null,
    tcc_python_authorized: inboundRepair?.full_disk_access_tcc?.python_authorized === true,
    tcc_python_denied_or_off: inboundRepair?.full_disk_access_tcc?.python_denied_or_off === true,
    real_python: inboundRepair?.real_python || null,
  },
  visual_evidence: {
    evidence_index_path: evidenceIndexPath,
    evidence_index_generated_at: evidenceIndex?.generated_at || null,
    evidence_index_age_seconds: ageSeconds(evidenceIndex?.generated_at),
    artifacts: evidenceIndex?.artifacts || {},
    screenshot_count: evidenceIndex?.summary?.visual_screenshot_count ?? evidenceIndex?.summary?.browser_screenshot_count ?? null,
    screenshots_all_present: evidenceIndex?.summary?.visual_screenshots_all_present === true ||
      evidenceIndex?.summary?.browser_screenshots_all_present === true,
    screenshots: evidenceIndex?.evidence_highlights?.visual_screenshots?.files ||
      evidenceIndex?.evidence_highlights?.browser_screenshots?.files ||
      [],
    dashboard_navigation_integrity: evidenceIndex?.summary?.dashboard_navigation_integrity === true,
    dashboard_navigation: evidenceIndex?.evidence_highlights?.browser?.dashboard_navigation || null,
    dashboard_health_blockers_quick_view: evidenceIndex?.summary?.dashboard_health_blockers_quick_view === true,
    dashboard_health_blockers: evidenceIndex?.evidence_highlights?.browser?.dashboard_health_blockers || null,
    dashboard_imessage_self_test_surface: evidenceIndex?.summary?.dashboard_imessage_self_test_surface === true,
    dashboard_imessage_self_test: evidenceIndex?.evidence_highlights?.browser?.dashboard_imessage_self_test || null,
    dashboard_live_send_gate_ready: evidenceIndex?.summary?.dashboard_live_send_gate_ready === true,
    dashboard_live_send_gate_missing: Array.isArray(evidenceIndex?.summary?.dashboard_live_send_gate_missing)
      ? evidenceIndex.summary.dashboard_live_send_gate_missing
      : [],
    dashboard_imessage_dry_run_click: evidenceIndex?.summary?.dashboard_imessage_dry_run_click === true,
    dashboard_imessage_dry_run: evidenceIndex?.evidence_highlights?.browser?.dashboard_imessage_dry_run || null,
    device_mobile_quick_view: evidenceIndex?.summary?.device_mobile_quick_view === true,
    device_control_safety_surface: deviceBlockerCct?.ok === true || evidenceIndex?.summary?.device_control_safety_surface === true,
    device_control_status: deviceBlockerCct?.ok === true
      ? {
          selected_line: 2,
          current_blocker: deviceBlockerCct.current_blocker,
          latest_blockers_source: deviceBlockerCct.latest_blockers_source,
          latest_known_blockers: Array.isArray(deviceBlockerCct.latest_known_blockers)
            ? deviceBlockerCct.latest_known_blockers
            : [],
          transport_telemetry_event_id: deviceBlockerCct.transport_telemetry_event_id || null,
          completion_telemetry_event_id: deviceBlockerCct.completion_telemetry_event_id || null,
          no_live_action_performed: deviceBlockerCct.no_live_action === true && deviceBlockerCct.no_live_outbound_send_performed === true,
          evidence_path: deviceBlockerCct.reportPath || deviceBlockerCctPath,
        }
      : evidenceIndex?.evidence_highlights?.browser?.device_control_status || null,
    mobile_metric_count: evidenceIndex?.summary?.mobile_metric_count ?? null,
    mobile_metrics_overflow_free: evidenceIndex?.summary?.mobile_metrics_overflow_free === true,
    scheduled_ui_matches_api: evidenceIndex?.summary?.scheduled_ui_matches_api === true,
    scheduled_api_binding: evidenceIndex?.evidence_highlights?.browser?.scheduled_api_binding || null,
    scheduled_mobile_form_filled: evidenceIndex?.summary?.scheduled_mobile_form_filled === true,
    scheduled_mobile_form_no_submit: evidenceIndex?.summary?.scheduled_mobile_form_no_submit === true,
    scheduled_mobile_form: evidenceIndex?.evidence_highlights?.browser?.scheduled_mobile_form || null,
    scheduled_send_confirmation_guardrail: evidenceIndex?.summary?.scheduled_send_confirmation_guardrail === true,
    scheduled_send_confirmation: evidenceIndex?.evidence_highlights?.browser?.scheduled_send_confirmation || null,
    intelligence_ui_matches_api: evidenceIndex?.summary?.intelligence_ui_matches_api === true,
    intelligence_api_binding: evidenceIndex?.evidence_highlights?.browser?.intelligence_api_binding || null,
    analytics_mobile_ui_matches_api: evidenceIndex?.summary?.analytics_mobile_ui_matches_api === true,
    analytics_mobile_api_binding: evidenceIndex?.evidence_highlights?.browser?.analytics_mobile_api_binding || null,
    mobile_metrics: evidenceIndex?.evidence_highlights?.mobile_metrics?.pages || {},
    artifact_freshness: evidenceIndex?.evidence_highlights?.artifact_freshness || {
      all_required_fresh: null,
      current_production_fresh: null,
      current_production_oldest_age_seconds: null,
      current_production_stale_artifacts: [],
      historical_fresh: null,
      historical_oldest_age_seconds: null,
      historical_stale_artifacts: [],
      max_age_seconds: null,
      oldest_required_age_seconds: null,
      stale_artifacts: [],
    },
  },
  scheduled_flow: {
    evidence_path: safeEvidencePath,
    created: getSafeCheck('scheduled create')?.ok === true,
    created_id: getSafeCheck('scheduled create')?.detail?.id || null,
    approved: getSafeCheck('scheduled approve')?.ok === true,
    live_blocked_without_phrase: getSafeCheck('scheduled live blocked without phrase')?.ok === true,
    live_blocked_by_preflight_gate: getSafeCheck('scheduled live blocked by preflight gate')?.ok === true,
    live_preflight_gate_status: getSafeCheck('scheduled live blocked by preflight gate')?.detail?.response?.live_send_gate || null,
    live_preflight_redacted_plan_present: Object.prototype.hasOwnProperty.call(
      getSafeCheck('scheduled live blocked by preflight gate')?.detail?.response?.live_send_gate || {},
      'redacted_execution_plan',
    ),
    dry_run: getSafeCheck('scheduled dry-run')?.ok === true,
    dry_run_adapter: getSafeCheck('scheduled dry-run')?.detail?.response?.would_send?.adapter || null,
    dry_run_last4: getSafeCheck('scheduled dry-run')?.detail?.response?.would_send?.phone_last4 || safe?.sample_last4 || null,
    dry_run_provenance_verified: scheduledGate?.detail?.dry_run_provenance_ok === true ||
      getSafeCheck('scheduled dry-run')?.detail?.provenance_ok === true,
    dry_run_provenance: scheduledGate?.detail?.dry_run_provenance ||
      getSafeCheck('scheduled dry-run')?.detail?.response?.send_provenance ||
      null,
    cleanup_cancel: getSafeCheck('scheduled cleanup cancel')?.ok === true,
    fixture_cleanup: getSafeCheck('scheduled fixture cleanup')?.ok === true,
    active_fixtures: Array.isArray(getSafeCheck('scheduled fixture cleanup')?.detail?.remaining)
      ? getSafeCheck('scheduled fixture cleanup').detail.remaining.length
      : null,
  },
  insights_data: {
    evidence_path: safeEvidencePath,
    contract: getSafeCheck('analytics summary contract')?.ok === true,
    matches: getSafeCheck('analytics summary contract')?.detail?.totals?.matches ?? null,
    conversations: getSafeCheck('analytics summary contract')?.detail?.totals?.conversations ?? null,
    platform_count: getSafeCheck('analytics summary contract')?.detail?.platform_count ?? null,
    time_series_rows: getSafeCheck('analytics summary contract')?.detail?.time_series_rows ?? null,
    funnel_stages: getSafeCheck('analytics summary contract')?.detail?.funnel_stages || [],
    completion_gate: insightsGate?.status || null,
  },
  dashboard_health: {
    evidence_path: safeEvidencePath,
    contract: getSafeCheck('dashboard runtime health contract')?.ok === true,
    overall: getSafeCheck('dashboard runtime health contract')?.detail?.overall || null,
    convex_status: getSafeCheck('dashboard runtime health contract')?.detail?.convex_status || null,
    missing_required: getSafeCheck('dashboard runtime health contract')?.detail?.missing_required ?? null,
    missing_required_services: getSafeCheck('dashboard runtime health contract')?.detail?.missing_required_services || [],
    sendbird_status: getSafeCheck('dashboard runtime health contract')?.detail?.sendbird_status || null,
    sendbird_missing_env: getSafeCheck('dashboard runtime health contract')?.detail?.sendbird_missing_env || [],
    token_values_omitted: getSafeCheck('dashboard runtime health contract')?.detail?.token_values_omitted === true,
    scope_note: getSafeCheck('dashboard runtime health contract')?.detail?.scope_note || null,
    completion_gate: dashboardGate?.status || null,
  },
  final_gate: finalGateSummary(),
  messages_db: messagesDb ? {
    checked: messagesDb.checked === true,
    sample_last4: messagesDb.sample_last4 || null,
    sample_handle_rows: messagesDb.sample_handle_rows ?? null,
    sample_outbound_rows: messagesDb.sample_outbound_rows ?? null,
    total_rows: messagesDb.total_rows ?? null,
    content_logged: messagesDb.content_logged === true,
  } : null,
  next_required_action: nextRequiredAction(),
  runbook: runbookPath,
  audit_path: auditPath,
}

console.log(`ClapCheeks readiness: ${status.complete ? 'COMPLETE' : 'NOT COMPLETE'}`)
console.log(`Safe non-live gates: ${status.safe_to_continue_without_live_send ? 'proved' : 'not fully proved'}`)
console.log(`Proved requirements: ${status.proved_count}`)
console.log(`Unproved requirements: ${status.unproved_count}`)
if (liveGate) console.log(`Live-send gate: ${liveGate.status}`)
if (status.messages_db?.checked) {
  console.log(`Messages DB sample proof: last4=${status.messages_db.sample_last4} rows=${status.messages_db.sample_handle_rows} outbound=${status.messages_db.sample_outbound_rows} content_logged=${status.messages_db.content_logged}`)
}
console.log(`Live preflight: ready=${status.live_preflight.ready} no_send=${status.live_preflight.no_send_performed} missing=${status.live_preflight.missing.length}`)
if (status.live_preflight.message_sha256) console.log(`Live preflight plan: destination=${status.live_preflight.phone_redacted ?? 'n/a'} body_sha256=${status.live_preflight.message_sha256} body_length=${status.live_preflight.message_length ?? 'n/a'}`)
console.log(`Sample 757 preflight: ready=${status.sample_live_preflight.ready} no_send=${status.sample_live_preflight.no_send_performed} last4=${status.sample_live_preflight.phone_last4 ?? 'n/a'} override=${status.sample_live_preflight.sample_2944_override_present}`)
if (status.sample_live_preflight.message_sha256) console.log(`Sample 757 preflight plan: destination=${status.sample_live_preflight.phone_redacted ?? 'n/a'} body_sha256=${status.sample_live_preflight.message_sha256} body_length=${status.sample_live_preflight.message_length ?? 'n/a'}`)
console.log(`Sample 757 redaction: raw_phone_absent=${status.sample_live_preflight.raw_phone_absent} raw_body_absent=${status.sample_live_preflight.raw_body_absent}`)
console.log(`Final gate: live_env_missing=${status.final_gate.live_harness_missing_base_env.length} sample_override_required=${status.final_gate.sample_override_required} evidence_mismatch=${status.final_gate.evidence_mismatch}`)
console.log(`Live/preflight match: ${status.final_gate.live_evidence_matches_preflight} hash=${status.final_gate.body_hash_match} length=${status.final_gate.body_length_match} last4=${status.final_gate.destination_last4_match} provenance=${status.final_gate.send_provenance_verified}`)
console.log(`Approval packet: ready=${status.approval_packet.ready} no_send=${status.approval_packet.no_send_performed} missing_base_env=${status.approval_packet.missing_base_env.length} rehearsal=${status.approval_packet.rehearsal_ok} template=${status.approval_packet.approval_template_present} markdown=${status.approval_packet.markdown_exists} markdown_e164_absent=${status.approval_packet.markdown_raw_e164_absent} markdown_body_absent=${status.approval_packet.markdown_raw_body_absent} raw_phone_written=${status.approval_packet.raw_phone_written} raw_body_written=${status.approval_packet.raw_body_written}`)
console.log(`Live-send rehearsal: ok=${status.live_send_rehearsal.ok} source=${status.live_send_rehearsal.source ?? 'n/a'} no_send=${status.live_send_rehearsal.no_live_send_performed} dry_run=${status.live_send_rehearsal.dry_run_only} immediate=${status.live_send_rehearsal.immediate_adapter} hash=${status.live_send_rehearsal.message_sha256_match} last4=${status.live_send_rehearsal.destination_last4_match} cleanup=${status.live_send_rehearsal.cleanup_ok}`)
console.log(`Backend doctor: ok=${status.backend_doctor.ok} no_send=${status.backend_doctor.no_send_performed} checks=${status.backend_doctor.checks_passed}/${status.backend_doctor.checks_total}`)
console.log(`Visual evidence: screenshots=${status.visual_evidence.screenshot_count ?? 'n/a'} all_present=${status.visual_evidence.screenshots_all_present} age_seconds=${status.visual_evidence.evidence_index_age_seconds ?? 'n/a'}`)
console.log(`Dashboard navigation: ok=${status.visual_evidence.dashboard_navigation_integrity} routes=${status.visual_evidence.dashboard_navigation?.route_checks?.length ?? 'n/a'} failed=${status.visual_evidence.dashboard_navigation?.failed_routes?.length ?? 'n/a'}`)
console.log(`Dashboard blocker quick view: ok=${status.visual_evidence.dashboard_health_blockers_quick_view} blockers=${status.visual_evidence.dashboard_health_blockers?.expected_blockers?.join(',') || 'n/a'} redacted=${status.visual_evidence.dashboard_health_blockers?.no_token_values_present ?? 'n/a'}`)
console.log(`Dashboard iMessage self-test: ok=${status.visual_evidence.dashboard_imessage_self_test_surface} dry_run=${status.visual_evidence.dashboard_imessage_self_test?.dry_run_default ?? 'n/a'} last4=${status.visual_evidence.dashboard_imessage_self_test?.self_test_recipient_last4 ?? 'n/a'}`)
console.log(`Dashboard live-send gate: ready=${status.visual_evidence.dashboard_live_send_gate_ready} missing=${status.visual_evidence.dashboard_live_send_gate_missing.length}`)
console.log(`Dashboard iMessage dry-run click: ok=${status.visual_evidence.dashboard_imessage_dry_run_click} no_queue_delta=${status.visual_evidence.dashboard_imessage_dry_run?.no_queue_delta ?? 'n/a'} success=${status.visual_evidence.dashboard_imessage_dry_run?.success_message_present ?? 'n/a'}`)
console.log(`Device control safety: ok=${status.visual_evidence.device_control_safety_surface} mobile=${status.visual_evidence.device_mobile_quick_view} line=${status.visual_evidence.device_control_status?.selected_line ?? 'n/a'} blocker=${status.visual_evidence.device_control_status?.current_blocker ?? 'n/a'} source=${status.visual_evidence.device_control_status?.latest_blockers_source ?? 'n/a'} no_live_action=${status.visual_evidence.device_control_status?.no_live_action_performed ?? 'n/a'}`)
console.log(`Mobile metrics: pages=${status.visual_evidence.mobile_metric_count ?? 'n/a'} overflow_free=${status.visual_evidence.mobile_metrics_overflow_free}`)
console.log(`Scheduled UI/API: match=${status.visual_evidence.scheduled_ui_matches_api} total=${status.visual_evidence.scheduled_api_binding?.total_messages ?? 'n/a'} pending=${status.visual_evidence.scheduled_api_binding?.expected_counts?.pending ?? 'n/a'} approved=${status.visual_evidence.scheduled_api_binding?.expected_counts?.approved ?? 'n/a'}`)
console.log(`Scheduled mobile form: filled=${status.visual_evidence.scheduled_mobile_form_filled} no_submit=${status.visual_evidence.scheduled_mobile_form_no_submit} sample_last4=${status.visual_evidence.scheduled_mobile_form?.sample_last4 ?? 'n/a'}`)
console.log(`Scheduled send confirmation: guardrail=${status.visual_evidence.scheduled_send_confirmation_guardrail} wrong_phrase_disabled=${status.visual_evidence.scheduled_send_confirmation?.guardrail?.send_disabled_with_wrong_phrase ?? 'n/a'} cleanup=${status.visual_evidence.scheduled_send_confirmation?.cleanup?.ok ?? 'n/a'}`)
console.log(`Scheduled live gate: blocked_by_preflight=${status.scheduled_flow.live_blocked_by_preflight_gate} no_send=${status.scheduled_flow.live_preflight_gate_status?.no_send_performed ?? 'n/a'} missing=${status.scheduled_flow.live_preflight_gate_status?.missing?.length ?? 'n/a'}`)
console.log(`Scheduled live gate plan: redacted=${status.scheduled_flow.live_preflight_redacted_plan_present} sha256=${status.scheduled_flow.live_preflight_gate_status?.redacted_execution_plan?.message_sha256 ? 'present' : 'missing'}`)
console.log(`Intelligence UI/API: match=${status.visual_evidence.intelligence_ui_matches_api} reply_rate=${status.visual_evidence.intelligence_api_binding?.expected?.reply_rate_percent ?? 'n/a'} replied=${status.visual_evidence.intelligence_api_binding?.expected?.replied ?? 'n/a'}`)
console.log(`Analytics mobile UI/API: match=${status.visual_evidence.analytics_mobile_ui_matches_api} matches=${status.visual_evidence.analytics_mobile_api_binding?.expected?.matches ?? 'n/a'} rizz=${status.visual_evidence.analytics_mobile_api_binding?.expected?.rizz_score ?? 'n/a'}`)
console.log(`Artifact freshness: current_production=${status.visual_evidence.artifact_freshness.current_production_fresh ?? status.visual_evidence.artifact_freshness.all_required_fresh ?? 'n/a'} historical=${status.visual_evidence.artifact_freshness.historical_fresh ?? status.visual_evidence.artifact_freshness.all_required_fresh ?? 'n/a'} max_age=${status.visual_evidence.artifact_freshness.max_age_seconds ?? 'n/a'}s current_stale=${status.visual_evidence.artifact_freshness.current_production_stale_artifacts?.length ?? 'n/a'} historical_stale=${status.visual_evidence.artifact_freshness.historical_stale_artifacts?.length ?? status.visual_evidence.artifact_freshness.stale_artifacts?.length ?? 'n/a'} current_oldest=${status.visual_evidence.artifact_freshness.current_production_oldest_age_seconds ?? 'n/a'}s historical_oldest=${status.visual_evidence.artifact_freshness.historical_oldest_age_seconds ?? status.visual_evidence.artifact_freshness.oldest_required_age_seconds ?? 'n/a'}s`)
console.log(`Insights data: contract=${status.insights_data.contract} matches=${status.insights_data.matches ?? 'n/a'} conversations=${status.insights_data.conversations ?? 'n/a'} platforms=${status.insights_data.platform_count ?? 'n/a'} days=${status.insights_data.time_series_rows ?? 'n/a'}`)
console.log(`Dashboard health: contract=${status.dashboard_health.contract} overall=${status.dashboard_health.overall ?? 'n/a'} convex=${status.dashboard_health.convex_status ?? 'n/a'} missing_required=${status.dashboard_health.missing_required ?? 'n/a'} blockers=${status.dashboard_health.missing_required_services.map((item) => item.name).join(',') || 'none'} sendbird=${status.dashboard_health.sendbird_status ?? 'n/a'} redacted=${status.dashboard_health.token_values_omitted}`)
console.log(`Scheduled flow: created=${status.scheduled_flow.created} approved=${status.scheduled_flow.approved} dry_run=${status.scheduled_flow.dry_run} provenance=${status.scheduled_flow.dry_run_provenance_verified} live_gate=${status.scheduled_flow.live_blocked_by_preflight_gate} cleanup=${status.scheduled_flow.cleanup_cancel && status.scheduled_flow.fixture_cleanup} active_fixtures=${status.scheduled_flow.active_fixtures ?? 'n/a'}`)
console.log(`Runtime smoke: ok=${status.runtime_smoke.ok} no_send=${status.runtime_smoke.no_send} inbound_rows=${status.runtime_smoke.inbound_message_rows ?? 'n/a'} inbound_watcher=${status.runtime_smoke.inbound_watcher_ok} blocker=${status.runtime_smoke.inbound_watcher_blocker ?? 'none'}`)
console.log(`Runtime terminal proof: ok=${status.runtime_smoke.inbound_terminal_proof_ok} count=${status.runtime_smoke.inbound_terminal_proof_count ?? 'n/a'} no_send=${status.runtime_smoke.inbound_terminal_proof_no_send} mutation=${status.runtime_smoke.inbound_terminal_proof_mutation}`)
console.log(`Inbound repair harness: ok=${status.inbound_repair.ok} launchd_ready=${status.inbound_repair.launchd_ready} terminal=${status.inbound_repair.terminal_proof_ok} blocker=${status.inbound_repair.remaining_blocker ?? 'none'} no_send=${status.inbound_repair.no_send}`)
console.log(`Inbound repair TCC: python_authorized=${status.inbound_repair.tcc_python_authorized} denied_or_off=${status.inbound_repair.tcc_python_denied_or_off} rows=${status.inbound_repair.tcc_python_row_count ?? 'n/a'} real_python=${status.inbound_repair.real_python ?? 'n/a'}`)
console.log(`Live evidence: ${liveEvidencePath}`)
console.log(`Production CCT: ok=${status.production_cct.ok} checks=${status.production_cct.passed ?? 'n/a'}/${status.production_cct.total ?? 'n/a'} profiles=${status.production_cct.inventory?.total ?? 'n/a'} hinge_images=${status.production_cct.inventory?.hingeWithImages ?? 'n/a'}/${status.production_cct.inventory?.hinge ?? 'n/a'} generic=${status.production_cct.inventory?.genericNames ?? 'n/a'} no_send=${status.production_cct.no_live_outbound_send_performed}`)
console.log(`Physical device audit: status=${status.physical_device_audit.status ?? 'n/a'} blockers=${status.physical_device_audit.blockers.join(',') || 'none'} transport=${status.physical_device_audit.transport_visibility?.summary ?? 'n/a'}`)
console.log(`Runbook: ${runbookPath}`)
console.log(`Next: ${status.next_required_action}`)
console.log('')
console.log(JSON.stringify(status, null, 2))

if (status.safe_to_continue_without_live_send !== true) process.exit(1)
