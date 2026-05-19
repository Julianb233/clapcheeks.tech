#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CLAPCHEEKS_E2E_BASE_URL:-http://127.0.0.1:3002}"
OUT_DIR="${CLAPCHEEKS_BROWSER_EVIDENCE_DIR:-/tmp/clapcheeks-e2e-browser}"
MANIFEST="${CLAPCHEEKS_BROWSER_EVIDENCE:-/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json}"

mkdir -p "$OUT_DIR"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require curl
require node
require osascript
require screencapture

wait_for_route() {
  local path="$1"
  for _ in $(seq 1 30); do
    if curl -fsS "${BASE_URL}${path}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Route did not become ready: ${BASE_URL}${path}" >&2
  exit 1
}

chrome_open() {
  local path="$1"
  local left="$2"
  local top="$3"
  local right="$4"
  local bottom="$5"
  osascript - "${BASE_URL}${path}" "$left" "$top" "$right" "$bottom" <<'OSA'
on run argv
  set targetUrl to item 1 of argv
  set l to (item 2 of argv) as integer
  set t to (item 3 of argv) as integer
  set r to (item 4 of argv) as integer
  set b to (item 5 of argv) as integer
  tell application "Google Chrome"
    with timeout of 300 seconds
      activate
      if (count of windows) = 0 then make new window
      set bounds of front window to {l, t, r, b}
      set URL of active tab of front window to targetUrl
    end timeout
  end tell
end run
OSA
}

chrome_eval() {
  local js="$1"
  osascript - "$js" <<'OSA'
on run argv
  set jsCode to item 1 of argv
  tell application "Google Chrome"
    tell active tab of front window
      with timeout of 300 seconds
        execute javascript jsCode
      end timeout
    end tell
  end tell
end run
OSA
}

capture() {
  local path="$1"
  sleep 2
  screencapture -x "$path"
  test -s "$path"
}

capture_metrics() {
  local key="$1"
  local js="$2"
  local output="${OUT_DIR}/${key}-metrics.json"
  local result
  result="$(chrome_eval "$js")"
  node - "$result" "$output" <<'NODE'
const fs = require('node:fs')
const [raw, output] = process.argv.slice(2)
const metrics = JSON.parse(raw)
fs.writeFileSync(output, JSON.stringify(metrics, null, 2))
NODE
}

capture_json() {
  local key="$1"
  local js="$2"
  local output="${OUT_DIR}/${key}.json"
  local result
  result="$(chrome_eval "$js")"
  node - "$result" "$output" <<'NODE'
const fs = require('node:fs')
const [raw, output] = process.argv.slice(2)
const value = JSON.parse(raw)
fs.writeFileSync(output, JSON.stringify(value, null, 2))
NODE
}

mobile_metric_js() {
  local label="$1"
  cat <<JS
(() => JSON.stringify({
  label: '${label}',
  pathname: location.pathname,
  inner_width: window.innerWidth,
  inner_height: window.innerHeight,
  client_width: document.documentElement.clientWidth,
  scroll_width: document.documentElement.scrollWidth,
  body_scroll_width: document.body?.scrollWidth || 0,
  overflow_x: document.documentElement.scrollWidth > window.innerWidth + 6,
  text_length: document.body?.innerText?.length || 0
}))()
JS
}

dashboard_navigation_integrity_js() {
  cat <<'JS'
(() => {
  const normalize = (href) => {
    const url = new URL(href, location.origin)
    return `${url.pathname}${url.search}`
  }
  const anchors = Array.from(document.querySelectorAll('a')).map((anchor) => ({
    text: (anchor.innerText || anchor.textContent || '').trim().replace(/\s+/g, ' '),
    href: normalize(anchor.href),
  }))
  const requiredActions = [
    { label: 'Manage roster', href: '/dashboard/roster' },
    { label: 'Draft date ask', href: '/conversation?goal=ask_date' },
    { label: 'Review scheduled', href: '/scheduled' },
    { label: 'Add contact', href: '/matches/add' },
    { label: 'Insights', href: '/intelligence' },
    { label: 'Runtime', href: '/device' },
  ]
  const requiredTopNav = [
    { label: 'Roster', href: '/dashboard/roster' },
    { label: 'Scheduled', href: '/scheduled' },
    { label: 'Analytics', href: '/analytics' },
    { label: 'Conversation AI', href: '/conversation' },
    { label: 'Intelligence', href: '/intelligence' },
    { label: 'Billing', href: '/billing' },
  ]
  const hasAnchor = (item) => anchors.some((anchor) => anchor.text === item.label && anchor.href === item.href)
  const missingActions = requiredActions.filter((item) => !hasAnchor(item))
  const missingTopNav = requiredTopNav.filter((item) => !hasAnchor(item))
  const quickActionsHeadingPresent = (document.body.innerText || '').includes('Quick actions')
  return JSON.stringify({
    ok: missingActions.length === 0 && missingTopNav.length === 0 && quickActionsHeadingPresent,
    quick_actions_heading_present: quickActionsHeadingPresent,
    missing_actions: missingActions,
    missing_top_nav: missingTopNav,
    route_checks: [],
    failed_routes: [],
    total_anchor_count: anchors.length,
    route_matrix_source: 'scripts/e2e-readiness-safe.mjs',
    no_click_performed: true,
    no_live_send_performed: true,
  })
})()
JS
}

dashboard_health_blockers_js() {
  cat <<'JS'
(() => {
  const text = document.body.innerText || ''
  const lowerText = text.toLowerCase()
  const expected = ['tinder', 'hinge', 'sendbird']
  const missingLabels = expected.filter((label) => !lowerText.includes(label))
  const runtimeTilePresent = text.includes('Runtime Blockers')
  const runtimeBlockerPresent = text.includes('Runtime Blockers') &&
    lowerText.includes('full disk access') &&
    lowerText.includes('tcc shows python full disk access is off')
  const runtimeHealthyPresent = text.includes('Runtime Blockers') &&
    lowerText.includes('inbound watcher healthy')
  return JSON.stringify({
    ok: text.includes('Tokens Missing') && missingLabels.length === 0 && runtimeTilePresent && (runtimeBlockerPresent || runtimeHealthyPresent),
    token_tile_present: text.includes('Tokens Missing'),
    runtime_tile_present: runtimeTilePresent,
    runtime_blocker_present: runtimeBlockerPresent,
    runtime_healthy_present: runtimeHealthyPresent,
    expected_blockers: expected,
    missing_labels: missingLabels,
    no_token_values_present: !/(access_token|refresh_token|api_token|SENDBIRD_API_TOKEN)/i.test(text),
    no_live_send_performed: true,
  })
})()
JS
}

