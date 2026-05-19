import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2))
}

async function makeEvidenceDir() {
  const dir = await mkdtemp(join(tmpdir(), 'clapcheeks-live-audit-'))
  const screenshots = [
    join(dir, 'dashboard-desktop-2026-05-18.png'),
    join(dir, 'dashboard-mobile-2026-05-18.png'),
    join(dir, 'device-mobile-2026-05-18.png'),
    join(dir, 'scheduled-mobile-2026-05-18.png'),
    join(dir, 'scheduled-mobile-modal-2026-05-18.png'),
    join(dir, 'scheduled-send-confirmation-modal-2026-05-18.png'),
    join(dir, 'intelligence-desktop-2026-05-18.png'),
    join(dir, 'intelligence-mobile-2026-05-18.png'),
    join(dir, 'analytics-mobile-2026-05-18.png'),
  ]
  await Promise.all(screenshots.map((path) => writeFile(path, 'png-proof')))
  return { dir, screenshots }
}

function safeEvidence() {
  const okCheck = (name, detail = {}) => ({ name, ok: true, detail })
  return {
    ok: true,
    sample_last4: '2944',
    no_live_send_performed: true,
    checks: [
      okCheck('dashboard core route matrix', { routes: [], summary: '16 routes ok with content assertions' }),
      okCheck('analytics summary contract', { totals: { matches: 22, conversations: 200 } }),
      okCheck('dashboard runtime health contract', { overall: 'healthy', convex_status: 'healthy' }),
      okCheck('scheduled create'),
      okCheck('scheduled approve'),
      okCheck('scheduled live blocked without phrase'),
      okCheck('scheduled live blocked by preflight gate', {
        response: {
          live_send_gate: {
            no_send_performed: true,
            missing: ['CLAPCHEEKS_LIVE_SEND_PERMISSION'],
          },
        },
      }),
      okCheck('scheduled dry-run', {
        provenance_ok: true,
        response: {
          send_provenance: {
            request_id: 'synthetic-scheduled-dry-run',
            source_label: 'clapcheeks_scheduled_messages_send_api',
            route: 'POST /api/scheduled-messages/send',
            adapter: 'god draft',
            phone_last4: '2944',
            message_length: 45,
            message_sha256: '1'.repeat(64),
          },
          would_send: {
            phone_last4: '2944',
            adapter: 'god draft',
          },
        },
      }),
      okCheck('scheduled cleanup cancel'),
      okCheck('scheduled fixture cleanup'),
      okCheck('imessage metadata'),
      okCheck('imessage dry-run'),
      okCheck('imessage live blocked without phrase'),
      okCheck('imessage live blocked by preflight gate', {
        response: {
          live_send_gate: {
            no_send_performed: true,
          },
          issues: ['live-send environment gate is not ready'],
        },
      }),
      okCheck('messages db read-only sample lookup', {
        checked: true,
        sample_last4: '2944',
        sample_handle_rows: 28,
        sample_outbound_rows: 14,
        total_rows: 1288753,
        content_logged: false,
      }),
    ],
  }
}

