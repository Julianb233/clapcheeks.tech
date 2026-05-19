import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'

export interface InboundWatcherStatus {
  component?: string
  running?: boolean
  can_read_chatdb?: boolean | null
  fda_alert_imessage_enabled?: boolean
  last_error_kind?: string | null
  last_error?: string | null
  updated_at_ms?: number
}

export interface TerminalReadProof {
  ok?: boolean
  proof?: string
  can_read_chatdb?: boolean
  count?: number
  directions?: {
    inbound?: number
    outbound?: number
  }
  no_send?: boolean
  mutation?: boolean
  bodies_written?: boolean
  raw_handles_written?: boolean
  created_at_ms?: number
}

export interface RuntimeHealth {
  ok: boolean
  blockers: Array<{ name: string; reason: string }>
  inbound_watcher: {
    ok: boolean
    status_path: string
    running: boolean
    can_read_chatdb: boolean | null
    fda_alert_imessage_enabled: boolean
    blocker: string | null
    updated_at_ms: number | null
  }
  terminal_read_proof: {
    ok: boolean
    path: string
    count: number | null
    inbound: number | null
    outbound: number | null
    no_send: boolean
    mutation: boolean
    bodies_written: boolean
    raw_handles_written: boolean
    created_at_ms: number | null
  }
  full_disk_access_tcc: {
    ok: boolean
    evidence_path: string
    real_python: string | null
    python_row_count: number | null
    python_authorized: boolean
    python_denied_or_off: boolean
  }
}

const DEFAULT_STATUS_PATH = path.join(
  process.env.HOME || '',
  '.clapcheeks-local',
  'state',
  'inbound-watcher-status.json',
)

const DEFAULT_TERMINAL_PROOF_PATH = path.join(
  '/tmp',
  `clapcheeks-inbound-watcher-terminal-proof-${new Date().toISOString().slice(0, 10)}.json`,
)

const DEFAULT_INBOUND_REPAIR_PATH = path.join(
  '/tmp',
  `clapcheeks-inbound-watcher-fda-repair-${new Date().toISOString().slice(0, 10)}.json`,
)

function loadInboundWatcherStatus(statusPath: string): InboundWatcherStatus | null {
  if (!statusPath || !existsSync(statusPath)) return null
  try {
    return JSON.parse(readFileSync(statusPath, 'utf8')) as InboundWatcherStatus
  } catch {
    return {
      running: false,
      can_read_chatdb: false,
      last_error_kind: 'status_parse_error',
      last_error: 'inbound watcher status file is not valid JSON',
    }
  }
}

function loadTerminalReadProof(proofPath: string): TerminalReadProof | null {
  if (!proofPath || !existsSync(proofPath)) return null
  try {
    return JSON.parse(readFileSync(proofPath, 'utf8')) as TerminalReadProof
  } catch {
    return {
      ok: false,
      proof: 'terminal_chatdb_read_only',
      can_read_chatdb: false,
      no_send: false,
      mutation: true,
      bodies_written: true,
      raw_handles_written: true,
    }
  }
}

function loadFullDiskAccessTcc(repairPath: string): RuntimeHealth['full_disk_access_tcc'] {
  const empty = {
    ok: false,
    evidence_path: repairPath,
    real_python: null,
    python_row_count: null,
    python_authorized: false,
    python_denied_or_off: false,
  }

  if (!repairPath || !existsSync(repairPath)) return empty

  try {
    const parsed = JSON.parse(readFileSync(repairPath, 'utf8'))
    const tcc = parsed?.full_disk_access_tcc || {}
    const pythonAuthorized = tcc.python_authorized === true
    return {
      ok: pythonAuthorized,
      evidence_path: repairPath,
      real_python: parsed?.real_python || tcc.real_python || null,
      python_row_count: typeof tcc.python_row_count === 'number' ? tcc.python_row_count : null,
      python_authorized: pythonAuthorized,
      python_denied_or_off: tcc.python_denied_or_off === true,
    }
  } catch {
    return empty
  }
}