dashboard_imessage_self_test_js() {
  cat <<'JS'
(() => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', '/api/imessage/test', false)
  xhr.send(null)
  const metadata = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {}
  const text = document.body.innerText || ''
  const lowerText = text.toLowerCase()
  const buttons = Array.from(document.querySelectorAll('button'))
  const labels = Array.from(document.querySelectorAll('label'))
  const dryRunLabel = labels.find((label) => label.innerText.includes('Dry run only'))
  const dryRunInput = dryRunLabel?.querySelector('input[type="checkbox"]') || null
  const verifyButton = buttons.find((button) => button.innerText.includes('Verify Test iMessage')) || null
  const selfTestButton = buttons.find((button) => button.innerText.includes('Use self-test') || button.innerText.includes('Using self-test')) || null
  const liveWarningPresent = text.includes('Live sends require Mac agent running') && text.includes('clapcheeks start')
  const dryRunDefault = dryRunInput?.checked === true
  const selfTestLast4 = metadata?.self_test_recipient?.last4 || null
  const selfTestConfigured = metadata?.self_test_recipient?.configured === true
  const selfTestButtonMatchesMetadata = selfTestConfigured
    ? Boolean(selfTestButton?.innerText.includes(selfTestLast4))
    : buttons.some((button) => button.innerText.includes('Self-test not configured') && button.disabled === true)
  const liveSendGate = metadata?.live_send_gate || {}
  const liveSendPreflight = liveSendGate.preflight || {}
  const liveSendGatePresent = text.includes('Final live-send gate') &&
    text.includes('Preflight freshness') &&
    text.includes('SEND LIVE TO JULIAN') &&
    text.includes('docs/e2e-live-send-runbook.md') &&
    text.includes('no live send performed')
  const redactedPlan = liveSendGate.redacted_execution_plan || {}

  return JSON.stringify({
    ok: xhr.status === 200 &&
      text.includes('Test iMessage Automation') &&
      text.includes('Dry run only. Validate the phone and queue shape without sending.') &&
      Boolean(verifyButton) &&
      dryRunDefault &&
      selfTestButtonMatchesMetadata &&
      liveWarningPresent &&
      liveSendGatePresent &&
      liveSendGate.no_send_performed === true &&
      Object.prototype.hasOwnProperty.call(liveSendGate, 'redacted_execution_plan') &&
      !JSON.stringify(liveSendGate).includes('+17578312944') &&
      !JSON.stringify(liveSendGate).includes('Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'),
    api_status: xhr.status,
    self_test_recipient_configured: selfTestConfigured,
    self_test_recipient_last4: selfTestLast4,
    self_test_button_matches_metadata: selfTestButtonMatchesMetadata,
    dry_run_default: dryRunDefault,
    verify_button_present: Boolean(verifyButton),
    live_warning_present: liveWarningPresent,
    live_send_gate_present: liveSendGatePresent,
    live_send_gate_ready: liveSendGate.ready === true,
    live_send_gate_missing: Array.isArray(liveSendGate.missing) ? liveSendGate.missing : [],
    live_send_gate_issues: Array.isArray(liveSendGate.issues) ? liveSendGate.issues : [],
    live_send_gate_sample_override_required: liveSendGate.sample_override_required === true,
    live_send_gate_no_send: liveSendGate.no_send_performed === true,
    live_send_gate_preflight_present: Object.prototype.hasOwnProperty.call(liveSendGate, 'preflight'),
    live_send_gate_preflight_fresh: liveSendPreflight.fresh === true,
    live_send_gate_preflight_max_age_seconds: liveSendPreflight.max_age_seconds ?? null,
    live_send_gate_preflight_age_seconds: liveSendPreflight.age_seconds ?? null,
    live_send_gate_redacted_plan_present: Object.prototype.hasOwnProperty.call(liveSendGate, 'redacted_execution_plan'),
    live_send_gate_raw_phone_absent: !JSON.stringify(liveSendGate).includes('+17578312944'),
    live_send_gate_raw_body_absent: !JSON.stringify(liveSendGate).includes('Safe ClapCheeks no-send preflight for 757 sample. Do not reply.'),
    live_send_gate_body_sha256: redactedPlan.body_sha256 || null,
    live_send_gate_body_length: redactedPlan.body_length ?? null,
    no_click_performed: true,
    no_live_send_performed: true,
  })
})()
JS
}

dashboard_imessage_record_before_js() {
  cat <<'JS'
(() => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', '/api/imessage/test', false)
  xhr.send(null)
  const data = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {}
  const snapshot = {
    ok: xhr.status === 200,
    api_status: xhr.status,
    message_count: Array.isArray(data.messages) ? data.messages.length : null,
    self_test_recipient_last4: data?.self_test_recipient?.last4 || null,
    no_live_send_performed: true,
  }
  window.__clapcheeksSelfTestBefore = snapshot
  return JSON.stringify(snapshot)
})()
JS
}

dashboard_imessage_use_self_test_click_js() {
  cat <<'JS'
(() => {
  const button = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.includes('Use self-test'))
  if (!button || button.disabled) {
    const input = Array.from(document.querySelectorAll('input')).find((el) => el.type === 'tel')
    if (!input) return false
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
    descriptor?.set?.call(input, '+17578312944')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    window.__clapcheeksBrowserUsedSampleFallback = true
    return true
  }
  button.click()
  window.__clapcheeksBrowserUsedSampleFallback = false
  return true
})()
JS
}

dashboard_imessage_verify_click_js() {
  cat <<'JS'
(() => {
  const button = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.includes('Verify Test iMessage'))
  if (!button || button.disabled) return false
  button.click()
  return true
})()
JS
}

dashboard_imessage_dry_run_click_proof_js() {
  cat <<'JS'
(() => {
  const before = window.__clapcheeksSelfTestBefore || {}
  const xhr = new XMLHttpRequest()
  xhr.open('GET', '/api/imessage/test', false)
  xhr.send(null)
  const data = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {}
  const text = document.body.innerText || ''
  const afterCount = Array.isArray(data.messages) ? data.messages.length : null
  return JSON.stringify({
    ok: xhr.status === 200 &&
      text.includes('Dry run passed for 2944. No message was queued or sent.') &&
      before.message_count === afterCount,
    api_status: xhr.status,
    success_message_present: text.includes('Dry run passed for 2944. No message was queued or sent.'),
    before_message_count: before.message_count,
    after_message_count: afterCount,
    no_queue_delta: before.message_count === afterCount,
    self_test_recipient_last4: data?.self_test_recipient?.last4 || null,
    effective_recipient_last4: data?.self_test_recipient?.last4 || (window.__clapcheeksBrowserUsedSampleFallback === true ? '2944' : null),
    used_sample_fallback: window.__clapcheeksBrowserUsedSampleFallback === true,
    before_snapshot_recorded: before.ok === true,
    dry_run_click_performed: true,
    no_live_send_performed: true,
  })
})()
JS
}

