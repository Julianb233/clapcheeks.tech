import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@/lib/convex/server'
import { getTokenHealth } from '@/lib/clapcheeks/token-health'
import { getRuntimeHealth } from '@/lib/clapcheeks/runtime-health'

const ADAPTERS = [
  {
    adapter: 'observe-only',
    mode: 'safe-placeholder',
    live_actions: false,
    note: 'Default audit-only adapter; never touches a device.',
  },
  {
    adapter: 'macos-screen',
    mode: 'visible-surface-observe',
    live_actions: false,
    note: 'Captures Simulator or iPhone Mirroring evidence when macOS allows screenshot capture.',
  },
  {
    adapter: 'physical-ios',
    mode: 'physical-iphone-observe',
    live_actions: false,
    note: 'Uses libimobiledevice/idevicescreenshot for the secondary iPhone; currently blocked until Developer Mode is enabled on-device.',
  },
]

const SECONDARY_LINES = [
  {
    line: 2,
    phone: '+16199919355',
    label: 'Lexi silver iPhone',
    status: 'preferred_after_repair',
    note: 'Best default for dating-device control once the Apple ID misconfiguration is repaired.',
  },
  {
    line: 3,
    phone: '+16199919381',
    label: 'DEI orange iPhone 17 Pro Max',
    status: 'configured_but_not_preferred',
    note: 'Technically active, but should stay reserved for DEI/compliance work unless explicitly approved.',
  },
  {
    line: 4,
    phone: '+12679188060',
    label: 'TBD secondary line',
    status: 'candidate_unconfirmed',
    note: 'Needs Apple ID and hardware confirmation before use.',
  },
  {
    line: 5,
    phone: '+12156003637',
    label: 'TBD secondary line',
    status: 'candidate_unconfirmed',
    note: 'Needs Apple ID and hardware confirmation before use.',
  },
]

const COMPLETION_AUDIT = {
  decision_rule: 'strict doctor, wait-proof, and one physical PNG proof must pass before completion',
  command: 'cd ~/clapcheeks-local && scripts/run-device-control-completion-audit.sh 2 hinge',
  latest_result_path: '~/.clapcheeks-local/device-control/proof-runs/latest-completion-audit.json',
  success_criteria: [
    'Bound secondary iPhone/line is used; personal line 1 is rejected.',
    'Tinder, Hinge, and Bumble are covered by observe/proof routing.',
    'Physical secondary-iPhone screenshot proof is a real non-empty PNG.',
    'Dashboard queues observe/proof/action jobs through Convex and runtime drains them.',
    'Live tap/swipe/type/send actions require fresh approval, explicit live confirmation, physical PNG proof confirmation, and a valid PNG proof path.',
    'Outbound communications require a second send confirmation and redact message payloads in responses/logs.',
    'Local JSONL action logging and optional Convex telemetry audit sync are present.',
    'Obsidian source-of-truth writebacks are current.',
    'Readiness helpers, smoke tests, and completion audit fail closed until every gate is verified.',
  ],
  artifact_checklist: [
    {
      requirement: 'secondary_number_iphone',
      evidence: 'clapcheeks/device_control/targets.py line-2 binding, DeviceTarget line guard, physical-ios adapter',
    },
    {
      requirement: 'tinder_hinge_bumble',
      evidence: 'DeviceTarget platform validator, all-platform proof runner, /api/device-control/proof-all',
    },
    {
      requirement: 'swiping_controls',
      evidence: 'controller action model, Convex device_action handler, approval/safety smoke gates',
    },
    {
      requirement: 'communications',
      evidence: 'send action kind, outbound confirmation gate, payload redaction, audit-log smoke',
    },
    {
      requirement: 'approval_gates',
      evidence: 'DeviceControlController denial reasons, web action route freshness/proof/send checks, safety smoke',
    },
    {
      requirement: 'obsidian_source_of_truth',
      evidence: 'vault session report, daily note, Current Pulse writeback checks',
    },
    {
      requirement: 'convex_source_of_truth',
      evidence: 'dashboard enqueue routes, Convex runner handlers, controlled queue smoke',
    },
    {
      requirement: 'screenshots',
      evidence: 'macOS visible-surface capture, physical-ios proof command, wait-proof, strict doctor physical PNG gate',
    },
    {
      requirement: 'transport_diagnostics',
      evidence: 'run-device-control-transport-diagnostics.sh checks usbmux, ios-deploy, pairing records, USB system profile, and CoreDevice visibility for the bound UDID',
    },
    {
      requirement: 'action_logging',
      evidence: 'clapcheeks/device_control/audit.py, actions.jsonl, audit-log smoke, Convex telemetry mutation option',
    },
    {
      requirement: 'completion_decision',
      evidence: 'strict doctor + wait-proof + single physical PNG proof must pass; proxy green tests alone are insufficient',
    },
  ],
}

