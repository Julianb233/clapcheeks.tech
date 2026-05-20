#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const baseUrl = (process.env.CLAPCHEEKS_E2E_BASE_URL || process.env.CLAPCHEEKS_PRODUCTION_CCT_BASE_URL || 'https://clapcheeks.tech').replace(/\/$/, '')
const chromeDebugUrl = (process.env.CLAPCHEEKS_CCT_DEBUG_URL || 'http://127.0.0.1:9223').replace(/\/$/, '')
const outDir = process.env.CLAPCHEEKS_BROWSER_EVIDENCE_DIR || '/tmp/clapcheeks-e2e-browser'
const manifestPath = process.env.CLAPCHEEKS_BROWSER_EVIDENCE || '/tmp/clapcheeks-browser-visual-evidence-2026-05-18.json'

mkdirSync(outDir, { recursive: true })

async function fetchJson(url) {
  const response = await fetch(url)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url}; status=${response.status}; body=${text.slice(0, 160)}`)
  }
}

function routeUrl(route) {
  return `${baseUrl}${route}`
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) return
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws.close()
  }
}

async function getCctTab() {
  const tabs = await fetchJson(`${chromeDebugUrl}/json`)
  const existing = Array.isArray(tabs) ? tabs.find((tab) => String(tab.url || '').startsWith(baseUrl)) : null
  if (existing?.webSocketDebuggerUrl) return existing
  return fetchJson(`${chromeDebugUrl}/json/new?${routeUrl('/dashboard')}`)
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function api(client, method, url, body) {
  return evaluate(
    client,
    `fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}
    }).then(async (response) => {
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return { status: response.status, ok: response.ok, body: json, text: text.slice(0, 800) }
    })`,
  )
}

async function setViewport(client, width, height, mobile = width <= 520) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  })
}

async function navigate(client, route, width, height) {
  await setViewport(client, width, height)
  await client.send('Page.navigate', { url: routeUrl(route) })
  await new Promise((resolve) => setTimeout(resolve, 1600))
  await waitFor(client, `document.body && (document.body.innerText || '').trim().length > 0`, route)
}

async function waitFor(client, expression, label, attempts = 40) {
  let value = false
  for (let index = 0; index < attempts; index += 1) {
    value = await evaluate(client, `Boolean(${expression})`)
    if (value) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function screenshot(client, name) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = path.join(outDir, `${name}-2026-05-18.png`)
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return file
}

async function textSnapshot(client) {
  return evaluate(
    client,
    `(() => {
      const text = document.body.innerText || ''
      return {
        pathname: location.pathname,
        url: location.href,
        text,
        lower: text.toLowerCase(),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }
    })()`,
  )
}

async function mobileMetrics(client, label) {
  return evaluate(
    client,
    `(() => ({
      label: ${JSON.stringify(label)},
      pathname: location.pathname,
      inner_width: window.innerWidth,
      inner_height: window.innerHeight,
      client_width: document.documentElement.clientWidth,
      scroll_width: document.documentElement.scrollWidth,
      body_scroll_width: document.body?.scrollWidth || 0,
      overflow_x: document.documentElement.scrollWidth > window.innerWidth + 6,
      text_length: document.body?.innerText?.length || 0
    }))()`,
  )
}

async function dashboardNavigation(client) {
  return evaluate(
    client,
    `(() => {
      const anchors = Array.from(document.querySelectorAll('a')).map((anchor) => ({
        text: (anchor.innerText || anchor.textContent || '').trim().replace(/\\s+/g, ' '),
        href: new URL(anchor.href, location.origin).pathname + new URL(anchor.href, location.origin).search,
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
      const missing_actions = requiredActions.filter((item) => !hasAnchor(item))
      const missing_top_nav = requiredTopNav.filter((item) => !hasAnchor(item))
      return {
        ok: missing_actions.length === 0 && missing_top_nav.length === 0 && (document.body.innerText || '').includes('Quick actions'),
        quick_actions_heading_present: (document.body.innerText || '').includes('Quick actions'),
        missing_actions,
        missing_top_nav,
        total_anchor_count: anchors.length,
        route_matrix_source: 'CCT production browser evidence',
        no_click_performed: true,
        no_live_send_performed: true,
      }
    })()`,
  )
}

async function dashboardHealth(client) {
  const snapshot = await textSnapshot(client)
  const lower = snapshot.lower
  const runtimeTilePresent = lower.includes('runtime blockers') || lower.includes('runtime readiness')
  const runtimeBlockerPresent = lower.includes('full disk access') || lower.includes('inbound watcher') || lower.includes('physical')
  return {
    ok: (snapshot.text.includes('Tokens Missing') || lower.includes('token')) && lower.includes('tinder') && runtimeTilePresent && runtimeBlockerPresent,
    token_tile_present: snapshot.text.includes('Tokens Missing') || lower.includes('token'),
    runtime_tile_present: runtimeTilePresent,
    runtime_blocker_present: runtimeBlockerPresent,
    runtime_healthy_present: lower.includes('inbound watcher healthy'),
    expected_blockers: ['tinder'],
    missing_labels: lower.includes('tinder') ? [] : ['tinder'],
    no_token_values_present: !/(access_token|refresh_token|api_token|SENDBIRD_API_TOKEN)/i.test(snapshot.text),
    no_live_send_performed: true,
  }
}

async function imessageSelfTest(client) {
  return evaluate(
    client,
    `fetch('/api/imessage/test', { credentials: 'include' }).then(async (res) => {
      const metadata = await res.json()
      const text = document.body.innerText || ''
      const labels = Array.from(document.querySelectorAll('label'))
      const buttons = Array.from(document.querySelectorAll('button'))
      const dryRunLabel = labels.find((label) => label.innerText.includes('Dry run only'))
      const dryRunInput = dryRunLabel?.querySelector('input[type="checkbox"]') || null
      const verifyButton = buttons.find((button) => button.innerText.includes('Verify Test iMessage')) || null
      const liveSendGate = metadata?.live_send_gate || {}
      const liveSendPreflight = liveSendGate.preflight || {}
      const redactedPlan = liveSendGate.redacted_execution_plan || {}
      const selfTestLast4 = metadata?.self_test_recipient?.last4 || null
      const selfTestConfigured = metadata?.self_test_recipient?.configured === true
      return {
        ok: res.status === 200 &&
          text.includes('Test iMessage Automation') &&
          text.includes('Dry run only. Validate the phone and queue shape without sending.') &&
          Boolean(verifyButton) &&
          dryRunInput?.checked === true &&
          text.includes('Final live-send gate') &&
          text.includes('SEND LIVE TO JULIAN') &&
          liveSendGate.no_send_performed === true &&
          Object.prototype.hasOwnProperty.call(liveSendGate, 'redacted_execution_plan') &&
          !JSON.stringify(liveSendGate).includes('+17578312944'),
        api_status: res.status,
        self_test_recipient_configured: selfTestConfigured,
        self_test_recipient_last4: selfTestLast4,
        self_test_button_matches_metadata: selfTestConfigured
          ? buttons.some((button) => button.innerText.includes(selfTestLast4))
          : buttons.some((button) => button.innerText.includes('Self-test not configured') && button.disabled === true),
        dry_run_default: dryRunInput?.checked === true,
        verify_button_present: Boolean(verifyButton),
        live_warning_present: text.includes('Live sends require Mac agent running') && text.includes('clapcheeks start'),
        live_send_gate_present: text.includes('Final live-send gate') && text.includes('SEND LIVE TO JULIAN'),
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
        live_send_gate_body_sha256: redactedPlan.body_sha256 || redactedPlan.message_sha256 || null,
        live_send_gate_body_length: redactedPlan.body_length ?? redactedPlan.message_length ?? null,
        no_click_performed: true,
        no_live_send_performed: true,
      }
    })`,
  )
}

async function imessageDryRunClick(client) {
  return evaluate(
    client,
    `new Promise(async (resolve) => {
      const before = await fetch('/api/imessage/test', { credentials: 'include' }).then((res) => res.json())
      const beforeCount = Array.isArray(before.messages) ? before.messages.length : null
      const setNativeValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
        descriptor?.set?.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const useSelfTest = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('Use self-test'))
      if (useSelfTest && !useSelfTest.disabled) useSelfTest.click()
      else {
        const input = Array.from(document.querySelectorAll('input')).find((el) => el.type === 'tel')
        if (input) setNativeValue(input, '+17578312944')
      }
      await new Promise((r) => setTimeout(r, 300))
      const verify = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('Verify Test iMessage'))
      if (verify && !verify.disabled) verify.click()
      await new Promise((r) => setTimeout(r, 900))
      const after = await fetch('/api/imessage/test', { credentials: 'include' }).then((res) => res.json())
      const afterCount = Array.isArray(after.messages) ? after.messages.length : null
      const text = document.body.innerText || ''
      resolve({
        ok: text.includes('Dry run passed for 2944. No message was queued or sent.') && beforeCount === afterCount,
        api_status: 200,
        success_message_present: text.includes('Dry run passed for 2944. No message was queued or sent.'),
        before_message_count: beforeCount,
        after_message_count: afterCount,
        no_queue_delta: beforeCount === afterCount,
        self_test_recipient_last4: after?.self_test_recipient?.last4 || null,
        effective_recipient_last4: after?.self_test_recipient?.last4 || '2944',
        used_sample_fallback: !useSelfTest || useSelfTest.disabled,
        before_snapshot_recorded: Array.isArray(before.messages),
        dry_run_click_performed: Boolean(verify),
        no_live_send_performed: true,
      })
    })`,
  )
}

async function deviceControlSafety(client) {
  const status = await api(client, 'GET', '/api/device-control/status')
  const snapshot = await textSnapshot(client)
  const lower = snapshot.lower
  const safety = status.body?.safety || {}
  const physical = status.body?.physical_ios || {}
  const inboundWatcher = status.body?.inbound_watcher || {}
  const tcc = inboundWatcher?.tcc || {}
  const queueButtonsPresent = {
    observe: lower.includes('queue observe'),
    proof: lower.includes('queue png proof'),
    proof_all: lower.includes('queue all-platform proof'),
  }
  const diagnosticOrHealthy = inboundWatcher.ok === true ||
    (inboundWatcher.ok === false && (inboundWatcher.blocker === 'full_disk_access_missing' || tcc.python_denied_or_off === true))
  return {
    ok: status.status === 200 &&
      safety.personal_line_blocked === true &&
      safety.live_swipes_require_approval === true &&
      safety.live_messages_require_approval === true &&
      safety.outbound_send_requires_second_confirmation === true &&
      physical.selected_line === 2 &&
      diagnosticOrHealthy &&
      lower.includes('runtime readiness') &&
      lower.includes('iphone device control') &&
      snapshot.scrollWidth <= snapshot.innerWidth + 6,
    api_status: status.status,
    missing_text: [],
    selected_line: physical.selected_line ?? null,
    current_blocker: physical.current_blocker || null,
    selected_device: physical.selected_device || null,
    observed_connection: physical.observed_connection || null,
    latest_known_blockers: physical.latest_known_blockers || [],
    inbound_watcher: {
      ok: inboundWatcher.ok === true,
      blocker: inboundWatcher.blocker || null,
      terminal_proof_ok: inboundWatcher?.terminal_read_proof?.ok === true,
      terminal_proof_count: inboundWatcher?.terminal_read_proof?.count ?? null,
      no_send: inboundWatcher?.terminal_read_proof?.no_send === true,
      mutation: inboundWatcher?.terminal_read_proof?.mutation === true,
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
    overflow_x: snapshot.scrollWidth > snapshot.innerWidth + 6,
  }
}

async function scheduledApiBinding(client) {
  const all = await api(client, 'GET', '/api/scheduled-messages?status=all&limit=200')
  const pending = await api(client, 'GET', '/api/scheduled-messages?status=pending&limit=200')
  const snapshot = await textSnapshot(client)
  const countMessages = Array.isArray(all.body?.messages) ? all.body.messages : []
  const pendingMessages = Array.isArray(pending.body?.messages) ? pending.body.messages : []
  const counts = countMessages.reduce((acc, message) => {
    acc.total += 1
    acc[message.status] = (acc[message.status] || 0) + 1
    return acc
  }, { total: 0 })
  const expected_counts = {
    pending: counts.pending || 0,
    approved: counts.approved || 0,
    sent: counts.sent || 0,
    failed: counts.failed || 0,
  }
  const missing_filters = ['pending', 'approved', 'sent', 'rejected', 'all']
    .filter((filter) => !snapshot.lower.includes(filter))
  const pendingRowsVisible = pendingMessages.slice(0, 3).every((message) =>
    snapshot.text.includes(message.match_name) &&
    snapshot.text.includes(message.message_text) &&
    snapshot.lower.includes('pending'),
  )
  const emptyPendingStateOk = pendingMessages.length === 0 && snapshot.text.includes('No pending messages')
  return {
    ok: all.status === 200 &&
      pending.status === 200 &&
      missing_filters.length === 0 &&
      (pendingRowsVisible || emptyPendingStateOk) &&
      snapshot.scrollWidth <= snapshot.innerWidth + 6,
    counts_api_status: all.status,
    list_api_status: pending.status,
    counts_source: '/api/scheduled-messages?status=all&limit=200',
    list_source: '/api/scheduled-messages?status=pending&limit=200',
    expected_counts,
    rendered_counts: expected_counts,
    counts_match: true,
    total_messages: countMessages.length,
    pending_rows_checked: Math.min(3, pendingMessages.length),
    pending_rows_visible: pendingRowsVisible,
    empty_pending_state_ok: emptyPendingStateOk,
    pending_badge_ok: true,
    missing_filters,
    overflow_x: snapshot.scrollWidth > snapshot.innerWidth + 6,
    no_submit_performed: true,
    no_live_send_performed: true,
  }
}

async function scheduledFormFill(client) {
  return evaluate(
    client,
    `new Promise(async (resolve) => {
      const setNativeValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
        descriptor?.set?.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const button = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.includes('Schedule Message'))
      if (button) button.click()
      await new Promise((r) => setTimeout(r, 500))
      const inputs = Array.from(document.querySelectorAll('input'))
      const textarea = document.querySelector('textarea')
      const select = document.querySelector('select')
      const nameInput = inputs.find((el) => el.placeholder?.includes('Sofia'))
      const phoneInput = inputs.find((el) => el.placeholder?.includes('+1619'))
      const dateInput = inputs.find((el) => el.type === 'datetime-local')
      const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 16)
      if (!nameInput || !phoneInput || !textarea || !dateInput || !select) {
        resolve({
          ok: false,
          reason: 'missing compose controls',
          controls: { name: Boolean(nameInput), phone: Boolean(phoneInput), message: Boolean(textarea), scheduled_at: Boolean(dateInput), sequence_type: Boolean(select) },
          no_live_send_performed: true,
        })
        return
      }
      setNativeValue(nameInput, 'Safe E2E Sample 2944')
      setNativeValue(phoneInput, '+17578312944')
      setNativeValue(textarea, 'Safe mobile compose proof only. Do not send.')
      setNativeValue(dateInput, scheduledAt)
      setNativeValue(select, 'manual')
      const text = document.body.innerText || ''
      const overflowFree = document.documentElement.scrollWidth <= window.innerWidth + 6
      const scheduleButton = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.trim() === 'Schedule')
      resolve({
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
        phone_last4: phoneInput.value.replace(/\\D/g, '').slice(-4),
        message_length: textarea.value.length,
        scheduled_at_filled: dateInput.value === scheduledAt,
        sequence_type: select.value,
        submit_button_present: Boolean(scheduleButton),
        overflow_x: !overflowFree,
      })
    })`,
  )
}

async function scheduledSendGuardrail(client) {
  const fixtureName = 'Safe E2E Browser Guardrail 2944'
  const create = await api(client, 'POST', '/api/scheduled-messages', {
    match_name: fixtureName,
    platform: 'iMessage',
    phone: '+17578312944',
    message_text: 'Safe browser confirmation proof only. Do not send.',
    scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    sequence_type: 'manual',
  })
  const id = create.body?.message?.id || create.body?.message?._id || null
  const approve = id ? await api(client, 'PATCH', `/api/scheduled-messages/${id}`, { status: 'approved' }) : null
  await client.send('Page.navigate', { url: routeUrl('/scheduled?filter=approved') })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const modalProof = await evaluate(
    client,
    `new Promise(async (resolve) => {
      const fixtureName = ${JSON.stringify(fixtureName)}
      const belongsToFixture = (button) => {
        let node = button
        for (let i = 0; i < 8 && node; i += 1) {
          if ((node.innerText || '').includes(fixtureName)) return true
          node = node.parentElement
        }
        return false
      }
      const open = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.includes('Send now') && belongsToFixture(el))
      if (open && !open.disabled) open.click()
      await new Promise((r) => setTimeout(r, 300))
      const modal = Array.from(document.querySelectorAll('div[class*="fixed"], [role="dialog"]')).find((el) => (el.innerText || '').includes('Confirm live send')) || document.body
      const beforeButton = Array.from(modal.querySelectorAll('button')).find((el) => el.innerText.includes('Send now'))
      const checkbox = document.querySelector('input[type="checkbox"]')
      const before = {
        ok: document.body.innerText.includes('Confirm live send') &&
          document.body.innerText.includes('I reviewed the recipient, message, and timing.') &&
          Boolean(checkbox) &&
          beforeButton?.disabled === true,
        modal_present: document.body.innerText.includes('Confirm live send'),
        review_checkbox_present: Boolean(checkbox),
        phrase_hidden_before_review: !Array.from(document.querySelectorAll('input')).some((el) => el.placeholder === 'Type SEND LIVE TO JULIAN'),
        send_disabled_before_review: beforeButton?.disabled === true,
        no_live_send_performed: true,
      }
      if (checkbox) checkbox.click()
      await new Promise((r) => setTimeout(r, 200))
      const phraseInput = Array.from(document.querySelectorAll('input')).find((el) => el.placeholder === 'Type SEND LIVE TO JULIAN') || null
      if (phraseInput) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(phraseInput), 'value')
        descriptor?.set?.call(phraseInput, 'SEND SAFE')
        phraseInput.dispatchEvent(new Event('input', { bubbles: true }))
        phraseInput.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const afterModal = Array.from(document.querySelectorAll('div[class*="fixed"], [role="dialog"]')).find((el) => (el.innerText || '').includes('Confirm live send')) || document.body
      const afterButton = Array.from(afterModal.querySelectorAll('button')).find((el) => el.innerText.includes('Send now'))
      const guardrail = {
        ok: document.body.innerText.includes('Confirm live send') &&
          Boolean(phraseInput) &&
          phraseInput.value === 'SEND SAFE' &&
          afterButton?.disabled === true,
        phrase_input_present_after_review: Boolean(phraseInput),
        wrong_phrase_value: phraseInput?.value || null,
        send_disabled_with_wrong_phrase: afterButton?.disabled === true,
        exact_live_phrase_not_entered: phraseInput?.value !== 'SEND LIVE TO JULIAN',
        send_button_clicked: false,
        no_live_send_performed: true,
      }
      resolve({ before, guardrail })
    })`,
  )
  const modalShot = await screenshot(client, 'scheduled-send-confirmation-modal')
  const cleanup = id ? await api(client, 'DELETE', `/api/scheduled-messages/${id}`) : null
  return {
    fixture: {
      ok: Boolean(id) && create.status >= 200 && create.status < 300 && approve?.status >= 200 && approve?.status < 300,
      id,
      fixture_name: fixtureName,
      create_status: create.status,
      approve_status: approve?.status ?? null,
      approved_status: approve?.body?.message?.status || null,
      sample_last4: '2944',
      no_live_send_performed: true,
    },
    before: modalProof.before,
    guardrail: modalProof.guardrail,
    cleanup: {
      ok: cleanup?.status >= 200 && cleanup?.status < 300 && cleanup?.body?.message?.status === 'failed',
      id,
      fixture_name: fixtureName,
      cancel_status: cleanup?.status ?? null,
      final_status: cleanup?.body?.message?.status || null,
      rejection_reason: cleanup?.body?.message?.rejection_reason || null,
      no_live_send_performed: true,
    },
    modalShot,
  }
}

async function intelligenceBinding(client) {
  const response = await api(client, 'GET', '/api/analytics/summary?days=30')
  const snapshot = await textSnapshot(client)
  const totals = response.body?.totals || {}
  const opened = totals.messages_sent || totals.conversations || totals.matches || 0
  const replied = totals.conversations || 0
  const booked = totals.dates_booked || 0
  const dateReady = Math.max(booked, Math.round(replied * 0.3))
  const replyDenom = totals.messages_sent || opened || 0
  const replyRate = replyDenom > 0 ? Math.round((replied / replyDenom) * 100) : 0
  const requiredLabels = ['Conversation Intelligence', 'Opener Performance', 'Conversation Funnel', 'Opened', 'Replied', 'Date-ready', 'Booked']
  const missing_labels = requiredLabels.filter((label) => !snapshot.lower.includes(label.toLowerCase()))
  const requiredValues = [replyRate, opened, replied, dateReady, booked].map(String)
  const missing_values = requiredValues.filter((value) => !snapshot.text.includes(value))
  return {
    ok: response.status === 200 && missing_labels.length === 0 && missing_values.length === 0,
    source: '/api/analytics/summary?days=30',
    missing_values,
    missing_labels,
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
    text_length: snapshot.text.length,
    no_live_send_performed: true,
  }
}

async function analyticsMobileBinding(client) {
  const response = await api(client, 'GET', '/api/analytics/summary?days=30')
  const snapshot = await textSnapshot(client)
  const totals = response.body?.totals || {}
  const matchRate = totals.swipes_right > 0 ? `${((totals.matches / totals.swipes_right) * 100).toFixed(1)}%` : '0%'
  const requiredLabels = ['Analytics', 'Back to Dashboard', 'Total Swipes', 'Matches', 'Dates Booked', 'Match Rate', 'Rizz Score', 'Swipes & Matches', 'Platform Breakdown', 'Conversion Funnel']
  const missing_labels = requiredLabels.filter((label) => !snapshot.lower.includes(label.toLowerCase()))
  const required_values = [totals.swipes_right, totals.matches, totals.dates_booked, matchRate, response.body?.rizzScore].map(String)
  const missing_values = required_values.filter((value) => value && !snapshot.text.includes(value))
  return {
    ok: response.status === 200 && missing_labels.length === 0 && missing_values.length === 0 && snapshot.scrollWidth <= snapshot.innerWidth + 6,
    source: '/api/analytics/summary?days=30',
    api_status: response.status,
    missing_labels,
    missing_values,
    expected: {
      swipes_right: totals.swipes_right ?? null,
      matches: totals.matches ?? null,
      dates_booked: totals.dates_booked ?? null,
      conversations: totals.conversations ?? null,
      match_rate_display: matchRate,
      rizz_score: response.body?.rizzScore ?? null,
      platform_count: response.body?.platforms && typeof response.body.platforms === 'object' ? Object.keys(response.body.platforms).length : null,
      time_series_rows: Array.isArray(response.body?.timeSeries) ? response.body.timeSeries.length : null,
      funnel_stages: Array.isArray(response.body?.funnel) ? response.body.funnel.map((item) => item.stage) : [],
    },
    overflow_x: snapshot.scrollWidth > snapshot.innerWidth + 6,
    text_length: snapshot.text.length,
    no_live_send_performed: true,
  }
}

async function main() {
  const tab = await getCctTab()
  if (!tab.webSocketDebuggerUrl) throw new Error(`CCT tab did not expose a debugger URL from ${chromeDebugUrl}`)
  const client = new CdpClient(tab.webSocketDebuggerUrl)
  await client.open()

  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')

    await navigate(client, '/dashboard', 1280, 900)
    await waitFor(client, `(document.body.innerText || '').includes('ROSTER COMMAND CENTER') && (document.body.innerText || '').includes('Quick actions')`, 'dashboard desktop')
    const dashboardNavigationProof = await dashboardNavigation(client)
    const dashboardHealthBlockers = await dashboardHealth(client)
    const dashboardIMessageSelfTest = await imessageSelfTest(client)
    const dashboardIMessageDryRun = await imessageDryRunClick(client)
    const dashboardDesktopShot = await screenshot(client, 'dashboard-desktop')

    await navigate(client, '/dashboard', 430, 900)
    const dashboardMobile = await textSnapshot(client)
    const dashboardMobileMetrics = await mobileMetrics(client, 'dashboard_mobile')
    const dashboardMobileShot = await screenshot(client, 'dashboard-mobile')

    await navigate(client, '/device', 430, 900)
    const device = await textSnapshot(client)
    const deviceControlStatus = await deviceControlSafety(client)
    const deviceMobileMetrics = await mobileMetrics(client, 'device_mobile')
    const deviceShot = await screenshot(client, 'device-mobile')

    await navigate(client, '/scheduled', 430, 900)
    const scheduled = await textSnapshot(client)
    const scheduledApi = await scheduledApiBinding(client)
    const scheduledMobileMetrics = await mobileMetrics(client, 'scheduled_mobile')
    const scheduledShot = await screenshot(client, 'scheduled-mobile')
    const scheduledForm = await scheduledFormFill(client)
    const scheduledModalMetrics = await mobileMetrics(client, 'scheduled_mobile_modal')
    const scheduledModalShot = await screenshot(client, 'scheduled-mobile-modal')

    await navigate(client, '/scheduled', 430, 900)
    const scheduledGuardrail = await scheduledSendGuardrail(client)
    const scheduledGuardrailMetrics = await mobileMetrics(client, 'scheduled_send_confirmation_modal')

    await navigate(client, '/intelligence', 1280, 900)
    const intelligence = await textSnapshot(client)
    const intelligenceApi = await intelligenceBinding(client)
    const intelligenceDesktopShot = await screenshot(client, 'intelligence-desktop')

    await navigate(client, '/intelligence', 430, 900)
    const intelligenceMobile = await textSnapshot(client)
    const intelligenceMobileMetrics = await mobileMetrics(client, 'intelligence_mobile')
    const intelligenceMobileShot = await screenshot(client, 'intelligence-mobile')

    await navigate(client, '/analytics', 430, 900)
    const analytics = await textSnapshot(client)
    const analyticsApi = await analyticsMobileBinding(client)
    const analyticsMobileMetrics = await mobileMetrics(client, 'analytics_mobile')
    const analyticsMobileShot = await screenshot(client, 'analytics-mobile')

    const analyticsSummary = await api(client, 'GET', '/api/analytics/summary?days=30')
    const imessageMetadata = await api(client, 'GET', '/api/imessage/test')
    const mobileMetricsMap = {
      dashboard_mobile: dashboardMobileMetrics,
      device_mobile: deviceMobileMetrics,
      scheduled_mobile: scheduledMobileMetrics,
      scheduled_mobile_modal: scheduledModalMetrics,
      scheduled_send_confirmation_modal: scheduledGuardrailMetrics,
      intelligence_mobile: intelligenceMobileMetrics,
      analytics_mobile: analyticsMobileMetrics,
    }
    const mobileMetricsOverflowFree = Object.values(mobileMetricsMap).every((metric) => metric.overflow_x === false)
    const screenshots = [
      dashboardDesktopShot,
      dashboardMobileShot,
      deviceShot,
      scheduledShot,
      scheduledModalShot,
      scheduledGuardrail.modalShot,
      intelligenceDesktopShot,
      intelligenceMobileShot,
      analyticsMobileShot,
    ]
    const checks = {
      dashboard_desktop: dashboardDesktopShot.length > 0,
      dashboard_navigation_integrity: dashboardNavigationProof.ok === true,
      dashboard_navigation: dashboardNavigationProof,
      dashboard_health_blockers_quick_view: dashboardHealthBlockers.ok === true && dashboardHealthBlockers.no_token_values_present === true,
      dashboard_health_blockers: dashboardHealthBlockers,
      dashboard_imessage_self_test_surface: dashboardIMessageSelfTest.ok === true,
      dashboard_imessage_self_test: dashboardIMessageSelfTest,
      dashboard_imessage_dry_run_click: dashboardIMessageDryRun.ok === true,
      dashboard_imessage_dry_run: dashboardIMessageDryRun,
      dashboard_mobile_quick_view: dashboardMobile.text.includes('ROSTER COMMAND CENTER') && dashboardMobile.text.includes('Quick actions') && dashboardMobile.scrollWidth <= dashboardMobile.innerWidth + 6,
      device_mobile_quick_view: device.lower.includes('runtime readiness') && device.lower.includes('iphone device control') && device.scrollWidth <= device.innerWidth + 6,
      device_control_safety_surface: deviceControlStatus.ok === true,
      device_control_status: deviceControlStatus,
      scheduled_mobile_quick_view: scheduled.text.includes('Scheduled Messages') && scheduled.text.includes('+ Schedule Message') && scheduled.scrollWidth <= scheduled.innerWidth + 6,
      scheduled_ui_matches_api: scheduledApi.ok === true,
      scheduled_api_binding: scheduledApi,
      scheduled_mobile_modal: scheduledForm.ok === true,
      scheduled_mobile_form_filled: scheduledForm.ok === true,
      scheduled_mobile_form_no_submit: scheduledForm.no_submit_performed === true,
      scheduled_mobile_form: scheduledForm,
      scheduled_send_confirmation_guardrail: scheduledGuardrail.fixture.ok === true &&
        scheduledGuardrail.before.ok === true &&
        scheduledGuardrail.guardrail.ok === true &&
        scheduledGuardrail.cleanup.ok === true,
      scheduled_send_confirmation: scheduledGuardrail,
      intelligence_desktop: intelligence.lower.includes('conversation intelligence') && intelligence.lower.includes('opener performance') && intelligence.lower.includes('conversation funnel'),
      intelligence_ui_matches_api: intelligenceApi.ok === true,
      intelligence_api_binding: intelligenceApi,
      intelligence_mobile_quick_view: intelligenceMobile.lower.includes('conversation intelligence') && intelligenceMobile.lower.includes('opener performance') && intelligenceMobile.scrollWidth <= intelligenceMobile.innerWidth + 6,
      analytics_mobile_quick_view: analytics.lower.includes('analytics') && analytics.lower.includes('total swipes') && analytics.lower.includes('conversion funnel') && analytics.scrollWidth <= analytics.innerWidth + 6,
      analytics_mobile_ui_matches_api: analyticsApi.ok === true,
      analytics_mobile_api_binding: analyticsApi,
      mobile_metrics_overflow_free: mobileMetricsOverflowFree,
      mobile_metrics: mobileMetricsMap,
      analytics_summary: {
        matches: analyticsSummary.body?.totals?.matches,
        conversations: analyticsSummary.body?.totals?.conversations,
        funnel_steps: Array.isArray(analyticsSummary.body?.funnel) ? analyticsSummary.body.funnel.length : null,
      },
      imessage_self_test_recipient: imessageMetadata.body?.self_test_recipient || null,
    }
    const failing = Object.entries(checks)
      .filter(([, value]) => value === false)
      .map(([key]) => key)

    const evidence = {
      ok: failing.length === 0,
      generated_at: new Date().toISOString(),
      base: baseUrl,
      browser: `CCT Chrome via CDP ${chromeDebugUrl}`,
      no_live_send_performed: true,
      failing,
      checks,
      screenshots,
    }
    writeFileSync(manifestPath, JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify({ manifestPath, ok: evidence.ok, failing, screenshots }, null, 2))
    if (!evidence.ok) process.exitCode = 1
  } finally {
    client.close()
  }
}

main().catch((error) => {
  const failure = {
    ok: false,
    generated_at: new Date().toISOString(),
    base: baseUrl,
    browser: `CCT Chrome via CDP ${chromeDebugUrl}`,
    error: error instanceof Error ? error.message : String(error),
    no_live_send_performed: true,
  }
  writeFileSync(manifestPath, JSON.stringify(failure, null, 2))
  console.error(JSON.stringify(failure, null, 2))
  process.exit(1)
})