scheduled_mobile_form_fill_js() {
  cat <<'JS'
(() => {
  const setNativeValue = (element, value) => {
    const prototype = Object.getPrototypeOf(element)
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const inputs = Array.from(document.querySelectorAll('input'))
  const textarea = document.querySelector('textarea')
  const select = document.querySelector('select')
  const nameInput = inputs.find((el) => el.placeholder?.includes('Sofia'))
  const phoneInput = inputs.find((el) => el.placeholder?.includes('+1619'))
  const dateInput = inputs.find((el) => el.type === 'datetime-local')
  const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 16)

  if (!nameInput || !phoneInput || !textarea || !dateInput || !select) {
    return JSON.stringify({
      ok: false,
      reason: 'missing compose controls',
      controls: {
        name: Boolean(nameInput),
        phone: Boolean(phoneInput),
        message: Boolean(textarea),
        scheduled_at: Boolean(dateInput),
        sequence_type: Boolean(select),
      },
    })
  }

  setNativeValue(nameInput, 'Safe E2E Sample 2944')
  setNativeValue(phoneInput, '+17578312944')
  setNativeValue(textarea, 'Safe mobile compose proof only. Do not send.')
  setNativeValue(dateInput, scheduledAt)
  setNativeValue(select, 'manual')

  const text = document.body.innerText || ''
  const overflowFree = document.documentElement.scrollWidth <= window.innerWidth + 6
  const scheduleButton = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.trim() === 'Schedule')

  return JSON.stringify({
    ok: nameInput.value === 'Safe E2E Sample 2944' &&
      phoneInput.value === '+17578312944' &&
      textarea.value === 'Safe mobile compose proof only. Do not send.' &&
      dateInput.value === scheduledAt &&
      select.value === 'manual' &&
      text.includes('44 characters') &&
      text.includes('Live delivery requires approval') &&
      Boolean(scheduleButton) &&
      overflowFree,
    no_submit_performed: true,
    no_live_send_performed: true,
    sample_last4: '2944',
    match_name_filled: nameInput.value === 'Safe E2E Sample 2944',
    phone_last4: phoneInput.value.replace(/\D/g, '').slice(-4),
    message_length: textarea.value.length,
    scheduled_at_filled: dateInput.value === scheduledAt,
    sequence_type: select.value,
    submit_button_present: Boolean(scheduleButton),
    overflow_x: !overflowFree,
  })
})()
JS
}

scheduled_api_binding_js() {
  cat <<'JS'
(() => {
  const countsXhr = new XMLHttpRequest()
  countsXhr.open('GET', '/api/scheduled-messages?status=all&limit=200', false)
  countsXhr.send(null)
  const countsData = countsXhr.status >= 200 && countsXhr.status < 300 ? JSON.parse(countsXhr.responseText) : {}
  const countMessages = Array.isArray(countsData.messages) ? countsData.messages : []
  const listXhr = new XMLHttpRequest()
  listXhr.open('GET', '/api/scheduled-messages?status=pending&limit=200', false)
  listXhr.send(null)
  const listData = listXhr.status >= 200 && listXhr.status < 300 ? JSON.parse(listXhr.responseText) : {}
  const pendingMessages = Array.isArray(listData.messages) ? listData.messages : []
  const counts = countMessages.reduce((acc, message) => {
    acc.total += 1
    acc[message.status] = (acc[message.status] || 0) + 1
    return acc
  }, { total: 0 })
  const text = document.body.innerText || ''
  const readCardValue = (label) => {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
    const labelIndex = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase())
    const parsedFromLine = Number(lines[labelIndex + 1])
    if (Number.isFinite(parsedFromLine)) return parsedFromLine
    const compactMatch = text.match(new RegExp(`${label}\\s+(\\d+)`, 'i'))
    if (compactMatch) {
      const parsed = Number(compactMatch[1])
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }
  const renderedCounts = {
    pending: readCardValue('Pending review'),
    approved: readCardValue('Approved'),
    sent: readCardValue('Sent'),
    failed: readCardValue('Failed'),
  }
  const expectedCounts = {
    pending: counts.pending || 0,
    approved: counts.approved || 0,
    sent: counts.sent || 0,
    failed: counts.failed || 0,
  }
  const missingFilters = ['pending', 'approved', 'sent', 'rejected', 'all']
    .filter((filter) => !Array.from(document.querySelectorAll('button')).some((button) => button.innerText.trim().toLowerCase() === filter))
  const pendingRowsVisible = pendingMessages.slice(0, 3).every((message) =>
    text.includes(message.match_name) &&
    text.includes(message.message_text) &&
    text.toLowerCase().includes('pending'),
  )
  const emptyPendingStateOk = pendingMessages.length === 0 && text.includes('No pending messages')
  const pendingBadgeOk = expectedCounts.pending > 0 ? text.includes(`${expectedCounts.pending} pending`) : true
  const countsMatch = Object.entries(expectedCounts)
    .every(([status, count]) => renderedCounts[status] === count)
  const overflowFree = document.documentElement.scrollWidth <= window.innerWidth + 6

  return JSON.stringify({
    ok: countsXhr.status === 200 &&
      listXhr.status === 200 &&
      countsMatch &&
      missingFilters.length === 0 &&
      pendingBadgeOk &&
      (pendingRowsVisible || emptyPendingStateOk) &&
      overflowFree,
    counts_api_status: countsXhr.status,
    list_api_status: listXhr.status,
    counts_source: '/api/scheduled-messages?status=all&limit=200',
    list_source: '/api/scheduled-messages?status=pending&limit=200',
    expected_counts: expectedCounts,
    rendered_counts: renderedCounts,
    counts_match: countsMatch,
    total_messages: countMessages.length,
    pending_rows_checked: Math.min(3, pendingMessages.length),
    pending_rows_visible: pendingRowsVisible,
    empty_pending_state_ok: emptyPendingStateOk,
    pending_badge_ok: pendingBadgeOk,
    missing_filters: missingFilters,
    overflow_x: !overflowFree,
    no_submit_performed: true,
    no_live_send_performed: true,
  })
})()
JS
}

scheduled_api_binding_ready_js() {
  cat <<'JS'
(() => {
  const text = document.body.innerText || ''
  if (text.includes('Loading...')) return false
  const readCardValue = (label) => {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
    const labelIndex = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase())
    const parsedFromLine = Number(lines[labelIndex + 1])
    if (Number.isFinite(parsedFromLine)) return parsedFromLine
    const compactMatch = text.match(new RegExp(`${label}\\s+(\\d+)`, 'i'))
    if (compactMatch) {
      const parsed = Number(compactMatch[1])
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }
  const renderedCounts = {
    pending: readCardValue('Pending review'),
    approved: readCardValue('Approved'),
    sent: readCardValue('Sent'),
    failed: readCardValue('Failed'),
  }
  return Object.values(renderedCounts).every((value) => Number.isFinite(value))
})()
JS
}