function browserEvidence(screenshots) {
  return {
    ok: true,
    no_live_send_performed: true,
    checks: {
      dashboard_desktop: true,
      dashboard_navigation_integrity: true,
      dashboard_navigation: {
        ok: true,
        quick_actions_heading_present: true,
        missing_actions: [],
        missing_top_nav: [],
        route_checks: [
          { href: '/dashboard/roster', status: 200, ok: true },
          { href: '/conversation?goal=ask_date', status: 200, ok: true },
          { href: '/scheduled', status: 200, ok: true },
          { href: '/matches/add', status: 200, ok: true },
          { href: '/intelligence', status: 200, ok: true },
          { href: '/device', status: 200, ok: true },
        ],
        failed_routes: [],
        no_click_performed: true,
        no_live_send_performed: true,
      },
      dashboard_health_blockers_quick_view: true,
      dashboard_health_blockers: {
        ok: true,
        token_tile_present: true,
        expected_blockers: ['tinder', 'hinge', 'sendbird'],
        missing_labels: [],
        no_token_values_present: true,
        no_live_send_performed: true,
      },
      dashboard_imessage_self_test_surface: true,
      dashboard_imessage_self_test: {
        ok: true,
        api_status: 200,
        self_test_recipient_configured: true,
        self_test_recipient_last4: '2944',
        self_test_button_matches_metadata: true,
        dry_run_default: true,
        verify_button_present: true,
        live_warning_present: true,
        live_send_gate_present: true,
        live_send_gate_ready: false,
        live_send_gate_missing: [
          'CLAPCHEEKS_LIVE_SEND_PERMISSION',
          'CLAPCHEEKS_LIVE_SEND_PHONE',
          'CLAPCHEEKS_LIVE_SEND_BODY',
          'CLAPCHEEKS_LIVE_SEND_EXPECTED_LAST4',
        ],
        live_send_gate_sample_override_required: false,
        live_send_gate_no_send: true,
        no_click_performed: true,
        no_live_send_performed: true,
      },
      dashboard_imessage_dry_run_click: true,
      dashboard_imessage_dry_run: {
        ok: true,
        api_status: 200,
        success_message_present: true,
        before_message_count: 0,
        after_message_count: 0,
        no_queue_delta: true,
        self_test_recipient_last4: '2944',
        before_snapshot_recorded: true,
        dry_run_click_performed: true,
        no_live_send_performed: true,
      },
      dashboard_mobile_quick_view: true,
      device_mobile_quick_view: true,
      device_control_safety_surface: true,
      device_control_status: {
        ok: true,
        api_status: 200,
        selected_line: 2,
        current_blocker: 'physical_readiness_not_verified',
        selected_device: 'secondary iPhone',
        observed_connection: 'not_verified',
        latest_known_blockers: ['physical_readiness_not_verified'],
        safety: {
          personal_line_blocked: true,
          live_swipes_require_approval: true,
          live_messages_require_approval: true,
          outbound_send_requires_second_confirmation: true,
          approval_failures_fail_closed: true,
        },
        queue_buttons_present: {
          observe: true,
          proof: true,
          proof_all: true,
        },
        no_queue_click_performed: true,
        no_live_action_performed: true,
        no_live_send_performed: true,
        overflow_x: false,
      },
      scheduled_mobile_quick_view: true,
      scheduled_ui_matches_api: true,
      scheduled_api_binding: {
        ok: true,
        api_status: 200,
        source: '/api/scheduled-messages?status=all&limit=100',
        expected_counts: {
          pending: 1,
          approved: 1,
          sent: 4,
          failed: 2,
        },
        rendered_counts: {
          pending: 1,
          approved: 1,
          sent: 4,
          failed: 2,
        },
        counts_match: true,
        total_messages: 8,
        pending_rows_checked: 1,
        pending_rows_visible: true,
        empty_pending_state_ok: false,
        pending_badge_ok: true,
        missing_filters: [],
        overflow_x: false,
        no_submit_performed: true,
        no_live_send_performed: true,
      },
      scheduled_mobile_modal: true,
      scheduled_mobile_form_filled: true,
      scheduled_mobile_form_no_submit: true,
      scheduled_mobile_form: {
        ok: true,
        no_submit_performed: true,
        no_live_send_performed: true,
        sample_last4: '2944',
        phone_last4: '2944',
        message_length: 44,
        scheduled_at_filled: true,
        submit_button_present: true,
        overflow_x: false,
      },
      scheduled_send_confirmation_guardrail: true,
      scheduled_send_confirmation: {
        fixture: {
          ok: true,
          id: 'synthetic-browser-guardrail',
          fixture_name: 'Safe E2E Browser Guardrail 2944',
          sample_last4: '2944',
          no_live_send_performed: true,
        },
        before: {
          ok: true,
          modal_present: true,
          review_checkbox_present: true,
          phrase_hidden_before_review: true,
          send_disabled_before_review: true,
          no_live_send_performed: true,
        },
        guardrail: {
          ok: true,
          phrase_input_present_after_review: true,
          wrong_phrase_value: 'SEND SAFE',
          send_disabled_with_wrong_phrase: true,
          exact_live_phrase_not_entered: true,
          send_button_clicked: false,
          no_live_send_performed: true,
        },
        cleanup: {
          ok: true,
          final_status: 'failed',
          rejection_reason: 'deleted_from_dashboard',
          no_live_send_performed: true,
        },
      },
      intelligence_desktop: true,
      intelligence_ui_matches_api: true,
      intelligence_api_binding: {
        ok: true,
        source: '/api/analytics/summary?days=30',
        missing_values: [],
        missing_labels: [],
        expected: {
          reply_rate_percent: 11,
          opened: 1800,
          replied: 200,
          date_ready: 60,
          booked: 4,
          matches: 22,
          conversations: 200,
          messages_sent: 1800,
          dates_booked: 4,
        },
        no_live_send_performed: true,
      },
      intelligence_mobile_quick_view: true,
      analytics_mobile_quick_view: true,
      analytics_mobile_ui_matches_api: true,
      analytics_mobile_api_binding: {
        ok: true,
        source: '/api/analytics/summary?days=30',
        api_status: 200,
        missing_labels: [],
        missing_values: [],
        expected: {
          swipes_right: 0,
          matches: 22,
          dates_booked: 0,
          conversations: 200,
          match_rate_display: '0%',
          rizz_score: 40,
          platform_count: 3,
          time_series_rows: 5,
          funnel_stages: ['Swipes', 'Matches', 'Conversations', 'Dates'],
        },
        overflow_x: false,
        no_live_send_performed: true,
      },
      mobile_metrics_overflow_free: true,
      mobile_metrics: {
        dashboard_mobile: { overflow_x: false },
        device_mobile: { overflow_x: false },
        scheduled_mobile: { overflow_x: false },
        scheduled_mobile_modal: { overflow_x: false },
        scheduled_send_confirmation_modal: { overflow_x: false },
        intelligence_mobile: { overflow_x: false },
        analytics_mobile: { overflow_x: false },
      },
      analytics_summary: {
        matches: 22,
        conversations: 200,
      },
      imessage_self_test_recipient: {
        last4: '2944',
      },
    },
    screenshots,
  }
}