export function getRuntimeHealth(): RuntimeHealth {
  const statusPath = process.env.CLAPCHEEKS_INBOUND_WATCHER_STATUS || DEFAULT_STATUS_PATH
  const terminalProofPath = process.env.CLAPCHEEKS_INBOUND_TERMINAL_PROOF || DEFAULT_TERMINAL_PROOF_PATH
  const inboundRepairPath = process.env.CLAPCHEEKS_INBOUND_REPAIR_EVIDENCE || DEFAULT_INBOUND_REPAIR_PATH
  const status = loadInboundWatcherStatus(statusPath)
  const terminalProof = loadTerminalReadProof(terminalProofPath)
  const fullDiskAccessTcc = loadFullDiskAccessTcc(inboundRepairPath)
  const blocker = status?.last_error_kind || (status ? null : 'status_missing')
  const running = status?.running === true
  const canReadChatDb = status?.can_read_chatdb === true
  const fdaAlertEnabled = status?.fda_alert_imessage_enabled === true
  const inboundOk = running && canReadChatDb && !fdaAlertEnabled
  const terminalProofOk = terminalProof?.ok === true
    && terminalProof.can_read_chatdb === true
    && terminalProof.no_send === true
    && terminalProof.mutation === false
    && terminalProof.bodies_written === false
    && terminalProof.raw_handles_written === false
  const blockers: RuntimeHealth['blockers'] = []

  if (!status) {
    blockers.push({
      name: 'inbound-watcher',
      reason: 'inbound watcher status file missing',
    })
  } else if (!running) {
    blockers.push({
      name: 'inbound-watcher',
      reason: 'inbound watcher is not running',
    })
  } else if (!canReadChatDb) {
    const terminalProofSuffix = terminalProofOk
      ? `; Terminal read-only proof passed (${terminalProof?.count ?? 0} rows), grant Full Disk Access to launchd Python`
      : ''
    const tccSuffix = fullDiskAccessTcc.python_denied_or_off
      ? `; TCC shows Python Full Disk Access is off (${fullDiskAccessTcc.python_row_count ?? 0} row, authorized=false)`
      : ''
    blockers.push({
      name: 'inbound-watcher',
      reason: blocker === 'full_disk_access_missing'
        ? `Full Disk Access missing for launchd Python${terminalProofSuffix}${tccSuffix}`
        : `${status.last_error || blocker || 'inbound watcher cannot read chat.db'}${terminalProofSuffix}${tccSuffix}`,
    })
  }

  if (fdaAlertEnabled) {
    blockers.push({
      name: 'inbound-watcher-alert',
      reason: 'Full Disk Access alert iMessage is enabled',
    })
  }

  return {
    ok: inboundOk,
    blockers,
    inbound_watcher: {
      ok: inboundOk,
      status_path: statusPath,
      running,
      can_read_chatdb: status?.can_read_chatdb === null || status?.can_read_chatdb === undefined
        ? null
        : canReadChatDb,
      fda_alert_imessage_enabled: fdaAlertEnabled,
      blocker,
      updated_at_ms: typeof status?.updated_at_ms === 'number' ? status.updated_at_ms : null,
    },
    terminal_read_proof: {
      ok: terminalProofOk,
      path: terminalProofPath,
      count: typeof terminalProof?.count === 'number' ? terminalProof.count : null,
      inbound: typeof terminalProof?.directions?.inbound === 'number' ? terminalProof.directions.inbound : null,
      outbound: typeof terminalProof?.directions?.outbound === 'number' ? terminalProof.directions.outbound : null,
      no_send: terminalProof?.no_send === true,
      mutation: terminalProof?.mutation === true,
      bodies_written: terminalProof?.bodies_written === true,
      raw_handles_written: terminalProof?.raw_handles_written === true,
      created_at_ms: typeof terminalProof?.created_at_ms === 'number' ? terminalProof.created_at_ms : null,
    },
    full_disk_access_tcc: fullDiskAccessTcc,
  }
}