scheduled_review_fixture_create_js() {
  cat <<'JS'
(() => {
  const fixtureName = 'Safe E2E Browser Guardrail 2944'
  const scheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const create = new XMLHttpRequest()
  create.open('POST', '/api/scheduled-messages', false)
  create.setRequestHeader('Content-Type', 'application/json')
  create.send(JSON.stringify({
    match_name: fixtureName,
    platform: 'iMessage',
    phone: '+17578312944',
    message_text: 'Safe browser confirmation proof only. Do not send.',
    scheduled_at: scheduledAt,
    sequence_type: 'manual',
  }))
  const created = create.status >= 200 && create.status < 300 ? JSON.parse(create.responseText) : {}
  const id = created?.message?.id || created?.message?._id || null
  let approveStatus = null
  let approveBody = {}
  if (id) {
    const approve = new XMLHttpRequest()
    approve.open('PATCH', `/api/scheduled-messages/${id}`, false)
    approve.setRequestHeader('Content-Type', 'application/json')
    approve.send(JSON.stringify({ status: 'approved' }))
    approveStatus = approve.status
    approveBody = approve.status >= 200 && approve.status < 300 ? JSON.parse(approve.responseText) : {}
  }
  window.__clapcheeksScheduledGuardrailFixture = { id, fixtureName }
  localStorage.setItem('__clapcheeksScheduledGuardrailFixture', JSON.stringify({ id, fixtureName }))
  return JSON.stringify({
    ok: Boolean(id) && approveStatus >= 200 && approveStatus < 300 && approveBody?.message?.status === 'approved',
    id,
    fixture_name: fixtureName,
    create_status: create.status,
    approve_status: approveStatus,
    approved_status: approveBody?.message?.status || null,
    sample_last4: '2944',
    no_live_send_performed: true,
  })
})()
JS
}

scheduled_review_select_approved_js() {
  cat <<'JS'
(() => {
  const button = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.trim().toLowerCase() === 'approved')
  if (!button) return false
  button.click()
  return true
})()
JS
}

scheduled_review_open_send_modal_js() {
  cat <<'JS'
(() => {
  const stored = JSON.parse(localStorage.getItem('__clapcheeksScheduledGuardrailFixture') || '{}')
  const fixtureName = window.__clapcheeksScheduledGuardrailFixture?.fixtureName || stored.fixtureName || 'Safe E2E Browser Guardrail 2944'
  const belongsToFixture = (button) => {
    let node = button
    for (let i = 0; i < 8 && node; i += 1) {
      if ((node.innerText || '').includes(fixtureName)) return true
      node = node.parentElement
    }
    return false
  }
  const button = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.includes('Send now') && belongsToFixture(el))
  if (!button || button.disabled) return false
  button.click()
  return true
})()
JS
}

scheduled_review_modal_before_js() {
  cat <<'JS'
(() => {
  const text = document.body.innerText || ''
  const modal = Array.from(document.querySelectorAll('div[class*="fixed"][class*="inset-0"]')).find((el) => (el.innerText || '').includes('Confirm live send') && (el.innerText || '').includes('I reviewed the recipient, message, and timing.')) || null
  const modalSendButton = modal ? Array.from(modal.querySelectorAll('button')).find((el) => el.innerText.includes('Send now')) : null
  const checkbox = document.querySelector('input[type="checkbox"]')
  const phraseInput = Array.from(document.querySelectorAll('input')).find((el) => el.placeholder === 'Type SEND LIVE TO JULIAN') || null
  return JSON.stringify({
    ok: text.includes('Confirm live send') &&
      text.includes('This will hand the approved message to the local send path.') &&
      text.includes('I reviewed the recipient, message, and timing.') &&
      Boolean(checkbox) &&
      !phraseInput &&
      modalSendButton?.disabled === true,
    modal_present: text.includes('Confirm live send'),
    review_checkbox_present: Boolean(checkbox),
    phrase_hidden_before_review: !phraseInput,
    send_disabled_before_review: modalSendButton?.disabled === true,
    no_live_send_performed: true,
  })
})()
JS
}

scheduled_review_click_checkbox_js() {
  cat <<'JS'
(() => {
  const checkbox = document.querySelector('input[type="checkbox"]')
  if (!checkbox) return false
  checkbox.click()
  return true
})()
JS
}

scheduled_review_modal_wrong_phrase_js() {
  cat <<'JS'
(() => {
  const setNativeValue = (element, value) => {
    const prototype = Object.getPrototypeOf(element)
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const phraseInput = Array.from(document.querySelectorAll('input')).find((el) => el.placeholder === 'Type SEND LIVE TO JULIAN') || null
  if (phraseInput) setNativeValue(phraseInput, 'SEND SAFE')
  const modal = Array.from(document.querySelectorAll('div[class*="fixed"][class*="inset-0"]')).find((el) => (el.innerText || '').includes('Confirm live send') && (el.innerText || '').includes('I reviewed the recipient, message, and timing.')) || null
  const modalSendButton = modal ? Array.from(modal.querySelectorAll('button')).find((el) => el.innerText.includes('Send now')) : null
  const text = document.body.innerText || ''
  return JSON.stringify({
    ok: text.includes('Confirm live send') &&
      Boolean(phraseInput) &&
      phraseInput.value === 'SEND SAFE' &&
      modalSendButton?.disabled === true,
    phrase_input_present_after_review: Boolean(phraseInput),
    wrong_phrase_value: phraseInput?.value || null,
    send_disabled_with_wrong_phrase: modalSendButton?.disabled === true,
    exact_live_phrase_not_entered: phraseInput?.value !== 'SEND LIVE TO JULIAN',
    send_button_clicked: false,
    no_live_send_performed: true,
  })
})()
JS
}

scheduled_review_fixture_cleanup_js() {
  cat <<'JS'
(() => {
  const stored = JSON.parse(localStorage.getItem('__clapcheeksScheduledGuardrailFixture') || '{}')
  const fixture = window.__clapcheeksScheduledGuardrailFixture || stored || {}
  if (!fixture.id) {
    return JSON.stringify({
      ok: false,
      reason: 'missing_fixture_id',
      no_live_send_performed: true,
    })
  }
  const cancel = new XMLHttpRequest()
  cancel.open('DELETE', `/api/scheduled-messages/${fixture.id}`, false)
  cancel.send(null)
  const body = cancel.status >= 200 && cancel.status < 300 ? JSON.parse(cancel.responseText) : {}
  localStorage.removeItem('__clapcheeksScheduledGuardrailFixture')
  return JSON.stringify({
    ok: cancel.status >= 200 && cancel.status < 300 && body?.message?.status === 'failed',
    id: fixture.id,
    fixture_name: fixture.fixtureName || null,
    cancel_status: cancel.status,
    final_status: body?.message?.status || null,
    rejection_reason: body?.message?.rejection_reason || null,
    no_live_send_performed: true,
  })
})()
JS
}

intelligence_api_binding_js() {
  cat <<'JS'
(() => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', '/api/analytics/summary?days=30', false)
  xhr.send(null)
  const summary = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {}
  const totals = summary?.totals || {}
  const opened = totals.messages_sent || totals.conversations || totals.matches || 0
  const replied = totals.conversations || 0
  const booked = totals.dates_booked || 0
  const dateReady = Math.max(booked, Math.round(replied * 0.3))
  const replyDenom = totals.messages_sent || opened || 0
  const replyRate = replyDenom > 0 ? Math.round((replied / replyDenom) * 100) : 0
  const text = document.body.innerText || ''
  const lowerText = text.toLowerCase()
  const requiredValues = [replyRate, opened, replied, dateReady, booked].map(String)
  const requiredLabels = ['Conversation Intelligence', 'Opener Performance', 'Conversation Funnel', 'Opened', 'Replied', 'Date-ready', 'Booked']
  const missingValues = requiredValues.filter((value) => !text.includes(value))
  const missingLabels = requiredLabels.filter((label) => !lowerText.includes(label.toLowerCase()))
  return JSON.stringify({
    ok: missingValues.length === 0 && missingLabels.length === 0,
    source: '/api/analytics/summary?days=30',
    missing_values: missingValues,
    missing_labels: missingLabels,
    expected: {
      reply_rate_percent: replyRate,
      opened,
      replied,
      date_ready: dateReady,
      booked,
      matches: totals.matches ?? null,
      conversations: totals.conversations ?? null,
      messages_sent: totals.messages_sent ?? null,
      dates_booked: totals.dates_booked ?? null,
    },
    text_length: text.length,
    no_live_send_performed: true,
  })
})()
JS
}