function runtimeSmokeEvidence() {
  return {
    ok: true,
    no_send: true,
    outbound_insert_skipped: true,
    drainer_skipped: true,
    inbound_message_rows: 1288753,
  }
}

function backendDoctorEvidence() {
  const okCheck = (name, detail = {}) => ({ name, ok: true, detail })
  return {
    ok: true,
    no_live_send_performed: true,
    no_dashboard_mutation_performed: true,
    checked_scope: ['dashboard', 'api'],
    checks: [
      okCheck('no runtime Supabase imports in dashboard path'),
      okCheck('Convex facade mapping coverage'),
      okCheck('backend API route matrix'),
    ],
  }
}

function localBrowserEvidence() {
  return {
    ok: true,
    no_live_send_performed: true,
    no_dashboard_mutation_performed: true,
    chrome: {
      active_url_matches_local_app: true,
      active_route: '/analytics',
    },
    scheduled: {
      counts: {
        pending: 0,
        approved: 0,
        forbidden_fixture_present: false,
      },
    },
    analytics: {
      summary: {
        matches: 22,
        conversations: 200,
      },
    },
    assertions: {
      read_only: true,
    },
  }
}

function livePreflightEvidence(hash) {
  return {
    ok_to_run_live_harness: true,
    no_send_performed: true,
    no_dashboard_mutation_performed: true,
    validation: {
      missing: [],
      issues: [],
      phone_last4: '0123',
      phone_redacted: '*******0123',
      message_length: 42,
      message_sha256: hash,
    },
    current_readiness: {
      safe_non_live_gates_proved: true,
    },
  }
}

function sampleLivePreflightEvidence() {
  return {
    ok_to_run_live_harness: true,
    no_send_performed: true,
    no_dashboard_mutation_performed: true,
    validation: {
      missing: [],
      issues: [],
      phone_last4: '2944',
      phone_redacted: '*******2944',
      message_length: 63,
      message_sha256: '2'.repeat(64),
      sample_2944_override_required: true,
      sample_2944_override_present: true,
    },
    current_readiness: {
      safe_non_live_gates_proved: true,
    },
  }
}

