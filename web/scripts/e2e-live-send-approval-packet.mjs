#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const outputPath = process.env.CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET || '/tmp/clapcheeks-live-send-approval-packet-2026-05-18.json'
const markdownOutputPath = process.env.CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET_MD || '/tmp/clapcheeks-live-send-approval-packet-2026-05-18.md'
const auditPath = process.env.CLAPCHEEKS_COMPLETION_AUDIT || '/tmp/clapcheeks-completion-audit-2026-05-18.json'
const liveEvidencePath = process.env.CLAPCHEEKS_LIVE_SEND_EVIDENCE || '/tmp/clapcheeks-live-send-evidence.json'
const livePreflightPath = process.env.CLAPCHEEKS_LIVE_SEND_PREFLIGHT || '/tmp/clapcheeks-live-send-preflight.json'
const samplePreflightPath = process.env.CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT || '/tmp/clapcheeks-live-send-sample-preflight.json'
const rehearsalPath = process.env.CLAPCHEEKS_LIVE_SEND_REHEARSAL || '/tmp/clapcheeks-live-send-rehearsal.json'
const localBrowserPath = process.env.CLAPCHEEKS_LOCAL_BROWSER_PROOF || '/tmp/clapcheeks-local-browser-proof-2026-05-18.json'
const requiredPermission = 'SEND LIVE TO JULIAN'
const sample2944OverridePhrase = 'I CONFIRM 757-831-2944 IS THE LIVE DESTINATION'
const baseLiveSendEnv = [
  'CLAPCHEEKS_LIVE_SEND_PERMISSION',
  'CLAPCHEEKS_LIVE_SEND_PHONE',
  'CLAPCHEEKS_LIVE_SEND_BODY',
  'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
]

function loadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const audit = loadJson(auditPath)
const liveEvidence = loadJson(liveEvidencePath)
const livePreflight = loadJson(livePreflightPath)
const samplePreflight = loadJson(samplePreflightPath)
const rehearsal = loadJson(rehearsalPath)
const localBrowser = loadJson(localBrowserPath)
const requirements = Array.isArray(audit?.requirements) ? audit.requirements : []
const proved = requirements.filter((item) => item.status === 'proved')
const unproved = requirements.filter((item) => item.status !== 'proved')
const liveGate = requirements.find((item) => item.name === 'real outbound send-to-Julian test')
const safeNonLiveReady = audit?.safe_to_continue_without_live_send === true &&
  requirements.some((item) => item.name === 'local Chrome browser proof from Julian computer is current and read-only' && item.status === 'proved') &&
  requirements.some((item) => item.name === 'final live-send no-send rehearsal matches redacted preflight plan' && item.status === 'proved') &&
  requirements.some((item) => item.name === 'safe sample 757-831-2944 used without accidental real outbound send' && item.status === 'proved')
const liveMissing = Array.isArray(liveEvidence?.missing) ? liveEvidence.missing : baseLiveSendEnv
const missingBaseEnv = baseLiveSendEnv.filter((name) => liveMissing.includes(name) || livePreflight?.validation?.missing?.includes(name))

