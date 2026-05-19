#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const outputPath = process.env.CLAPCHEEKS_RUNTIME_SMOKE_EVIDENCE || '/tmp/clapcheeks-runtime-smoke-evidence.json'
const pythonPath = process.env.CLAPCHEEKS_RUNTIME_PYTHON || `${process.env.HOME}/.clapcheeks-local/.venv/bin/python`
const inboundWatcherStatusPath = process.env.CLAPCHEEKS_INBOUND_WATCHER_STATUS || `${process.env.HOME}/.clapcheeks-local/state/inbound-watcher-status.json`
const today = new Date().toISOString().slice(0, 10)
const inboundTerminalProofPath = process.env.CLAPCHEEKS_INBOUND_TERMINAL_PROOF || `/tmp/clapcheeks-inbound-watcher-terminal-proof-${today}.json`
const args = ['-m', 'clapcheeks.scripts.e2e_smoke', '--no-send']

function parseLine(line) {
  const match = line.match(/^\[(?<marker>[^\]]+)\]\s+(?<name>[A-Z-]+)\s+(?<status>[A-Z]+)\s+--\s+(?<detail>.*)$/)
  if (!match?.groups) return null
  return {
    name: match.groups.name.toLowerCase().replaceAll('-', '_'),
    status: match.groups.status.toLowerCase(),
    detail: match.groups.detail,
  }
}

let stdout = ''
let stderr = ''
let exitCode = 0

try {
  stdout = execFileSync(pythonPath, args, {
    cwd: process.env.CLAPCHEEKS_RUNTIME_CWD || `${process.env.HOME}/clapcheeks-local`,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  exitCode = typeof error.status === 'number' ? error.status : 1
  stdout = error.stdout?.toString() || ''
  stderr = error.stderr?.toString() || error.message
}

const checks = stdout
  .split('\n')
  .map((line) => parseLine(line.trim()))
  .filter(Boolean)

const byName = Object.fromEntries(checks.map((item) => [item.name, item]))
const inboundMessagesMatch = byName.inbound?.detail?.match(/chat\.db has (?<count>\d+) messages/)
const inboundMessageRows = inboundMessagesMatch?.groups?.count ? Number(inboundMessagesMatch.groups.count) : null
const requiredPasses = ['convex', 'schema', 'inbound']
const requiredOk = requiredPasses.every((name) => byName[name]?.status === 'pass')
const noSendOk = byName.outbound_insert?.status === 'skip' && byName.drainer?.status === 'skip'
let inboundWatcherStatus = null
if (existsSync(inboundWatcherStatusPath)) {
  try {
    inboundWatcherStatus = JSON.parse(readFileSync(inboundWatcherStatusPath, 'utf8'))
  } catch {
    inboundWatcherStatus = { parse_error: true }
  }
}
let inboundTerminalProof = null
if (existsSync(inboundTerminalProofPath)) {
  try {
    inboundTerminalProof = JSON.parse(readFileSync(inboundTerminalProofPath, 'utf8'))
  } catch {
    inboundTerminalProof = { parse_error: true }
  }
}
const inboundWatcherOk = inboundWatcherStatus?.running === true &&
  inboundWatcherStatus?.can_read_chatdb === true &&
  inboundWatcherStatus?.fda_alert_imessage_enabled === false
const inboundTerminalProofOk = inboundTerminalProof?.ok === true &&
  inboundTerminalProof?.can_read_chatdb === true &&
  inboundTerminalProof?.no_send === true &&
  inboundTerminalProof?.mutation === false &&
  inboundTerminalProof?.bodies_written === false &&
  inboundTerminalProof?.raw_handles_written === false

const evidence = {
  ok: exitCode === 0 && requiredOk && noSendOk && inboundWatcherOk,
  generated_at: new Date().toISOString(),
  output_path: outputPath,
  python_path: pythonPath,
  command: `${pythonPath} ${args.join(' ')}`,
  no_send: true,
  no_live_send_performed: true,
  outbound_insert_skipped: byName.outbound_insert?.status === 'skip',
  drainer_skipped: byName.drainer?.status === 'skip',
  inbound_watcher_ok: inboundWatcherOk,
  inbound_watcher_status_path: inboundWatcherStatusPath,
  inbound_watcher_status: inboundWatcherStatus,
  inbound_terminal_proof_ok: inboundTerminalProofOk,
  inbound_terminal_proof_path: inboundTerminalProofPath,
  inbound_terminal_proof: inboundTerminalProof,
  required_checks: requiredPasses,
  checks,
  inbound_message_rows: inboundMessageRows,
  stdout,
  stderr,
  exit_code: exitCode,
}

writeFileSync(outputPath, JSON.stringify(evidence, null, 2))

console.log(`Runtime smoke: ${evidence.ok ? 'PASS' : 'FAIL'}`)
console.log(`No-send: ${evidence.no_send}`)
if (inboundMessageRows != null) console.log(`Inbound Messages DB rows: ${inboundMessageRows}`)
console.log(`Inbound watcher: ok=${evidence.inbound_watcher_ok} status=${inboundWatcherStatusPath}`)
console.log(`Terminal read-only proof: ok=${evidence.inbound_terminal_proof_ok} path=${inboundTerminalProofPath}`)
if (inboundWatcherStatus?.last_error_kind) {
  console.log(`Inbound watcher blocker: ${inboundWatcherStatus.last_error_kind}`)
}
console.log(`Evidence: ${outputPath}`)

if (!evidence.ok) process.exit(1)