function liveSendRehearsalEvidence() {
  return {
    ok: true,
    source: 'sample_757',
    no_live_send_performed: true,
    dry_run_only: true,
    preflight_ready: true,
    no_raw_phone_written: true,
    no_raw_body_written: true,
    redacted_plan: {
      destination: '*******2944',
      expected_last4: '2944',
      message_length: 63,
      message_sha256: '2'.repeat(64),
    },
    dry_run: {
      ok: true,
      source_label: 'clapcheeks_scheduled_messages_send_api',
      adapter: 'osascript Messages.send',
      immediate_adapter: true,
      message_sha256_match: true,
      destination_last4_match: true,
      message_length_match: true,
      approved_row: true,
      send_confirmation_present: true,
    },
    cleanup: {
      ok: true,
      final_status: 'failed',
    },
  }
}

function approvalPacketEvidence() {
  return {
    ok: true,
    no_send_performed: true,
    no_dashboard_mutation_performed: true,
    raw_phone_written: false,
    raw_body_written: false,
    current_safe_evidence: {
      live_send_rehearsal: {
        ok: true,
        no_live_send_performed: true,
        immediate_adapter: true,
        message_sha256_match: true,
        destination_last4_match: true,
        cleanup_ok: true,
      },
    },
    approval_request_template: {
      raw_values_written: false,
      required_response_lines: [
        'Permission phrase: SEND LIVE TO JULIAN',
        'Destination phone: <exact E.164 phone number to send to>',
        'Expected last4: <last four digits of the destination>',
        'Message body: <exact text to send>',
        'Sample 2944 override: I CONFIRM 757-831-2944 IS THE LIVE DESTINATION <only if the destination ends in 2944>',
      ],
    },
    required_env: {
      missing_now: [],
    },
  }
}

function liveEvidence(hash) {
  return {
    ok: true,
    live_send_performed: true,
    messages_db_verified: true,
    phone_last4: '0123',
    message_length: 42,
    message_sha256: hash,
    send_provenance_verified: true,
    send_provenance: {
      request_id: 'synthetic-request-id',
      source_label: 'clapcheeks_scheduled_messages_send_api',
      route: 'POST /api/scheduled-messages/send',
      phone_last4: '0123',
      message_length: 42,
      message_sha256: hash,
    },
  }
}

async function runCompletionAudit({ preflightHash, liveHash, stalePathKey = null, expectFailure = false } = {}) {
  const { dir, screenshots } = await makeEvidenceDir()
  const paths = {
    safe: join(dir, 'safe.json'),
    browser: join(dir, 'browser.json'),
    backend: join(dir, 'backend.json'),
    runtime: join(dir, 'runtime.json'),
    localBrowser: join(dir, 'local-browser.json'),
    live: join(dir, 'live.json'),
    preflight: join(dir, 'preflight.json'),
    samplePreflight: join(dir, 'sample-preflight.json'),
    rehearsal: join(dir, 'rehearsal.json'),
    approval: join(dir, 'approval-packet.json'),
    approvalMd: join(dir, 'approval-packet.md'),
    audit: join(dir, 'audit.json'),
  }

  await writeJson(paths.safe, safeEvidence())
  await writeJson(paths.browser, browserEvidence(screenshots))
  await writeJson(paths.backend, backendDoctorEvidence())
  await writeJson(paths.runtime, runtimeSmokeEvidence())
  await writeJson(paths.localBrowser, localBrowserEvidence())
  await writeJson(paths.preflight, livePreflightEvidence(preflightHash))
  await writeJson(paths.samplePreflight, sampleLivePreflightEvidence())
  await writeJson(paths.rehearsal, liveSendRehearsalEvidence())
  await writeJson(paths.approval, approvalPacketEvidence())
  await writeFile(paths.approvalMd, '# ClapCheeks Live-Send Approval Packet\n\nRaw destination phone and raw message body are not written.\n\nSample 2944 override: I CONFIRM 757-831-2944 IS THE LIVE DESTINATION <only if the destination ends in 2944>\n')
  await writeJson(paths.live, liveEvidence(liveHash))
  if (stalePathKey) {
    const staleDate = new Date(Date.now() - 120_000)
    await utimes(paths[stalePathKey], staleDate, staleDate)
  }

  const env = {
      ...process.env,
      CLAPCHEEKS_EVIDENCE_MAX_AGE_SECONDS: '60',
      CLAPCHEEKS_E2E_EVIDENCE: paths.safe,
      CLAPCHEEKS_BROWSER_EVIDENCE: paths.browser,
      CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE: paths.backend,
      CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE: paths.runtime,
      CLAPCHEEKS_LOCAL_BROWSER_PROOF: paths.localBrowser,
      CLAPCHEEKS_LIVE_SEND_EVIDENCE: paths.live,
      CLAPCHEEKS_LIVE_SEND_PREFLIGHT: paths.preflight,
      CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT: paths.samplePreflight,
      CLAPCHEEKS_LIVE_SEND_REHEARSAL: paths.rehearsal,
      CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET: paths.approval,
      CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET_MD: paths.approvalMd,
      CLAPCHEEKS_COMPLETION_AUDIT: paths.audit,
  }
  try {
    await execFileAsync(process.execPath, ['scripts/e2e-completion-audit.mjs'], { env })
  } catch (error) {
    if (!expectFailure) throw error
  }

  return {
    audit: JSON.parse(await readFile(paths.audit, 'utf8')),
    paths,
  }
}