const FALLBACK_PHYSICAL_IOS_BLOCKERS = [
  'no_physical_ios_device_visible',
  'developer_mode_disabled_on_physical_iphone',
  'physical_ios_device_not_visible_to_xcode',
  'usbmux_no_bound_udid',
  'ios_deploy_no_bound_udid',
  'pairing_record_missing_for_bound_udid',
  'coredevice_no_bound_udid',
]

const PHYSICAL_IOS_LIVE_ACTION_ENV = 'CLAPCHEEKS_PHYSICAL_IOS_ENABLE_LIVE_ACTIONS'

function readPhysicalIOSLiveActionGate() {
  const enabled = process.env[PHYSICAL_IOS_LIVE_ACTION_ENV] === '1'
  return {
    physical_ios_live_actions_enabled: enabled,
    env_var: PHYSICAL_IOS_LIVE_ACTION_ENV,
    required_value: '1',
    default_state: 'disabled',
    action_surface: 'physical_ios_appium_xcuitest',
    current_state: enabled ? 'enabled' : 'disabled',
    note: 'Even when enabled, physical iOS live actions still require fresh approval, explicit live-action confirmation, physical PNG proof confirmation, a valid PNG proof path, and second confirmation for sends.',
  }
}

const LATEST_COMPLETION_AUDIT_PATH = `${homedir()}/.clapcheeks-local/device-control/proof-runs/latest-completion-audit.json`
const INBOUND_REPAIR_EVIDENCE_PATH = process.env.CLAPCHEEKS_INBOUND_REPAIR_EVIDENCE || '/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json'