analytics_mobile_api_binding_js() {
  cat <<'JS'
(() => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', '/api/analytics/summary?days=30', false)
  xhr.send(null)
  const summary = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {}
  const totals = summary?.totals || {}
  const text = document.body.innerText || ''
  const lowerText = text.toLowerCase()
  const matchRate = totals.swipes_right > 0 ? `${((totals.matches / totals.swipes_right) * 100).toFixed(1)}%` : '0%'
  const requiredLabels = [
    'Analytics',
    'Back to Dashboard',
    'Total Swipes',
    'Matches',
    'Dates Booked',
    'Match Rate',
    'Rizz Score',
    'Swipes & Matches',
    'Platform Breakdown',
    'Conversion Funnel',
  ]
  if (Number(summary?.spending?.totalSpent || 0) > 0) requiredLabels.push('Spend Tracker')
  const requiredValues = [
    String(totals.swipes_right ?? ''),
    String(totals.matches ?? ''),
    String(totals.dates_booked ?? ''),
    matchRate,
    String(summary?.rizzScore ?? ''),
  ].filter(Boolean)
  const missingLabels = requiredLabels.filter((label) => !lowerText.includes(label.toLowerCase()))
  const missingValues = requiredValues.filter((value) => !text.includes(value))
  const overflowFree = document.documentElement.scrollWidth <= window.innerWidth + 6

  return JSON.stringify({
    ok: xhr.status === 200 &&
      missingLabels.length === 0 &&
      missingValues.length === 0 &&
      overflowFree,
    source: '/api/analytics/summary?days=30',
    api_status: xhr.status,
    missing_labels: missingLabels,
    missing_values: missingValues,
    expected: {
      swipes_right: totals.swipes_right ?? null,
      matches: totals.matches ?? null,
      dates_booked: totals.dates_booked ?? null,
      conversations: totals.conversations ?? null,
      match_rate_display: matchRate,
      rizz_score: summary?.rizzScore ?? null,
      platform_count: summary?.platforms && typeof summary.platforms === 'object' ? Object.keys(summary.platforms).length : null,
      time_series_rows: Array.isArray(summary?.timeSeries) ? summary.timeSeries.length : null,
      funnel_stages: Array.isArray(summary?.funnel) ? summary.funnel.map((item) => item.stage) : [],
    },
    overflow_x: !overflowFree,
    text_length: text.length,
    no_live_send_performed: true,
  })
})()
JS
}

device_control_safety_js() {
  cat <<'JS'
(() => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', '/api/device-control/status', false)
  xhr.send(null)
  const status = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {}
  const text = document.body.innerText || ''
  const lowerText = text.toLowerCase()
  const buttons = Array.from(document.querySelectorAll('button')).map((button) => button.innerText.trim())
  const requiredText = [
    'Runtime readiness',
    'Always-On Device Add-On',
    'iPhone device control',
    'Physical PNG proof must pass',
    'Queue observe',
    'Queue PNG proof',
    'Queue all-platform proof',
    'Post-unlock proof runner',
    'Inbound watcher unblock',
    'TCC python:',
    'Full Disk Access TCC:',
    'repair-inbound-watcher-fda.sh',
    'open-inbound-watcher-fda-settings.sh',
    'tech.clapcheeks.inbound-watcher',
    'npm run test:e2e:runtime',
  ]
  const missingText = requiredText.filter((item) => !lowerText.includes(item.toLowerCase()))
  const safety = status?.safety || {}
  const physical = status?.physical_ios || {}
  const inboundWatcher = status?.inbound_watcher || {}
  const terminalProof = inboundWatcher?.terminal_read_proof || {}
  const tcc = inboundWatcher?.tcc || {}
  const inboundWatcherDiagnosticState = inboundWatcher.ok === false &&
    inboundWatcher.blocker === 'full_disk_access_missing' &&
    tcc.python_authorized === false &&
    tcc.python_denied_or_off === true
  const inboundWatcherHealthyState = inboundWatcher.ok === true &&
    tcc.python_authorized === true
  const queueButtonsPresent = {
    observe: buttons.includes('Queue observe'),
    proof: buttons.includes('Queue PNG proof'),
    proof_all: buttons.includes('Queue all-platform proof'),
  }
  const overflowFree = document.documentElement.scrollWidth <= window.innerWidth + 6

  return JSON.stringify({
    ok: xhr.status === 200 &&
      missingText.length === 0 &&
      safety.personal_line_blocked === true &&
      safety.live_swipes_require_approval === true &&
      safety.live_messages_require_approval === true &&
      safety.outbound_send_requires_second_confirmation === true &&
      safety.approval_failures_fail_closed === true &&
      physical.selected_line === 2 &&
      (inboundWatcherDiagnosticState || inboundWatcherHealthyState) &&
      terminalProof.ok === true &&
      terminalProof.no_send === true &&
      terminalProof.mutation === false &&
      Number(tcc.python_row_count || 0) >= 1 &&
      String(inboundWatcher.unblock_command || '').includes('open-inbound-watcher-fda-settings.sh') &&
      String(inboundWatcher.repair_verify_command || '').includes('repair-inbound-watcher-fda.sh') &&
      String(inboundWatcher.restart_command || '').includes('tech.clapcheeks.inbound-watcher') &&
      String(inboundWatcher.verify_command || '').includes('npm run test:e2e:runtime') &&
      queueButtonsPresent.observe &&
      queueButtonsPresent.proof &&
      queueButtonsPresent.proof_all &&
      overflowFree,
    api_status: xhr.status,
    missing_text: missingText,
    selected_line: physical.selected_line ?? null,
    current_blocker: physical.current_blocker || null,
    selected_device: physical.selected_device || null,
    observed_connection: physical.observed_connection || null,
    latest_known_blockers: physical.latest_known_blockers || [],
    inbound_watcher: {
      ok: inboundWatcher.ok === true,
      blocker: inboundWatcher.blocker || null,
      terminal_proof_ok: terminalProof.ok === true,
      terminal_proof_count: terminalProof.count ?? null,
      no_send: terminalProof.no_send === true,
      mutation: terminalProof.mutation === true,
      tcc_python_authorized: tcc.python_authorized === true,
      tcc_python_denied_or_off: tcc.python_denied_or_off === true,
      tcc_python_row_count: tcc.python_row_count ?? null,
      tcc_real_python: tcc.real_python || null,
      repair_verify_command_present: String(inboundWatcher.repair_verify_command || '').includes('repair-inbound-watcher-fda.sh'),
      unblock_command_present: String(inboundWatcher.unblock_command || '').includes('open-inbound-watcher-fda-settings.sh'),
      restart_command_present: String(inboundWatcher.restart_command || '').includes('tech.clapcheeks.inbound-watcher'),
      verify_command_present: String(inboundWatcher.verify_command || '').includes('npm run test:e2e:runtime'),
    },
    safety,
    queue_buttons_present: queueButtonsPresent,
    no_queue_click_performed: true,
    no_live_action_performed: true,
    no_live_send_performed: true,
    overflow_x: !overflowFree,
  })
})()
JS
}