async function runAudit({ preflightHash, liveHash }) {
  const result = await runCompletionAudit({ preflightHash, liveHash })
  return result.audit
}

async function runEvidenceIndex({ preflightHash, liveHash }) {
  const { paths } = await runCompletionAudit({ preflightHash, liveHash })
  paths.index = join(paths.audit.replace(/audit\.json$/, ''), 'index.json')

  await execFileAsync(process.execPath, ['scripts/e2e-evidence-index.mjs'], {
    env: {
      ...process.env,
      CLAPCHEEKS_E2E_EVIDENCE: paths.safe,
      CLAPCHEEKS_BROWSER_EVIDENCE: paths.browser,
      CLAPCHEEKS_BACKEND_DOCTOR_EVIDENCE: paths.backend,
      CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE: paths.runtime,
      CLAPCHEEKS_LOCAL_BROWSER_PROOF: paths.localBrowser,
      CLAPCHEEKS_LIVE_SEND_EVIDENCE: paths.live,
      CLAPCHEEKS_LIVE_SEND_PREFLIGHT: paths.preflight,
      CLAPCHEEKS_LIVE_SEND_SAMPLE_PREFLIGHT: paths.samplePreflight,
      CLAPCHEEKS_LIVE_SEND_REHEARSAL: paths.rehearsal,
      CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET: paths.approval,
      CLAPCHEEKS_LIVE_SEND_APPROVAL_PACKET_MD: paths.approvalMd,
      CLAPCHEEKS_COMPLETION_AUDIT: paths.audit,
      CLAPCHEEKS_EVIDENCE_INDEX: paths.index,
    },
  })

  return JSON.parse(await readFile(paths.index, 'utf8'))
}

test('completion audit refuses live evidence when preflight body fingerprint differs', async () => {
  const audit = await runAudit({
    preflightHash: 'a'.repeat(64),
    liveHash: 'b'.repeat(64),
  })
  const liveGate = audit.requirements.find((item) => item.name === 'real outbound send-to-Julian test')

  assert.equal(audit.complete, false)
  assert.equal(liveGate.status, 'unproved_requires_explicit_live_permission')
  assert.equal(liveGate.detail.body_hash_match, false)
  assert.equal(liveGate.detail.body_length_match, true)
  assert.equal(liveGate.detail.destination_last4_match, true)
  assert.equal(liveGate.detail.live_evidence_matches_preflight, false)
})

