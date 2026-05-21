import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@/lib/convex/server'
import { convexQuery } from '@/lib/convex/http'
import { getTokenHealth } from '@/lib/clapcheeks/token-health'
import { getRuntimeHealth } from '@/lib/clapcheeks/runtime-health'
import { getInboundWatcherHealth } from '@/lib/clapcheeks/inbound-watcher-health'

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
const COMPLETION_AUDIT_EVENT_TYPE = 'device_control.completion_audit'
const TRANSPORT_DIAGNOSTICS_EVENT_TYPE = 'qa.transport_diagnostics_readiness_wiring'
const PHYSICAL_BLOCKER_REFRESH_EVENT_TYPE = 'qa.physical_sender_iphone_blocker_refresh'

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
const LATEST_TRANSPORT_DIAGNOSTICS_PATH = `${homedir()}/.clapcheeks-local/device-control/proof-runs/latest-transport-diagnostics.json`
const INBOUND_REPAIR_EVIDENCE_PATH = process.env.CLAPCHEEKS_INBOUND_REPAIR_EVIDENCE || '/tmp/clapcheeks-inbound-watcher-fda-repair-2026-05-18.json'
const TRANSPORT_BLOCKERS = new Set([
  'usbmux_no_bound_udid',
  'ios_deploy_no_bound_udid',
  'pairing_record_missing_for_bound_udid',
  'coredevice_no_bound_udid',
  'coredevice_list_failed',
])

type LatestCompletionAudit = {
  status: 'missing' | 'unreadable' | 'passed' | 'failed'
  timestamp?: string | null
  line?: number | null
  platform?: string | null
  audit_log?: string | null
  failed_checks?: string[]
  blockers?: string[]
  next_unblock_steps?: string[]
  readiness_command?: string
  transport_diagnostics_command?: string
  completion_audit_command?: string
  transport_visibility?: Record<string, unknown> | null
  physical_png_required?: boolean
  completion_rule?: string
  path: string
  source?: 'local_file' | 'convex_telemetry' | 'missing'
  telemetry_event_id?: string | null
  telemetry_occurred_at?: number | null
  error?: string
}

type LatestTransportDiagnostics = {
  status: 'missing' | 'unreadable' | 'loaded'
  path: string
  blockers?: string[]
  transport_visibility?: Record<string, unknown> | null
  source?: 'local_file' | 'convex_telemetry' | 'missing'
  telemetry_event_id?: string | null
  telemetry_occurred_at?: number | null
  error?: string
}

function cleanStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function cleanObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function telemetryTimestamp(event: { occurred_at?: number; ts?: number } | null | undefined) {
  if (typeof event?.occurred_at === 'number') return event.occurred_at
  if (typeof event?.ts === 'number') return event.ts
  return 0
}

function normalizeCompletionAudit(parsed: Record<string, unknown>, source: LatestCompletionAudit['source']): LatestCompletionAudit {
  const rawStatus = parsed.completion_audit === 'passed' || parsed.status === 'passed' ? 'passed' : 'failed'
  return {
    status: rawStatus,
    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
    line: typeof parsed.line === 'number' ? parsed.line : null,
    platform: typeof parsed.platform === 'string' ? parsed.platform : null,
    audit_log: typeof parsed.audit_log === 'string' ? parsed.audit_log : null,
    failed_checks: cleanStringArray(parsed.failed_checks),
    blockers: cleanStringArray(parsed.blockers),
    next_unblock_steps: cleanStringArray(parsed.next_unblock_steps),
    readiness_command: typeof parsed.readiness_command === 'string' ? parsed.readiness_command : COMPLETION_AUDIT.command,
    transport_diagnostics_command: typeof parsed.transport_diagnostics_command === 'string'
      ? parsed.transport_diagnostics_command
      : 'cd ~/clapcheeks-local && scripts/run-device-control-transport-diagnostics.sh 2',
    completion_audit_command: typeof parsed.completion_audit_command === 'string' ? parsed.completion_audit_command : COMPLETION_AUDIT.command,
    transport_visibility: cleanObject(parsed.transport_visibility),
    physical_png_required: Boolean(parsed.physical_png_required),
    completion_rule: typeof parsed.completion_rule === 'string' ? parsed.completion_rule : COMPLETION_AUDIT.decision_rule,
    path: typeof parsed.path === 'string' ? parsed.path : COMPLETION_AUDIT.latest_result_path,
    source,
  }
}