assert_page_state() {
  local name="$1"
  local js="$2"
  local reload_path="${3:-}"
  local result
  result="false"
  for attempt in $(seq 1 60); do
    result="$(chrome_eval "$js")"
    if [[ "$result" == "true" ]]; then
      break
    fi
    if [[ -n "$reload_path" && ( "$attempt" == "20" || "$attempt" == "40" ) ]]; then
      chrome_eval "(() => { const text = document.body?.innerText || ''; if (!text.trim() || text.includes('This page could not be found.')) location.href = '${BASE_URL}${reload_path}'; return true; })()" >/dev/null || true
    fi
    sleep 0.5
  done
  if [[ "$result" != "true" ]]; then
    local failure_name
    failure_name="$(echo "$name" | tr ' /' '--')"
    screencapture -x "${OUT_DIR}/failed-${failure_name}-2026-05-18.png" >/dev/null 2>&1 || true
    echo "Visual browser assertion failed for ${name}: ${result}" >&2
    exit 1
  fi
  echo "[ok] ${name}"
}

wait_for_route "/dashboard"
wait_for_route "/scheduled"
wait_for_route "/intelligence"
wait_for_route "/device"
wait_for_route "/api/analytics/summary?days=30"
wait_for_route "/api/imessage/test"

chrome_open "/dashboard" 0 0 1280 900
sleep 3
assert_page_state "dashboard desktop" "(() => document.body.innerText.includes('ROSTER COMMAND CENTER') && document.body.innerText.includes('Quick actions'))()"
assert_page_state "dashboard hydrated navigation" "(() => document.querySelectorAll('a').length >= 12 && document.body.innerText.includes('Quick actions'))()"
capture_json "dashboard-navigation-proof" "$(dashboard_navigation_integrity_js)"
node - "${OUT_DIR}/dashboard-navigation-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] dashboard navigation integrity')
NODE
capture_json "dashboard-health-blockers-proof" "$(dashboard_health_blockers_js)"
node - "${OUT_DIR}/dashboard-health-blockers-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true || proof.no_token_values_present !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] dashboard health blockers quick view')
NODE
assert_page_state "dashboard imessage self-test surface ready" "(() => { const text = document.body.innerText || ''; return text.includes('Test iMessage Automation') && text.includes('Dry run only. Validate the phone and queue shape without sending.') && text.includes('Final live-send gate') && text.includes('Preflight freshness') && text.includes('SEND LIVE TO JULIAN') && text.includes('docs/e2e-live-send-runbook.md'); })()" "/dashboard"
capture_json "dashboard-imessage-self-test-proof" "$(dashboard_imessage_self_test_js)"
node - "${OUT_DIR}/dashboard-imessage-self-test-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] dashboard imessage self-test dry-run surface')
NODE
capture_json "dashboard-imessage-dry-run-before" "$(dashboard_imessage_record_before_js)"
if [[ "$(chrome_eval "$(dashboard_imessage_use_self_test_click_js)")" != "true" ]]; then
  echo "Unable to select dashboard iMessage self-test recipient" >&2
  exit 1
fi
assert_page_state "dashboard imessage self-test selected" "(() => document.body.innerText.includes('Using self-test') || Array.from(document.querySelectorAll('input')).some((el) => el.type === 'tel' && el.value.replace(/\\D/g, '').endsWith('7578312944')))()"
if [[ "$(chrome_eval "$(dashboard_imessage_verify_click_js)")" != "true" ]]; then
  echo "Unable to click dashboard iMessage dry-run verifier" >&2
  exit 1
fi
assert_page_state "dashboard imessage dry-run click" "(() => document.body.innerText.includes('Dry run passed for 2944. No message was queued or sent.'))()"
capture_json "dashboard-imessage-dry-run-click-proof" "$(dashboard_imessage_dry_run_click_proof_js)"
node - "${OUT_DIR}/dashboard-imessage-dry-run-click-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] dashboard imessage dry-run click no-queue')
NODE
capture "${OUT_DIR}/dashboard-desktop-2026-05-18.png"

chrome_open "/dashboard" 0 0 430 900
sleep 3
assert_page_state "dashboard mobile quick view" "(() => document.body.innerText.includes('ROSTER COMMAND CENTER') && document.body.innerText.includes('Quick actions') && document.documentElement.scrollWidth <= window.innerWidth + 6)()" "/dashboard"
capture_metrics "dashboard-mobile" "$(mobile_metric_js dashboard_mobile)"
capture "${OUT_DIR}/dashboard-mobile-2026-05-18.png"

chrome_open "/device" 0 0 430 900
sleep 3
chrome_eval "(() => { const target = Array.from(document.querySelectorAll('section, div')).find((el) => (el.innerText || '').includes('iPhone device control')); if (target) target.scrollIntoView({ block: 'start' }); return Boolean(target); })()" >/dev/null
sleep 1
assert_page_state "device mobile runtime safety" "(() => { const text = document.body.innerText; return text.includes('Runtime readiness') && text.includes('iPhone device control') && text.includes('Physical PNG proof must pass') && document.documentElement.scrollWidth <= window.innerWidth + 6; })()" "/device"
assert_page_state "device inbound watcher TCC proof" "(() => { const text = document.body.innerText || ''; const lowerText = text.toLowerCase(); return lowerText.includes('inbound watcher unblock') && text.includes('TCC python:') && text.includes('Full Disk Access TCC:') && document.documentElement.scrollWidth <= window.innerWidth + 6; })()" "/device"
capture_json "device-control-safety-proof" "$(device_control_safety_js)"
node - "${OUT_DIR}/device-control-safety-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] device control mobile safety surface')
NODE
capture_metrics "device-mobile" "$(mobile_metric_js device_mobile)"
capture "${OUT_DIR}/device-mobile-2026-05-18.png"

chrome_open "/scheduled" 0 0 430 900
sleep 3
assert_page_state "scheduled mobile quick view" "(() => document.body.innerText.includes('Scheduled Messages') && document.body.innerText.includes('+ Schedule Message') && document.documentElement.scrollWidth <= window.innerWidth + 6)()" "/scheduled"
assert_page_state "scheduled api-bound cards hydrated" "$(scheduled_api_binding_ready_js)" "/scheduled"
capture_json "scheduled-api-binding-proof" "$(scheduled_api_binding_js)"
node - "${OUT_DIR}/scheduled-api-binding-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] scheduled ui api-bound values')
NODE
capture_metrics "scheduled-mobile" "$(mobile_metric_js scheduled_mobile)"
capture "${OUT_DIR}/scheduled-mobile-2026-05-18.png"