test('completion audit can complete only when live evidence matches preflight fingerprint', async () => {
  const hash = 'c'.repeat(64)
  const audit = await runAudit({
    preflightHash: hash,
    liveHash: hash,
  })
  const liveGate = audit.requirements.find((item) => item.name === 'real outbound send-to-Julian test')

  assert.equal(audit.complete, true)
  assert.equal(liveGate.status, 'proved')
  assert.equal(liveGate.detail.body_hash_match, true)
  assert.equal(liveGate.detail.body_length_match, true)
  assert.equal(liveGate.detail.destination_last4_match, true)
  assert.equal(liveGate.detail.live_evidence_matches_preflight, true)
  assert.equal(liveGate.detail.send_provenance_verified, true)
})

test('completion audit refuses stale required evidence artifacts', async () => {
  const hash = '9'.repeat(64)
  const { audit } = await runCompletionAudit({
    preflightHash: hash,
    liveHash: hash,
    stalePathKey: 'browser',
    expectFailure: true,
  })
  const freshnessGate = audit.requirements.find((item) => item.name === 'required E2E evidence artifacts are fresh')

  assert.equal(audit.complete, false)
  assert.equal(audit.safe_to_continue_without_live_send, false)
  assert.equal(freshnessGate.status, 'missing_or_unproved')
  assert.equal(freshnessGate.detail.stale_artifacts[0].key, 'browser')
})

test('evidence index exposes live/preflight fingerprint mismatches', async () => {
  const index = await runEvidenceIndex({
    preflightHash: 'd'.repeat(64),
    liveHash: 'e'.repeat(64),
  })

  assert.equal(index.complete, false)
  assert.equal(index.summary.live_evidence_matches_preflight, false)
  assert.equal(index.summary.live_body_hash_match, false)
  assert.equal(index.summary.live_body_length_match, true)
  assert.equal(index.summary.live_destination_last4_match, true)
  assert.equal(index.summary.sample_live_preflight_ready, true)
  assert.equal(index.summary.sample_live_preflight_no_send, true)
  assert.equal(index.summary.sample_live_preflight_last4, '2944')
  assert.equal(index.summary.sample_live_preflight_override_present, true)
  assert.equal(index.summary.sample_live_preflight_raw_phone_absent, true)
  assert.equal(index.summary.sample_live_preflight_raw_body_absent, true)
  assert.equal(index.summary.approval_packet_markdown_raw_e164_absent, true)
  assert.equal(index.summary.approval_packet_markdown_raw_body_absent, true)
  assert.equal(index.summary.approval_packet_markdown_sample_override_present, true)
  assert.equal(index.summary.mobile_metrics_overflow_free, true)
  assert.equal(index.summary.mobile_metric_count, 7)
  assert.equal(index.summary.scheduled_ui_matches_api, true)
  assert.equal(index.summary.scheduled_api_counts_match, true)
  assert.equal(index.summary.scheduled_api_total_messages, 8)
  assert.equal(index.summary.dashboard_navigation_integrity, true)
  assert.equal(index.summary.dashboard_health_blockers_quick_view, true)
  assert.deepEqual(index.summary.dashboard_health_blockers_expected, ['tinder', 'hinge', 'sendbird'])
  assert.equal(index.summary.dashboard_imessage_self_test_surface, true)
  assert.equal(index.summary.dashboard_live_send_gate_ready, false)
  assert.equal(index.summary.dashboard_live_send_gate_missing.length, 4)
  assert.equal(index.summary.dashboard_imessage_dry_run_click, true)
  assert.equal(index.summary.dashboard_imessage_dry_run_no_queue_delta, true)
  assert.equal(index.summary.scheduled_ui_matches_api, true)
  assert.equal(index.summary.device_mobile_quick_view, true)
  assert.equal(index.summary.device_control_safety_surface, true)
  assert.equal(index.summary.device_control_selected_line, 2)
  assert.equal(index.summary.device_control_current_blocker, 'physical_readiness_not_verified')
  assert.equal(index.summary.scheduled_mobile_form_filled, true)
  assert.equal(index.summary.scheduled_mobile_form_no_submit, true)
  assert.equal(index.summary.scheduled_send_confirmation_guardrail, true)
  assert.equal(index.summary.scheduled_send_confirmation_cleanup, true)
  assert.equal(index.summary.intelligence_ui_matches_api, true)
  assert.equal(index.summary.analytics_mobile_ui_matches_api, true)
  assert.equal(index.summary.analytics_mobile_quick_view, true)
  assert.equal(index.evidence_highlights.live_preflight.body_hash_matches_live, false)
  assert.equal(index.evidence_highlights.live_preflight.body_length_matches_live, true)
  assert.equal(index.evidence_highlights.live_preflight.destination_last4_matches_live, true)
  assert.equal(index.evidence_highlights.live_send.message_sha256, 'e'.repeat(64))
  assert.equal(index.evidence_highlights.live_send.send_provenance_verified, true)
  assert.equal(index.evidence_highlights.approval_packet.markdown_raw_e164_absent, true)
  assert.equal(index.evidence_highlights.approval_packet.markdown_raw_body_absent, true)
  assert.equal(index.evidence_highlights.approval_packet.markdown_sample_override_phrase_present, true)
})