function readLatestCompletionAudit() {
  try {
    if (!existsSync(LATEST_COMPLETION_AUDIT_PATH)) {
      return { status: 'missing', path: COMPLETION_AUDIT.latest_result_path }
    }
    const parsed = JSON.parse(readFileSync(LATEST_COMPLETION_AUDIT_PATH, 'utf8'))
    return {
      status: parsed.completion_audit === 'passed' ? 'passed' : 'failed',
      timestamp: parsed.timestamp || null,
      line: parsed.line || null,
      platform: parsed.platform || null,
      audit_log: parsed.audit_log || null,
      failed_checks: Array.isArray(parsed.failed_checks) ? parsed.failed_checks : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      next_unblock_steps: Array.isArray(parsed.next_unblock_steps) ? parsed.next_unblock_steps : [],
      readiness_command: parsed.readiness_command || COMPLETION_AUDIT.command,
      transport_diagnostics_command: parsed.transport_diagnostics_command || 'cd ~/clapcheeks-local && scripts/run-device-control-transport-diagnostics.sh 2',
      completion_audit_command: parsed.completion_audit_command || COMPLETION_AUDIT.command,
      physical_png_required: Boolean(parsed.physical_png_required),
      completion_rule: parsed.completion_rule || COMPLETION_AUDIT.decision_rule,
      path: COMPLETION_AUDIT.latest_result_path,
    }
  } catch (error) {
    return {
      status: 'unreadable',
      path: COMPLETION_AUDIT.latest_result_path,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

type LatestCompletionAudit = ReturnType<typeof readLatestCompletionAudit>

function latestPhysicalIOSBlockers(latestAudit: LatestCompletionAudit) {
  if (Array.isArray(latestAudit.blockers) && latestAudit.blockers.length > 0) {
    return latestAudit.blockers
  }
  return FALLBACK_PHYSICAL_IOS_BLOCKERS
}

function currentPhysicalIOSBlocker(latestAudit: LatestCompletionAudit, blockers: string[]) {
  if (latestAudit.status === 'passed') return 'none'
  return blockers[0] || 'physical_readiness_not_verified'
}

function readInboundRepairTcc() {
  try {
    if (!existsSync(INBOUND_REPAIR_EVIDENCE_PATH)) {
      return { status: 'missing', evidence_path: INBOUND_REPAIR_EVIDENCE_PATH }
    }
    const parsed = JSON.parse(readFileSync(INBOUND_REPAIR_EVIDENCE_PATH, 'utf8'))
    const tcc = parsed.full_disk_access_tcc || {}
    return {
      status: 'loaded',
      evidence_path: INBOUND_REPAIR_EVIDENCE_PATH,
      real_python: parsed.real_python || tcc.real_python || null,
      required_python_app: parsed.required_python_app || tcc.required_python_app || null,
      service: tcc.service || 'kTCCServiceSystemPolicyAllFiles',
      python_row_count: tcc.python_row_count ?? null,
      python_authorized: tcc.python_authorized === true,
      python_denied_or_off: tcc.python_denied_or_off === true,
      auth_value_meaning: tcc.auth_value_meaning || { '0': 'denied_or_off', '2': 'authorized_or_on' },
      rows: Array.isArray(tcc.databases)
        ? tcc.databases.flatMap((database: { rows?: Array<Record<string, unknown>>; path?: string }) =>
          (database.rows || []).map((row) => ({
            database_path: database.path || null,
            client: row.client || null,
            client_type: row.client_type ?? null,
            auth_value: row.auth_value ?? null,
            authorized: row.authorized === true,
          })),
        )
        : [],
    }
  } catch (error) {
    return {
      status: 'unreadable',
      evidence_path: INBOUND_REPAIR_EVIDENCE_PATH,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function GET() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokenHealth = await getTokenHealth(user.id)
  const runtimeHealth = getRuntimeHealth()
  const latestCompletionAudit = readLatestCompletionAudit()
  const physicalIOSBlockers = latestPhysicalIOSBlockers(latestCompletionAudit)
  const inboundBlocker = runtimeHealth.inbound_watcher.blocker || (
    runtimeHealth.inbound_watcher.ok ? null : 'inbound_watcher_not_ready'
  )

  return NextResponse.json({
    mode: 'observe_only_until_physical_iphone_screenshot_verified',
    safety: {
      personal_line_blocked: true,
      live_swipes_require_approval: true,
      live_messages_require_approval: true,
      outbound_send_requires_second_confirmation: true,
      approval_failures_fail_closed: true,
    },
    live_action_gate: readPhysicalIOSLiveActionGate(),
    adapters: ADAPTERS,
    physical_ios: {
      selected_line: 2,
      selected_phone: '+16199919355',
      selected_udid: '00008150-00093C9C3C7A401C',
      selected_device: 'Julian Bradley’s iPhone (2)',
      observed_connection: 'wifi',
      screenshot_probe: 'capture.physical_ios_screenshot',
      current_blocker: currentPhysicalIOSBlocker(latestCompletionAudit, physicalIOSBlockers),
      latest_known_blockers: physicalIOSBlockers,
      latest_blockers_source: latestCompletionAudit.status === 'missing' || latestCompletionAudit.status === 'unreadable'
        ? 'fallback_static_blockers'
        : 'latest_completion_audit_json',
      next_step: 'Unlock and keep the iPhone nearby/on-network, then run the readiness command to clear transport visibility, Developer Mode, CoreDevice visibility, and physical PNG proof.',
    },
    lines: SECONDARY_LINES,
    platforms: tokenHealth.platforms.map((platform) => ({
      platform: platform.platform,
      token_present: platform.present,
      required: platform.required,
      status: platform.status,
      updated_at: platform.updated_at,
    })),
    sendbird: tokenHealth.sendbird,
    blockers: [
      ...(tokenHealth.missing_required > 0 ? ['missing_required_platform_or_sendbird_token'] : []),
      ...(runtimeHealth.inbound_watcher.ok ? [] : [inboundBlocker || 'inbound_watcher_not_ready']),
      ...physicalIOSBlockers,
      ...(latestCompletionAudit.status === 'passed' ? [] : ['physical_ios_observe_png_not_verified']),
      'first_live_tap_swipe_or_send_requires_explicit_operator_approval',
    ],
    audit: {
      runtime_log: '~/.clapcheeks-local/device-control/actions.jsonl',
      screenshot_dir: '~/.clapcheeks-local/device-control/screenshots',
      proof_run_dir: '~/.clapcheeks-local/device-control/proof-runs',
      convex_sync: 'optional via CLAPCHEEKS_DEVICE_CONTROL_CONVEX_MUTATION',
    },
    inbound_watcher: {
      ok: runtimeHealth.inbound_watcher.ok,
      running: runtimeHealth.inbound_watcher.running,
      can_read_chatdb: runtimeHealth.inbound_watcher.can_read_chatdb,
      blocker: inboundBlocker,
      status_path: runtimeHealth.inbound_watcher.status_path,
      fda_alert_imessage_enabled: runtimeHealth.inbound_watcher.fda_alert_imessage_enabled,
      terminal_read_proof: runtimeHealth.terminal_read_proof,
      tcc: readInboundRepairTcc(),
      required_python_app: '/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app',
      repair_verify_command: 'cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh',
      unblock_command: 'cd ~/clapcheeks-local && scripts/open-inbound-watcher-fda-settings.sh',
      restart_command: 'launchctl kickstart -k gui/$(id -u)/tech.clapcheeks.inbound-watcher',
      verify_command: 'cd ~/clapcheeks-local && scripts/launchd_doctor.sh && cd ~/clapcheeks.tech/web && npm run test:e2e:runtime',
      next_step: runtimeHealth.inbound_watcher.ok
        ? 'Inbound watcher can read Messages and is ready.'
        : 'Grant Full Disk Access to the launchd Python app, restart tech.clapcheeks.inbound-watcher, then rerun runtime smoke.',
    },
    proof_runner: {
      host: 'MacBook Pro',
      cwd: '~/clapcheeks-local',
      script: 'scripts/run-device-control-physical-proof.sh',
      readiness_command: 'cd ~/clapcheeks-local && scripts/prepare-device-control-readiness.sh 2',
      transport_diagnostics_command: 'cd ~/clapcheeks-local && scripts/run-device-control-transport-diagnostics.sh 2',
      prepare_developer_mode_command: 'cd ~/clapcheeks-local && scripts/prepare-device-control-developer-mode.sh 2',
      prepare_coredevice_command: 'cd ~/clapcheeks-local && scripts/prepare-device-control-coredevice.sh 2',
      command: 'cd ~/clapcheeks-local && scripts/run-device-control-physical-proof.sh hinge 2',
      all_platforms_command: 'cd ~/clapcheeks-local && scripts/run-device-control-all-platform-proofs.sh 2',
      watch_command: 'cd ~/clapcheeks-local && scripts/watch-device-control-physical-proof.sh 2',
      completion_audit_command: 'cd ~/clapcheeks-local && scripts/run-device-control-completion-audit.sh 2 hinge',
      purpose: 'Run only after Developer Mode is enabled on the bound secondary iPhone; verifies strict doctor, waits for physical PNG proof, and records proof-run logs.',
    },
    completion_audit: {
      ...COMPLETION_AUDIT,
      latest_result: latestCompletionAudit,
    },
  })
}