const packet = {
  ok: safeNonLiveReady && liveGate?.status === 'unproved_requires_explicit_live_permission',
  generated_at: new Date().toISOString(),
  output_path: outputPath,
  markdown_output_path: markdownOutputPath,
  no_send_performed: true,
  no_dashboard_mutation_performed: true,
  raw_phone_written: false,
  raw_body_written: false,
  current_status: {
    complete: audit?.complete === true,
    safe_non_live_gates_proved: audit?.safe_to_continue_without_live_send === true,
    proved_requirements: proved.length,
    unproved_requirements: unproved.length,
    live_gate_status: liveGate?.status || null,
    final_gate_next_required_action: audit?.next_required_action || null,
  },
  required_current_approval: {
    explicit_permission_phrase: requiredPermission,
    exact_destination_phone_required: true,
    exact_message_body_required: true,
    expected_destination_last4_required: true,
    sample_2944_override_required_if_destination_ends_2944: sample2944OverridePhrase,
  },
  approval_request_template: {
    raw_values_written: false,
    purpose: 'Collect one current explicit approval before any live outbound send.',
    required_response_lines: [
      `Permission phrase: ${requiredPermission}`,
      'Destination phone: <exact E.164 phone number to send to>',
      'Expected last4: <last four digits of the destination>',
      'Message body: <exact text to send>',
      `Sample 2944 override: ${sample2944OverridePhrase} <only if the destination ends in 2944>`,
    ],
    operator_must_verify: [
      'The destination phone exactly matches Julian approval.',
      'The expected last4 matches the destination.',
      'The message body exactly matches Julian approval.',
      'The redacted preflight destination, body length, and SHA-256 are reviewed before the live harness.',
      'No prior shell env from an older run is reused without rechecking the approval text.',
    ],
  },
  required_env: {
    base: baseLiveSendEnv,
    missing_now: missingBaseEnv,
    sample_2944_extra: 'CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944',
  },
  current_safe_evidence: {
    audit: auditPath,
    live_preflight: {
      path: livePreflightPath,
      ready: livePreflight?.ok_to_run_live_harness === true,
      no_send_performed: livePreflight?.no_send_performed === true,
      missing: livePreflight?.validation?.missing || [],
    },
    sample_preflight: {
      path: samplePreflightPath,
      ready: samplePreflight?.ok_to_run_live_harness === true,
      no_send_performed: samplePreflight?.no_send_performed === true,
      phone_last4: samplePreflight?.validation?.phone_last4 || null,
      phone_redacted: samplePreflight?.validation?.phone_redacted || null,
      message_length: samplePreflight?.validation?.message_length ?? null,
      message_sha256: samplePreflight?.validation?.message_sha256 || null,
      sample_2944_override_present: samplePreflight?.validation?.sample_2944_override_present === true,
    },
    live_send_rehearsal: {
      path: rehearsalPath,
      ok: rehearsal?.ok === true,
      source: rehearsal?.source || null,
      no_live_send_performed: rehearsal?.no_live_send_performed === true,
      dry_run_only: rehearsal?.dry_run_only === true,
      preflight_ready: rehearsal?.preflight_ready === true,
      destination: rehearsal?.redacted_plan?.destination || null,
      message_length: rehearsal?.redacted_plan?.message_length ?? null,
      message_sha256: rehearsal?.redacted_plan?.message_sha256 || null,
      immediate_adapter: rehearsal?.dry_run?.immediate_adapter === true,
      message_sha256_match: rehearsal?.dry_run?.message_sha256_match === true,
      destination_last4_match: rehearsal?.dry_run?.destination_last4_match === true,
      cleanup_ok: rehearsal?.cleanup?.ok === true,
      no_raw_phone_written: rehearsal?.no_raw_phone_written === true,
      no_raw_body_written: rehearsal?.no_raw_body_written === true,
    },
    local_browser: {
      path: localBrowserPath,
      ok: localBrowser?.ok === true,
      active_route: localBrowser?.chrome?.active_route || null,
      scheduled_pending: localBrowser?.scheduled?.counts?.pending ?? null,
      scheduled_approved: localBrowser?.scheduled?.counts?.approved ?? null,
      forbidden_fixture_present: localBrowser?.scheduled?.counts?.forbidden_fixture_present ?? null,
      analytics_matches: localBrowser?.analytics?.summary?.matches ?? null,
      analytics_conversations: localBrowser?.analytics?.summary?.conversations ?? null,
    },
  },
  operator_sequence: [
    'Get Julian current explicit approval in this thread.',
    'Record exact destination phone, exact message body, and expected last4.',
    'Set CLAPCHEEKS_LIVE_SEND_PERMISSION, CLAPCHEEKS_LIVE_SEND_PHONE, CLAPCHEEKS_LIVE_SEND_BODY, and CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4 in the shell only.',
    'If destination last4 is 2944, also set CLAPCHEEKS_LIVE_SEND_ALLOW_SAMPLE_2944 exactly to the documented override phrase.',
    'Run npm run test:e2e:live:rehearsal to prove the scheduled-send path in dry-run mode if the safe evidence is not fresh.',
    'Run npm run test:e2e:live:preflight and review the redacted phone, body length, and SHA-256.',
    'Run npm run test:e2e:live only if the preflight is ready and the redacted plan matches Julian approval.',
    'Run npm run test:e2e:audit and npm exec -- node --test __tests__/*.test.mjs before marking completion.',
  ],
  command_reference: {
    runbook: 'docs/e2e-live-send-runbook.md',
    preflight: 'npm run test:e2e:live:preflight',
    rehearsal: 'npm run test:e2e:live:rehearsal',
    live_harness: 'npm run test:e2e:live',
    completion_audit: 'npm run test:e2e:audit',
  },
}