chrome_eval "(() => { const button = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.includes('Schedule Message')); if (!button) return false; button.click(); return true; })()" >/dev/null
sleep 1
assert_page_state "scheduled mobile modal" "(() => document.body.innerText.includes('Schedule a Message') && document.body.innerText.includes('Created as pending review') && document.body.innerText.includes('Live delivery requires approval'))()"
capture_json "scheduled-mobile-form-proof" "$(scheduled_mobile_form_fill_js)"
assert_page_state "scheduled mobile form fill no-send" "(() => { const text = document.body.innerText; const inputs = Array.from(document.querySelectorAll('input')); const phone = inputs.find((el) => el.value === '+17578312944'); const name = inputs.find((el) => el.value === 'Safe E2E Sample 2944'); const dt = inputs.find((el) => el.type === 'datetime-local' && el.value); const message = document.querySelector('textarea')?.value; return Boolean(phone && name && dt) && message === 'Safe mobile compose proof only. Do not send.' && text.includes('44 characters') && text.includes('Live delivery requires approval') && document.documentElement.scrollWidth <= window.innerWidth + 6; })()"
capture_metrics "scheduled-mobile-modal" "$(mobile_metric_js scheduled_mobile_modal)"
capture "${OUT_DIR}/scheduled-mobile-modal-2026-05-18.png"

chrome_open "/scheduled" 0 0 430 900
sleep 3
assert_page_state "scheduled mobile quick view before send guardrail" "(() => document.body.innerText.includes('Scheduled Messages') && document.body.innerText.includes('+ Schedule Message') && document.documentElement.scrollWidth <= window.innerWidth + 6)()" "/scheduled"
capture_json "scheduled-send-confirmation-fixture" "$(scheduled_review_fixture_create_js)"
node - "${OUT_DIR}/scheduled-send-confirmation-fixture.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] scheduled send confirmation fixture approved')
NODE
chrome_eval "location.href = '${BASE_URL}/scheduled?filter=approved'" >/dev/null
sleep 3
assert_page_state "scheduled approved fixture visible" "(() => document.body.innerText.includes('Safe E2E Browser Guardrail 2944') && document.body.innerText.includes('Send now'))()" "/scheduled?filter=approved"
if [[ "$(chrome_eval "$(scheduled_review_open_send_modal_js)")" != "true" ]]; then
  echo "Unable to open scheduled send confirmation modal" >&2
  capture_json "scheduled-send-confirmation-cleanup" "$(scheduled_review_fixture_cleanup_js)" || true
  exit 1
fi
assert_page_state "scheduled send confirmation modal" "(() => document.body.innerText.includes('Confirm live send') && document.body.innerText.includes('I reviewed the recipient, message, and timing.'))()"
capture_json "scheduled-send-confirmation-before-proof" "$(scheduled_review_modal_before_js)"
if [[ "$(chrome_eval "$(scheduled_review_click_checkbox_js)")" != "true" ]]; then
  echo "Unable to check scheduled send review checkbox" >&2
  capture_json "scheduled-send-confirmation-cleanup" "$(scheduled_review_fixture_cleanup_js)" || true
  exit 1
fi
assert_page_state "scheduled send phrase input visible" "(() => Boolean(Array.from(document.querySelectorAll('input')).find((el) => el.placeholder === 'Type SEND LIVE TO JULIAN')))()"
capture_json "scheduled-send-confirmation-guardrail-proof" "$(scheduled_review_modal_wrong_phrase_js)"
node - "${OUT_DIR}/scheduled-send-confirmation-before-proof.json" "${OUT_DIR}/scheduled-send-confirmation-guardrail-proof.json" <<'NODE'
const fs = require('node:fs')
const [beforePath, guardrailPath] = process.argv.slice(2)
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
const guardrail = JSON.parse(fs.readFileSync(guardrailPath, 'utf8'))
if (before.ok !== true || guardrail.ok !== true) {
  console.error(JSON.stringify({ before, guardrail }, null, 2))
  process.exit(1)
}
console.log('[ok] scheduled send confirmation guardrails')
NODE
capture_metrics "scheduled-send-confirmation-modal" "$(mobile_metric_js scheduled_send_confirmation_modal)"
capture "${OUT_DIR}/scheduled-send-confirmation-modal-2026-05-18.png"
capture_json "scheduled-send-confirmation-cleanup" "$(scheduled_review_fixture_cleanup_js)"
node - "${OUT_DIR}/scheduled-send-confirmation-cleanup.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const cleanup = JSON.parse(fs.readFileSync(path, 'utf8'))
if (cleanup.ok !== true) {
  console.error(JSON.stringify(cleanup, null, 2))
  process.exit(1)
}
console.log('[ok] scheduled send confirmation fixture cleanup')
NODE

chrome_open "/intelligence" 0 0 1280 900
sleep 3
assert_page_state "intelligence desktop" "(() => { const text = document.body.innerText.toLowerCase(); return text.includes('conversation intelligence') && text.includes('opener performance') && text.includes('conversation funnel'); })()" "/intelligence"
capture_json "intelligence-api-binding-proof" "$(intelligence_api_binding_js)"
node - "${OUT_DIR}/intelligence-api-binding-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] intelligence api-bound values')
NODE
capture "${OUT_DIR}/intelligence-desktop-2026-05-18.png"

chrome_open "/intelligence" 0 0 430 900
sleep 3
assert_page_state "intelligence mobile quick view" "(() => { const text = document.body.innerText.toLowerCase(); return text.includes('conversation intelligence') && text.includes('opener performance') && text.includes('conversation funnel') && document.documentElement.scrollWidth <= window.innerWidth + 6; })()" "/intelligence"
capture_metrics "intelligence-mobile" "$(mobile_metric_js intelligence_mobile)"
capture "${OUT_DIR}/intelligence-mobile-2026-05-18.png"

chrome_open "/analytics" 0 0 430 900
sleep 3
assert_page_state "analytics mobile quick view" "(() => { const text = document.body.innerText.toLowerCase(); return text.includes('analytics') && text.includes('total swipes') && text.includes('rizz score') && text.includes('conversion funnel') && document.documentElement.scrollWidth <= window.innerWidth + 6; })()" "/analytics"
capture_json "analytics-mobile-api-binding-proof" "$(analytics_mobile_api_binding_js)"
node - "${OUT_DIR}/analytics-mobile-api-binding-proof.json" <<'NODE'
const fs = require('node:fs')
const [path] = process.argv.slice(2)
const proof = JSON.parse(fs.readFileSync(path, 'utf8'))
if (proof.ok !== true) {
  console.error(JSON.stringify(proof, null, 2))
  process.exit(1)
}
console.log('[ok] analytics mobile api-bound values')
NODE
capture_metrics "analytics-mobile" "$(mobile_metric_js analytics_mobile)"
capture "${OUT_DIR}/analytics-mobile-2026-05-18.png"

node - "$BASE_URL" "$MANIFEST" "$OUT_DIR" <<'NODE'
const fs = require('node:fs')

const [base, manifest, outDir] = process.argv.slice(2)