test('evidence index marks completion only when live evidence matches preflight fingerprint', async () => {
  const hash = 'f'.repeat(64)
  const index = await runEvidenceIndex({
    preflightHash: hash,
    liveHash: hash,
  })

  assert.equal(index.complete, true)
  assert.equal(index.summary.live_evidence_matches_preflight, true)
  assert.equal(index.summary.live_body_hash_match, true)
  assert.equal(index.summary.live_body_length_match, true)
  assert.equal(index.summary.live_destination_last4_match, true)
  assert.equal(index.summary.sample_live_preflight_ready, true)
  assert.equal(index.summary.sample_live_preflight_no_send, true)
  assert.equal(index.summary.sample_live_preflight_last4, '2944')
  assert.equal(index.summary.sample_live_preflight_override_present, true)
  assert.equal(index.summary.sample_live_preflight_raw_phone_absent, true)
  assert.equal(index.summary.sample_live_preflight_raw_body_absent, true)
  assert.equal(index.summary.approval_packet_markdown_raw_e164_absent, true)
  assert.equal(index.summary.approval_packet_markdown_raw_body_absent, true)
  assert.equal(index.summary.approval_packet_markdown_sample_override_present, true)
  assert.equal(index.summary.dashboard_navigation_integrity, true)
  assert.equal(index.summary.dashboard_health_blockers_quick_view, true)
  assert.deepEqual(index.summary.dashboard_health_blockers_expected, ['tinder', 'hinge', 'sendbird'])
  assert.equal(index.summary.dashboard_imessage_self_test_surface, true)
  assert.equal(index.summary.dashboard_live_send_gate_ready, false)
  assert.equal(index.summary.dashboard_live_send_gate_missing.length, 4)
  assert.equal(index.summary.dashboard_imessage_dry_run_click, true)
  assert.equal(index.summary.dashboard_imessage_dry_run_no_queue_delta, true)
  assert.equal(index.summary.device_mobile_quick_view, true)
  assert.equal(index.summary.device_control_safety_surface, true)
  assert.equal(index.summary.scheduled_mobile_form_filled, true)
  assert.equal(index.summary.scheduled_mobile_form_no_submit, true)
  assert.equal(index.summary.scheduled_send_confirmation_guardrail, true)
  assert.equal(index.summary.scheduled_send_confirmation_cleanup, true)
  assert.equal(index.summary.intelligence_ui_matches_api, true)
  assert.equal(index.summary.analytics_mobile_ui_matches_api, true)
  assert.equal(index.summary.analytics_mobile_quick_view, true)
  assert.equal(index.evidence_highlights.live_preflight.live_evidence_matches_preflight, true)
  assert.equal(index.evidence_highlights.live_preflight.message_sha256, hash)
  assert.equal(index.evidence_highlights.live_send.message_sha256, hash)
  assert.equal(index.summary.live_send_provenance_verified, true)
  assert.equal(index.evidence_highlights.approval_packet.markdown_raw_e164_absent, true)
  assert.equal(index.evidence_highlights.approval_packet.markdown_raw_body_absent, true)
  assert.equal(index.evidence_highlights.approval_packet.markdown_sample_override_phrase_present, true)
})