writeFileSync(outputPath, JSON.stringify(packet, null, 2))
const markdown = [
  '# ClapCheeks Live-Send Approval Packet',
  '',
  `Generated: ${packet.generated_at}`,
  `Status: ${packet.ok ? 'READY_FOR_APPROVAL' : 'NOT_READY'}`,
  `Safe non-live gates proved: ${packet.current_status.safe_non_live_gates_proved}`,
  `Proved requirements: ${packet.current_status.proved_requirements}`,
  `Unproved requirements: ${packet.current_status.unproved_requirements}`,
  `Live gate: ${packet.current_status.live_gate_status || 'n/a'}`,
  '',
  '## Current Approval Needed',
  '',
  ...packet.approval_request_template.required_response_lines.map((line) => `- ${line}`),
  '',
  '## Safe Evidence',
  '',
  `- Sample preflight: ready=${packet.current_safe_evidence.sample_preflight.ready} last4=${packet.current_safe_evidence.sample_preflight.phone_last4 || 'n/a'} no_send=${packet.current_safe_evidence.sample_preflight.no_send_performed}`,
  `- Live-send rehearsal: ok=${packet.current_safe_evidence.live_send_rehearsal.ok} no_send=${packet.current_safe_evidence.live_send_rehearsal.no_live_send_performed} immediate=${packet.current_safe_evidence.live_send_rehearsal.immediate_adapter} hash=${packet.current_safe_evidence.live_send_rehearsal.message_sha256_match} last4=${packet.current_safe_evidence.live_send_rehearsal.destination_last4_match} cleanup=${packet.current_safe_evidence.live_send_rehearsal.cleanup_ok}`,
  `- Local Chrome proof: ok=${packet.current_safe_evidence.local_browser.ok} route=${packet.current_safe_evidence.local_browser.active_route || 'n/a'} pending=${packet.current_safe_evidence.local_browser.scheduled_pending ?? 'n/a'} approved=${packet.current_safe_evidence.local_browser.scheduled_approved ?? 'n/a'}`,
  '',
  '## Operator Must Verify',
  '',
  ...packet.approval_request_template.operator_must_verify.map((line) => `- ${line}`),
  '',
  '## Commands',
  '',
  `- Preflight: \`${packet.command_reference.preflight}\``,
  `- Rehearsal: \`${packet.command_reference.rehearsal}\``,
  `- Live harness: \`${packet.command_reference.live_harness}\``,
  `- Completion audit: \`${packet.command_reference.completion_audit}\``,
  '',
  'Raw destination phone and raw message body are not written in this packet.',
  '',
].join('\n')
writeFileSync(markdownOutputPath, markdown)

console.log(`Live-send approval packet: ${packet.ok ? 'READY_FOR_APPROVAL' : 'NOT_READY'}`)
console.log(`Evidence: ${outputPath}`)
console.log(`Markdown: ${markdownOutputPath}`)
console.log(`Safe non-live gates: ${packet.current_status.safe_non_live_gates_proved ? 'proved' : 'not fully proved'}`)
console.log(`Proved requirements: ${packet.current_status.proved_requirements}`)
console.log(`Unproved requirements: ${packet.current_status.unproved_requirements}`)
console.log(`Live gate: ${packet.current_status.live_gate_status || 'n/a'}`)
console.log(`Missing base env: ${packet.required_env.missing_now.join(', ') || 'none'}`)
console.log(`Sample 757 preflight: ready=${packet.current_safe_evidence.sample_preflight.ready} last4=${packet.current_safe_evidence.sample_preflight.phone_last4 || 'n/a'} no_send=${packet.current_safe_evidence.sample_preflight.no_send_performed}`)
console.log(`Live-send rehearsal: ok=${packet.current_safe_evidence.live_send_rehearsal.ok} no_send=${packet.current_safe_evidence.live_send_rehearsal.no_live_send_performed} immediate=${packet.current_safe_evidence.live_send_rehearsal.immediate_adapter} hash=${packet.current_safe_evidence.live_send_rehearsal.message_sha256_match} last4=${packet.current_safe_evidence.live_send_rehearsal.destination_last4_match} cleanup=${packet.current_safe_evidence.live_send_rehearsal.cleanup_ok}`)
console.log(`Local Chrome proof: ok=${packet.current_safe_evidence.local_browser.ok} route=${packet.current_safe_evidence.local_browser.active_route || 'n/a'} pending=${packet.current_safe_evidence.local_browser.scheduled_pending ?? 'n/a'} approved=${packet.current_safe_evidence.local_browser.scheduled_approved ?? 'n/a'}`)
console.log(`Approval template: required_lines=${packet.approval_request_template.required_response_lines.length} raw_values_written=${packet.approval_request_template.raw_values_written}`)
console.log('Raw phone/body written: false')

if (!packet.ok) process.exit(1)