async function main() {
  const mobileMetricFiles = {
    dashboard_mobile: `${outDir}/dashboard-mobile-metrics.json`,
    device_mobile: `${outDir}/device-mobile-metrics.json`,
    scheduled_mobile: `${outDir}/scheduled-mobile-metrics.json`,
    scheduled_mobile_modal: `${outDir}/scheduled-mobile-modal-metrics.json`,
    scheduled_send_confirmation_modal: `${outDir}/scheduled-send-confirmation-modal-metrics.json`,
    intelligence_mobile: `${outDir}/intelligence-mobile-metrics.json`,
    analytics_mobile: `${outDir}/analytics-mobile-metrics.json`,
  }
  const scheduledMobileForm = JSON.parse(fs.readFileSync(`${outDir}/scheduled-mobile-form-proof.json`, 'utf8'))
  const scheduledSendConfirmationFixture = JSON.parse(fs.readFileSync(`${outDir}/scheduled-send-confirmation-fixture.json`, 'utf8'))
  const scheduledSendConfirmationBefore = JSON.parse(fs.readFileSync(`${outDir}/scheduled-send-confirmation-before-proof.json`, 'utf8'))
  const scheduledSendConfirmationGuardrail = JSON.parse(fs.readFileSync(`${outDir}/scheduled-send-confirmation-guardrail-proof.json`, 'utf8'))
  const scheduledSendConfirmationCleanup = JSON.parse(fs.readFileSync(`${outDir}/scheduled-send-confirmation-cleanup.json`, 'utf8'))
  const scheduledApiBinding = JSON.parse(fs.readFileSync(`${outDir}/scheduled-api-binding-proof.json`, 'utf8'))
  const intelligenceApiBinding = JSON.parse(fs.readFileSync(`${outDir}/intelligence-api-binding-proof.json`, 'utf8'))
  const analyticsMobileApiBinding = JSON.parse(fs.readFileSync(`${outDir}/analytics-mobile-api-binding-proof.json`, 'utf8'))
  const deviceControlSafety = JSON.parse(fs.readFileSync(`${outDir}/device-control-safety-proof.json`, 'utf8'))
  const dashboardNavigation = JSON.parse(fs.readFileSync(`${outDir}/dashboard-navigation-proof.json`, 'utf8'))
  const dashboardHealthBlockers = JSON.parse(fs.readFileSync(`${outDir}/dashboard-health-blockers-proof.json`, 'utf8'))
  const dashboardIMessageSelfTest = JSON.parse(fs.readFileSync(`${outDir}/dashboard-imessage-self-test-proof.json`, 'utf8'))
  const dashboardIMessageDryRunClick = JSON.parse(fs.readFileSync(`${outDir}/dashboard-imessage-dry-run-click-proof.json`, 'utf8'))
  const mobileMetrics = Object.fromEntries(
    Object.entries(mobileMetricFiles).map(([key, file]) => [key, JSON.parse(fs.readFileSync(file, 'utf8'))]),
  )
  const mobileMetricsOverflowFree = Object.values(mobileMetrics).every((metric) => metric.overflow_x === false)

  const analytics = await fetch(`${base}/api/analytics/summary?days=30`).then((res) => {
    if (!res.ok) throw new Error(`analytics status ${res.status}`)
    return res.json()
  })
  const imessage = await fetch(`${base}/api/imessage/test`).then((res) => {
    if (!res.ok) throw new Error(`imessage metadata status ${res.status}`)
    return res.json()
  })

  const evidence = {
    ok: true,
    generated_at: new Date().toISOString(),
    base,
    browser: 'Google Chrome via AppleScript and screencapture',
    no_live_send_performed: true,
    checks: {
      dashboard_desktop: true,
      dashboard_navigation_integrity: dashboardNavigation.ok === true,
      dashboard_navigation: dashboardNavigation,
      dashboard_health_blockers_quick_view: dashboardHealthBlockers.ok === true,
      dashboard_health_blockers: dashboardHealthBlockers,
      dashboard_imessage_self_test_surface: dashboardIMessageSelfTest.ok === true,
      dashboard_imessage_self_test: dashboardIMessageSelfTest,
      dashboard_imessage_dry_run_click: dashboardIMessageDryRunClick.ok === true,
      dashboard_imessage_dry_run: dashboardIMessageDryRunClick,
      dashboard_mobile_quick_view: true,
      device_mobile_quick_view: true,
      device_control_safety_surface: deviceControlSafety.ok === true,
      device_control_status: deviceControlSafety,
      scheduled_mobile_quick_view: true,
      scheduled_ui_matches_api: scheduledApiBinding.ok === true,
      scheduled_api_binding: scheduledApiBinding,
      scheduled_mobile_modal: true,
      scheduled_mobile_form_filled: scheduledMobileForm.ok === true,
      scheduled_mobile_form_no_submit: scheduledMobileForm.no_submit_performed === true,
      scheduled_mobile_form: scheduledMobileForm,
      scheduled_send_confirmation_guardrail: scheduledSendConfirmationFixture.ok === true &&
        scheduledSendConfirmationBefore.ok === true &&
        scheduledSendConfirmationGuardrail.ok === true &&
        scheduledSendConfirmationCleanup.ok === true,
      scheduled_send_confirmation: {
        fixture: scheduledSendConfirmationFixture,
        before: scheduledSendConfirmationBefore,
        guardrail: scheduledSendConfirmationGuardrail,
        cleanup: scheduledSendConfirmationCleanup,
      },
      intelligence_desktop: true,
      intelligence_ui_matches_api: intelligenceApiBinding.ok === true,
      intelligence_api_binding: intelligenceApiBinding,
      intelligence_mobile_quick_view: true,
      analytics_mobile_quick_view: true,
      analytics_mobile_ui_matches_api: analyticsMobileApiBinding.ok === true,
      analytics_mobile_api_binding: analyticsMobileApiBinding,
      mobile_metrics_overflow_free: mobileMetricsOverflowFree,
      mobile_metrics: mobileMetrics,
      analytics_summary: {
        matches: analytics?.totals?.matches,
        conversations: analytics?.totals?.conversations,
        funnel_steps: Array.isArray(analytics?.funnel) ? analytics.funnel.length : null,
      },
      imessage_self_test_recipient: imessage?.self_test_recipient || null,
    },
    screenshots: [
      `${outDir}/dashboard-desktop-2026-05-18.png`,
      `${outDir}/dashboard-mobile-2026-05-18.png`,
      `${outDir}/device-mobile-2026-05-18.png`,
      `${outDir}/scheduled-mobile-2026-05-18.png`,
      `${outDir}/scheduled-mobile-modal-2026-05-18.png`,
      `${outDir}/scheduled-send-confirmation-modal-2026-05-18.png`,
      `${outDir}/intelligence-desktop-2026-05-18.png`,
      `${outDir}/intelligence-mobile-2026-05-18.png`,
      `${outDir}/analytics-mobile-2026-05-18.png`,
    ],
  }

  fs.writeFileSync(manifest, JSON.stringify(evidence, null, 2))
  console.log(`Evidence: ${manifest}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
NODE