function readLatestCompletionAudit(): LatestCompletionAudit {
  try {
    if (!existsSync(LATEST_COMPLETION_AUDIT_PATH)) {
      return { status: 'missing', path: COMPLETION_AUDIT.latest_result_path, source: 'missing' }
    }
    const parsed = JSON.parse(readFileSync(LATEST_COMPLETION_AUDIT_PATH, 'utf8'))
    return normalizeCompletionAudit({ ...parsed, path: COMPLETION_AUDIT.latest_result_path }, 'local_file')
  } catch (error) {
    return {
      status: 'unreadable',
      path: COMPLETION_AUDIT.latest_result_path,
      source: 'local_file',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readLatestTransportDiagnostics(): LatestTransportDiagnostics {
  try {
    if (!existsSync(LATEST_TRANSPORT_DIAGNOSTICS_PATH)) {
      return { status: 'missing', path: LATEST_TRANSPORT_DIAGNOSTICS_PATH }
    }
    const parsed = JSON.parse(readFileSync(LATEST_TRANSPORT_DIAGNOSTICS_PATH, 'utf8'))
    return {
      status: 'loaded',
      path: LATEST_TRANSPORT_DIAGNOSTICS_PATH,
      blockers: cleanStringArray(parsed.blockers),
      transport_visibility: cleanObject(parsed),
      source: 'local_file',
    }
  } catch (error) {
    return {
      status: 'unreadable',
      path: LATEST_TRANSPORT_DIAGNOSTICS_PATH,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readLatestTransportDiagnosticsFromTelemetry(userId: string): Promise<LatestTransportDiagnostics | null> {
  const userIds = [userId, defaultTelemetryUserId()].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  )
  const candidates: Array<{ event: { _id?: string; data?: Record<string, unknown>; occurred_at?: number; ts?: number }; diagnostics: LatestTransportDiagnostics }> = []
  for (const telemetryUserId of userIds) {
    for (const eventType of [TRANSPORT_DIAGNOSTICS_EVENT_TYPE, PHYSICAL_BLOCKER_REFRESH_EVENT_TYPE]) {
      try {
        const events = await convexQuery<Array<{ _id?: string; data?: Record<string, unknown>; occurred_at?: number; ts?: number }>>(
          'telemetry:listEventsForUser',
          {
            user_id: telemetryUserId,
            event_type: eventType,
            limit: 1,
          },
        )
        const event = Array.isArray(events) ? events[0] : null
        const data = event?.data
        const transport = data?.latest_transport_diagnostics || data?.transport_visibility
        if (!event || !transport || typeof transport !== 'object' || Array.isArray(transport)) continue
        candidates.push({
          event,
          diagnostics: {
            status: 'loaded',
            path: typeof data?.latest_transport_diagnostics_path === 'string'
              ? data.latest_transport_diagnostics_path
              : typeof data?.transport_diagnostics_json === 'string'
                ? data.transport_diagnostics_json
                : 'convex_telemetry',
            blockers: cleanStringArray((transport as Record<string, unknown>).blockers),
            transport_visibility: cleanObject(transport),
            source: 'convex_telemetry',
            telemetry_event_id: typeof event._id === 'string' ? event._id : null,
            telemetry_occurred_at: telemetryTimestamp(event) || null,
          },
        })
      } catch {
        continue
      }
    }
  }
  candidates.sort((a, b) => telemetryTimestamp(b.event) - telemetryTimestamp(a.event))
  return candidates[0]?.diagnostics || null
}

async function latestTransportDiagnosticsForUser(userId: string): Promise<LatestTransportDiagnostics> {
  const local = readLatestTransportDiagnostics()
  if (local.status === 'loaded') return local
  return await readLatestTransportDiagnosticsFromTelemetry(userId) || local
}

function defaultTelemetryUserId() {
  return process.env.CONVEX_FLEET_USER_ID || 'fleet-julian'
}

async function readLatestCompletionAuditFromTelemetry(userId: string): Promise<LatestCompletionAudit | null> {
  const userIds = [userId, defaultTelemetryUserId()].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  )
  const candidates: Array<{ event: { _id?: string; data?: Record<string, unknown>; occurred_at?: number; ts?: number }; audit: LatestCompletionAudit }> = []
  for (const telemetryUserId of userIds) {
    for (const eventType of [COMPLETION_AUDIT_EVENT_TYPE, PHYSICAL_BLOCKER_REFRESH_EVENT_TYPE]) {
      try {
        const events = await convexQuery<Array<{ _id?: string; data?: Record<string, unknown>; occurred_at?: number; ts?: number }>>(
          'telemetry:listEventsForUser',
          {
            user_id: telemetryUserId,
            event_type: eventType,
            limit: 1,
          },
        )
        const event = Array.isArray(events) ? events[0] : null
        const data = event?.data
        if (!event || !data || typeof data !== 'object') continue
        const rawLatest = data.latest_result && typeof data.latest_result === 'object' && !Array.isArray(data.latest_result)
          ? data.latest_result as Record<string, unknown>
          : data
        candidates.push({
          event,
          audit: {
            ...normalizeCompletionAudit({
              ...rawLatest,
              path: typeof data.latest_result_path === 'string'
                ? data.latest_result_path
                : typeof data.completion_audit_json === 'string'
                  ? data.completion_audit_json
                  : COMPLETION_AUDIT.latest_result_path,
            }, 'convex_telemetry'),
            telemetry_event_id: typeof event._id === 'string' ? event._id : null,
            telemetry_occurred_at: telemetryTimestamp(event) || null,
          },
        })
      } catch {
        continue
      }
    }
  }
  candidates.sort((a, b) => telemetryTimestamp(b.event) - telemetryTimestamp(a.event))
  return candidates[0]?.audit || null
}

async function latestCompletionAuditForUser(userId: string): Promise<LatestCompletionAudit> {
  const local = readLatestCompletionAudit()
  if (local.status !== 'missing' && local.status !== 'unreadable') return local
  return await readLatestCompletionAuditFromTelemetry(userId) || local
}

function latestPhysicalIOSBlockers(latestAudit: LatestCompletionAudit, latestTransport: LatestTransportDiagnostics) {
  const auditBlockers = Array.isArray(latestAudit.blockers) ? latestAudit.blockers : []
  const transportBlockers = latestTransport.status === 'loaded' && Array.isArray(latestTransport.blockers)
    ? latestTransport.blockers
    : []
  const effectiveBlockers = [
    ...new Set([
      ...(transportBlockers.length > 0
        ? auditBlockers.filter((blocker) => !TRANSPORT_BLOCKERS.has(blocker))
        : auditBlockers),
      ...transportBlockers,
    ]),
  ]
  if (effectiveBlockers.length > 0) {
    return effectiveBlockers
  }
  return FALLBACK_PHYSICAL_IOS_BLOCKERS
}

function currentPhysicalIOSBlocker(latestAudit: LatestCompletionAudit, blockers: string[]) {
  if (latestAudit.status === 'passed') return 'none'
  return blockers[0] || 'physical_readiness_not_verified'
}

function effectiveTransportVisibilitySource(
  latestAudit: LatestCompletionAudit,
  latestTransport: LatestTransportDiagnostics,
) {
  const auditTransport = latestAudit.transport_visibility || null
  const diagnosticsTransport = latestTransport.transport_visibility || null
  const auditTime = latestAudit.telemetry_occurred_at || 0
  const diagnosticsTime = latestTransport.telemetry_occurred_at || 0
  if (auditTransport && (!diagnosticsTransport || auditTime >= diagnosticsTime)) {
    return {
      transport_visibility: auditTransport,
      source: latestAudit.source === 'convex_telemetry' ? 'latest_completion_audit_telemetry' : 'latest_completion_audit_json',
    }
  }
  return {
    transport_visibility: diagnosticsTransport || auditTransport,
    source: latestTransport.status === 'loaded'
      ? 'latest_transport_diagnostics_json'
      : latestAudit.source === 'convex_telemetry'
        ? 'convex_telemetry'
        : latestAudit.status === 'missing' || latestAudit.status === 'unreadable'
          ? 'fallback_static_blockers'
          : 'latest_completion_audit_json',
  }
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

  const [tokenHealth, inboundHealth] = await Promise.all([
    getTokenHealth(user.id),
    getInboundWatcherHealth(user.id),
  ])
  const runtimeHealth = getRuntimeHealth()
  const localLatestCompletionAudit = readLatestCompletionAudit()
  const [latestCompletionAudit, latestTransportDiagnostics] = await Promise.all([
    latestCompletionAuditForUser(user.id),
    latestTransportDiagnosticsForUser(user.id),
  ])
  const effectiveTransport = effectiveTransportVisibilitySource(latestCompletionAudit, latestTransportDiagnostics)
  const transportVisibility = effectiveTransport.transport_visibility
  const effectiveLatestTransportDiagnostics = {
    ...latestTransportDiagnostics,
    blockers: cleanStringArray(transportVisibility?.blockers),
    transport_visibility: transportVisibility,
  }
  const physicalIOSBlockers = latestPhysicalIOSBlockers(latestCompletionAudit, effectiveLatestTransportDiagnostics)
  const effectiveLatestCompletionAudit = {
    ...latestCompletionAudit,
    blockers: physicalIOSBlockers,
    transport_visibility: transportVisibility,
  }
  const inboundBlocker = inboundHealth.blocker || (
    inboundHealth.ok ? null : 'inbound_watcher_not_ready'
  )
  const exactPhysicalUnblock = effectiveLatestCompletionAudit.next_unblock_steps?.length
    ? effectiveLatestCompletionAudit.next_unblock_steps.join(' ')
    : 'Unlock and keep the iPhone nearby/on-network, then run the readiness command to clear transport visibility, Developer Mode, CoreDevice visibility, and physical PNG proof.'

  return NextResponse.json({
    mode: 'observe_only_until_physical_iphone_screenshot_verified',
    transport_visibility: transportVisibility,
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
      device_topology: {
        sender_device: 'secondary_iPhone',
        sender_device_label: 'Julian Bradley’s iPhone (2)',
        sender_number: '+16199919355',
        operator_device: 'iPad_or_dashboard_browser',
        operator_role: 'review_edit_approve_monitor',
        recommendation: 'Use the secondary iPhone with the other number for Tinder/Hinge/iMessage sending; use the iPad or CCT dashboard as the review and approval screen.',
        rationale: [
          'keeps the sending identity tied to the other number',
          'isolates live dating apps and iMessage from the personal line',
          'matches the physical iOS proof path that requires Developer Mode, trust pairing, CoreDevice visibility, and PNG proof',
          'keeps approval and editing on a comfortable operator screen before any live send',
        ],
      },
      observed_connection: 'wifi',
      screenshot_probe: 'capture.physical_ios_screenshot',
      current_blocker: currentPhysicalIOSBlocker(latestCompletionAudit, physicalIOSBlockers),
      latest_known_blockers: physicalIOSBlockers,
      latest_blockers_source: effectiveTransport.source,
      transport_visibility: transportVisibility,
      latest_transport_diagnostics: effectiveLatestTransportDiagnostics,
      local_latest_audit_status: localLatestCompletionAudit.status,
      next_step: exactPhysicalUnblock,
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
      ...tokenHealth.missing_required_services.map((item) => `missing_required_${item.name}_token`),
      ...(inboundHealth.ok ? [] : [inboundBlocker || 'inbound_watcher_not_ready']),
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
      ok: inboundHealth.ok,
      source: inboundHealth.source,
      running: inboundHealth.running,
      can_read_chatdb: inboundHealth.can_read_chatdb,
      blocker: inboundBlocker,
      blockers: inboundHealth.blockers,
      message: inboundHealth.message,
      status_path: inboundHealth.status_path,
      updated_at_ms: inboundHealth.updated_at_ms,
      telemetry_event_id: inboundHealth.telemetry_event_id,
      telemetry_age_ms: inboundHealth.telemetry_age_ms,
      fda_alert_imessage_enabled: inboundHealth.fda_alert_imessage_enabled,
      terminal_read_proof: runtimeHealth.terminal_read_proof,
      tcc: readInboundRepairTcc(),
      required_python_app: '/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app',
      repair_verify_command: 'cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh',
      unblock_command: 'cd ~/clapcheeks-local && scripts/open-inbound-watcher-fda-settings.sh',
      restart_command: 'launchctl kickstart -k gui/$(id -u)/tech.clapcheeks.inbound-watcher',
      verify_command: 'cd ~/clapcheeks-local && scripts/launchd_doctor.sh && cd ~/clapcheeks.tech/web && npm run test:e2e:runtime',
      next_step: inboundHealth.ok
        ? 'Inbound watcher can read Messages and is ready.'
        : 'Restart tech.clapcheeks.inbound-watcher, verify the Convex telemetry event is fresh, then rerun runtime smoke.',
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
      latest_result: effectiveLatestCompletionAudit,
      latest_transport_diagnostics_path: LATEST_TRANSPORT_DIAGNOSTICS_PATH,
      latest_transport_diagnostics: effectiveLatestTransportDiagnostics,
    },
  })
}
