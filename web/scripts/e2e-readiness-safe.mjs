#!/usr/bin/env node

const base = process.env.CLAPCHEEKS_E2E_BASE_URL || 'http://127.0.0.1:3002'
const samplePhone = process.env.CLAPCHEEKS_E2E_SAMPLE_PHONE || '+17578312944'
const sampleLast4 = samplePhone.replace(/\D/g, '').slice(-4)
const sampleTail10 = samplePhone.replace(/\D/g, '').slice(-10)
const evidencePath = process.env.CLAPCHEEKS_E2E_EVIDENCE || '/tmp/clapcheeks-safe-e2e-readiness.json'
const coreRoutes = [
  { route: '/dashboard', snippets: ['ROSTER COMMAND CENTER', 'Quick actions'] },
  { route: '/dashboard/matches', snippets: ['Matches', 'Every match'] },
  { route: '/dashboard/roster', snippets: ['Roster', 'Dating CRM'] },
  { route: '/dashboard/content-library', snippets: ['Content Library', '60/20/10/10'] },
  { route: '/matches', snippets: ['Match Intel'] },
  { route: '/conversation', snippets: ['Conversation AI', 'Your Voice Profile'] },
  { route: '/leads', snippets: ['Leads'] },
  { route: '/scheduled', snippets: ['Scheduled Messages', '+ Schedule Message'] },
  { route: '/intelligence', snippets: [] },
  { route: '/analytics', snippets: ['Analytics', 'Back to Dashboard'] },
  { route: '/photos', snippets: ['Photo Optimizer', 'Drop photos here'] },
  { route: '/device', snippets: ['Runtime readiness', 'Always-On Device Add-On'] },
  { route: '/autonomy', snippets: ['Autonomy Engine'] },
  { route: '/settings/ai', snippets: ['AI Settings'] },
  { route: '/billing', snippets: ['Billing'] },
  { route: '/support', snippets: ['Support', 'Send us a message'] },
]

const checks = []

function record(name, ok, detail = {}) {
  checks.push({ name, ok, detail })
  const status = ok ? '[ok]' : '[X]'
  console.log(`${status} ${name}${detail.summary ? ` -- ${detail.summary}` : ''}`)
}

async function jsonFetch(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 1000) }
  }
  return { res, body }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function retry(fn, attempts = 3, delayMs = 500) {
  let latestError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      latestError = error
      if (attempt < attempts) await sleep(delayMs * attempt)
    }
  }
  throw latestError
}

function looksLikeNextColdCompileError(result) {
  return result?.res?.status >= 500 && typeof result?.body?.raw === 'string' && result.body.raw.includes('<!DOCTYPE html>')
}

async function jsonFetchRetryColdCompile(path, init, attempts = 3) {
  let latest
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    latest = await jsonFetch(path, init)
    if (!looksLikeNextColdCompileError(latest)) return latest
    if (attempt < attempts) await sleep(750 * attempt)
  }
  return latest
}

async function assertRoute(path, snippets) {
  const res = await fetch(`${base}${path}`)
  const text = await res.text()
  const missing = snippets.filter((snippet) => !text.includes(snippet))
  const ok = res.ok && missing.length === 0
  record(`route ${path}`, ok, {
    status: res.status,
    missing,
    summary: ok ? `rendered ${text.length} chars` : `status=${res.status} missing=${missing.join(', ')}`,
  })
}

async function assertJsonPath(path, validate) {
  const { res, body } = await jsonFetch(path)
  const validation = validate(body)
  record(`json ${path}`, res.ok && validation.ok, {
    status: res.status,
    body,
    summary: validation.summary,
  })
}

async function verifyMessagesDbReadOnly() {
  const [{ existsSync }, { execFile }, { promisify }, os, path] = await Promise.all([
    import('node:fs'),
    import('node:child_process'),
    import('node:util'),
    import('node:os'),
    import('node:path'),
  ])
  const execFileAsync = promisify(execFile)
  const dbPath = path.join(os.homedir(), 'Library/Messages/chat.db')

  if (!existsSync(dbPath)) {
    record('messages db read-only sample lookup', false, {
      checked: false,
      reason: 'messages_db_not_present',
      summary: 'Messages DB not present',
    })
    return
  }

  const normalizedHandle = [
    "replace(",
    "replace(",
    "replace(",
    "replace(",
    "replace(coalesce(h.id,''), '+', ''),",
    "'-', ''),",
    "' ', ''),",
    "'(', ''),",
    "')', '')",
  ].join('')
  const phonePredicate = sampleTail10.length >= 8
    ? `${normalizedHandle} like '%${sampleTail10.replace(/'/g, "''")}'`
    : '0'
  const query = [
    'select',
    `coalesce(sum(case when ${phonePredicate} then 1 else 0 end),0) as sample_handle_rows,`,
    `coalesce(sum(case when ${phonePredicate} and m.is_from_me = 1 then 1 else 0 end),0) as sample_outbound_rows,`,
    'count(*) as total_rows',
    'from message m left join handle h on h.ROWID = m.handle_id;',
  ].join(' ')

  try {
    const { stdout, attempts } = await retry(async (attempt) => {
      const result = await execFileAsync('/usr/bin/sqlite3', ['-readonly', '-separator', '|', dbPath, query], {
        timeout: 30_000,
      })
      return { ...result, attempts: attempt }
    }, 3, 750)
    const [sampleRowsRaw, outboundRowsRaw, totalRowsRaw] = stdout.trim().split('|')
    const sample_handle_rows = Number.parseInt(sampleRowsRaw || '0', 10)
    const sample_outbound_rows = Number.parseInt(outboundRowsRaw || '0', 10)
    const total_rows = Number.parseInt(totalRowsRaw || '0', 10)
    const ok = Number.isFinite(total_rows) && total_rows > 0 && Number.isFinite(sample_handle_rows)
    record('messages db read-only sample lookup', ok, {
      checked: true,
      sample_last4: sampleLast4,
      sample_handle_rows,
      sample_outbound_rows,
      total_rows,
      content_logged: false,
      attempts,
      summary: ok
        ? `sample rows=${sample_handle_rows} outbound=${sample_outbound_rows} total=${total_rows} attempts=${attempts}`
        : 'Messages DB query returned no rows',
    })
  } catch (error) {
    record('messages db read-only sample lookup', false, {
      checked: true,
      error: error instanceof Error ? error.message : String(error),
      stderr: typeof error?.stderr === 'string' ? error.stderr.slice(0, 500) : null,
      content_logged: false,
      summary: 'Messages DB read-only query failed',
    })
  }
}

async function verifyCoreRouteMatrix() {
  const results = []
  for (const item of coreRoutes) {
    try {
      const res = await fetch(`${base}${item.route}`)
      const text = await res.text()
      const missing = item.snippets.filter((snippet) => !text.includes(snippet))
      results.push({
        route: item.route,
        ok: res.ok && missing.length === 0,
        status: res.status,
        rendered_chars: text.length,
        missing,
      })
    } catch (error) {
      results.push({
        route: item.route,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const failed = results.filter((result) => !result.ok)
  record('dashboard core route matrix', failed.length === 0, {
    routes: results,
    summary: failed.length === 0 ? `${results.length} routes ok with content assertions` : `${failed.length}/${results.length} routes failed`,
  })
}

async function verifyAnalyticsSummaryContract() {
  const { res, body } = await jsonFetch('/api/analytics/summary?days=30')
  const requiredTotals = ['swipes_right', 'swipes_left', 'matches', 'messages_sent', 'dates_booked', 'conversations']
  const missingTotals = requiredTotals.filter((key) => typeof body?.totals?.[key] !== 'number')
  const requiredFunnelStages = ['Swipes', 'Matches', 'Conversations', 'Dates']
  const funnelStages = Array.isArray(body?.funnel) ? body.funnel.map((item) => item.stage) : []
  const missingFunnelStages = requiredFunnelStages.filter((stage) => !funnelStages.includes(stage))
  const funnelValuesNumeric = Array.isArray(body?.funnel) && body.funnel.every((item) => typeof item.value === 'number')
  const conversationsStage = Array.isArray(body?.funnel)
    ? body.funnel.find((item) => item.stage === 'Conversations')
    : null
  const platformRows = body?.platforms && typeof body.platforms === 'object' ? Object.entries(body.platforms) : []
  const platformRowsValid = platformRows.length > 0 && platformRows.every(([, row]) => (
    row &&
    typeof row.swipes_right === 'number' &&
    typeof row.matches === 'number' &&
    typeof row.messages_sent === 'number' &&
    typeof row.dates_booked === 'number'
  ))
  const timeSeriesRows = Array.isArray(body?.timeSeries) ? body.timeSeries : []
  const timeSeriesValid = timeSeriesRows.length > 0 && timeSeriesRows.every((row) => (
    typeof row.date === 'string' &&
    typeof row.swipes_right === 'number' &&
    typeof row.matches === 'number' &&
    typeof row.messages_sent === 'number' &&
    typeof row.dates_booked === 'number' &&
    typeof row.conversations_replied === 'number'
  ))
  const trendsValid = ['swipes', 'matches', 'dates'].every((key) => (
    body?.trends?.[key] &&
    ['up', 'down', 'same'].includes(body.trends[key].direction) &&
    typeof body.trends[key].delta === 'number'
  ))
  const spendingValid = body?.spending &&
    typeof body.spending.totalSpent === 'number' &&
    typeof body.spending.costPerMatch === 'number' &&
    typeof body.spending.costPerDate === 'number' &&
    body.spending.byCategory &&
    typeof body.spending.byCategory === 'object'
  const dataQualityValid = body?.dataQuality && Array.isArray(body.dataQuality.warnings)
  const matchRateValid = typeof body?.matchRate === 'number' && typeof body?.matchRateAvailable === 'boolean'
  const rizzValid = typeof body?.rizzScore === 'number' &&
    body?.rizzTrend &&
    ['up', 'down', 'same'].includes(body.rizzTrend.direction) &&
    typeof body.rizzTrend.delta === 'number'
  const conversationsConsistent = conversationsStage?.value === body?.totals?.conversations

  const ok = res.ok &&
    missingTotals.length === 0 &&
    missingFunnelStages.length === 0 &&
    funnelValuesNumeric &&
    conversationsConsistent &&
    platformRowsValid &&
    timeSeriesValid &&
    trendsValid &&
    spendingValid &&
    dataQualityValid &&
    matchRateValid &&
    rizzValid

  record('analytics summary contract', ok, {
    status: res.status,
    totals: missingTotals.length === 0 ? body.totals : null,
    missing_totals: missingTotals,
    funnel_stages: funnelStages,
    missing_funnel_stages: missingFunnelStages,
    conversations_consistent: conversationsConsistent,
    platform_count: platformRows.length,
    time_series_rows: timeSeriesRows.length,
    platform_rows_valid: platformRowsValid,
    time_series_valid: timeSeriesValid,
    trends_valid: trendsValid,
    spending_valid: spendingValid,
    data_quality_valid: dataQualityValid,
    match_rate_valid: matchRateValid,
    rizz_valid: rizzValid,
    summary: ok
      ? `matches=${body.totals.matches} conversations=${body.totals.conversations} platforms=${platformRows.length} days=${timeSeriesRows.length} funnel=${funnelStages.join('>')}`
      : `status=${res.status} missing_totals=${missingTotals.join(',') || 'none'} missing_funnel=${missingFunnelStages.join(',') || 'none'}`,
  })
}

async function verifyDashboardHealthContract() {
  const health = await jsonFetch('/api/health?detailed=true')
  const services = Array.isArray(health.body?.services) ? health.body.services : []
  const serviceNames = services.map((service) => service.service)
  const missingServices = ['convex', 'stripe', 'api-backend', 'inbound-watcher'].filter((service) => !serviceNames.includes(service))
  const serviceRowsValid = services.every((service) => (
    typeof service.service === 'string' &&
    ['healthy', 'degraded', 'down'].includes(service.status) &&
    typeof service.latencyMs === 'number' &&
    typeof service.checkedAt === 'string'
  ))
  const convexService = services.find((service) => service.service === 'convex')
  const inboundWatcherService = services.find((service) => service.service === 'inbound-watcher')
  const overallValid = ['healthy', 'degraded', 'down'].includes(health.body?.overall)
  const versionValid = typeof health.body?.version === 'string' && health.body.version.length > 0
  const timestampValid = typeof health.body?.timestamp === 'string' && Number.isFinite(Date.parse(health.body.timestamp))

  const tokenHealth = await jsonFetch('/api/agent/token-health')
  const platforms = Array.isArray(tokenHealth.body?.platforms) ? tokenHealth.body.platforms : []
  const platformNames = platforms.map((platform) => platform.platform)
  const missingPlatformRows = ['tinder', 'hinge', 'instagram', 'bumble'].filter((platform) => !platformNames.includes(platform))
  const tokenRowsValid = platforms.every((platform) => (
    typeof platform.platform === 'string' &&
    typeof platform.required === 'boolean' &&
    typeof platform.present === 'boolean' &&
    ['valid', 'missing', 'unknown'].includes(platform.status) &&
    !Object.prototype.hasOwnProperty.call(platform, 'token') &&
    !Object.prototype.hasOwnProperty.call(platform, 'access_token') &&
    !Object.prototype.hasOwnProperty.call(platform, 'refresh_token')
  ))
  const sendbirdValid = tokenHealth.body?.sendbird &&
    tokenHealth.body.sendbird.required === true &&
    typeof tokenHealth.body.sendbird.present === 'boolean' &&
    ['configured', 'missing'].includes(tokenHealth.body.sendbird.status) &&
    Array.isArray(tokenHealth.body.sendbird.missing)
  const missingRequiredValid = typeof tokenHealth.body?.missing_required === 'number'
  const missingRequiredServices = Array.isArray(tokenHealth.body?.missing_required_services)
    ? tokenHealth.body.missing_required_services
    : []
  const missingRequiredServicesValid = missingRequiredServices.length === (tokenHealth.body?.missing_required ?? -1) &&
    missingRequiredServices.every((item) => (
      ['platform', 'service'].includes(item.type) &&
      ['tinder', 'hinge', 'instagram', 'bumble', 'sendbird'].includes(item.name) &&
      typeof item.reason === 'string' &&
      item.reason.length > 0 &&
      !Object.prototype.hasOwnProperty.call(item, 'token') &&
      !Object.prototype.hasOwnProperty.call(item, 'access_token') &&
      !Object.prototype.hasOwnProperty.call(item, 'refresh_token')
    ))
  const redactionNotePresent = typeof tokenHealth.body?.note === 'string' && /omitted/i.test(tokenHealth.body.note)

  const ok = [200, 503].includes(health.res.status) &&
    overallValid &&
    versionValid &&
    timestampValid &&
    missingServices.length === 0 &&
    serviceRowsValid &&
    convexService?.status !== 'down' &&
    inboundWatcherService?.status !== 'down' &&
    (
      inboundWatcherService?.status === 'healthy' ||
      /TCC shows Python Full Disk Access is off/.test(inboundWatcherService?.message || '')
    ) &&
    tokenHealth.res.ok &&
    missingPlatformRows.length === 0 &&
    tokenRowsValid &&
    sendbirdValid &&
    missingRequiredValid &&
    missingRequiredServicesValid &&
    redactionNotePresent

  record('dashboard runtime health contract', ok, {
    health_status: health.res.status,
    overall: health.body?.overall || null,
    services: services.map((service) => ({
      service: service.service,
      status: service.status,
      latencyMs: service.latencyMs,
      message: service.message || null,
    })),
    missing_services: missingServices,
    service_rows_valid: serviceRowsValid,
    convex_status: convexService?.status || null,
    inbound_watcher_status: inboundWatcherService?.status || null,
    inbound_watcher_message: inboundWatcherService?.message || null,
    token_status: tokenHealth.res.status,
    platform_count: platforms.length,
    missing_platform_rows: missingPlatformRows,
    token_rows_valid: tokenRowsValid,
    missing_required: tokenHealth.body?.missing_required ?? null,
    missing_required_services: missingRequiredServices,
    sendbird_status: tokenHealth.body?.sendbird?.status || null,
    sendbird_missing_env: tokenHealth.body?.sendbird?.missing || [],
    token_values_omitted: redactionNotePresent,
    scope_note: 'Health verifies Convex reachability, inbound watcher status, optional service status, and redacted token metadata; it is not a full backend schema/index doctor.',
    summary: ok
      ? `overall=${health.body.overall} convex=${convexService.status} inbound_watcher=${inboundWatcherService.status} missing_required=${tokenHealth.body.missing_required} blockers=${missingRequiredServices.map((item) => item.name).join(',') || 'none'} sendbird=${tokenHealth.body.sendbird.status}`
      : `health_status=${health.res.status} token_status=${tokenHealth.res.status} missing_services=${missingServices.join(',') || 'none'} missing_platforms=${missingPlatformRows.join(',') || 'none'}`,
  })
}

async function verifyImessageDryRun() {
  const get = await jsonFetch('/api/imessage/test')
  const liveGate = get.body?.live_send_gate || {}
  const plan = liveGate.redacted_execution_plan || {}
  const gateMetadataOk = get.res.ok &&
    liveGate.no_send_performed === true &&
    Array.isArray(liveGate.missing) &&
    liveGate.missing.includes('CLAPCHEEKS_LIVE_SEND_PERMISSION') &&
    Array.isArray(liveGate.issues) &&
    Object.prototype.hasOwnProperty.call(liveGate, 'redacted_execution_plan') &&
    !JSON.stringify(liveGate).includes(samplePhone) &&
    !JSON.stringify(liveGate).includes('Safe ClapCheeks no-send preflight for 757 sample. Do not reply.')
  record('imessage metadata', gateMetadataOk, {
    self_test_recipient: get.body?.self_test_recipient ?? null,
    live_send_gate: {
      ready: liveGate.ready === true,
      missing: liveGate.missing || [],
      issues: liveGate.issues || [],
      redacted_execution_plan_present: Object.prototype.hasOwnProperty.call(liveGate, 'redacted_execution_plan'),
      destination_redacted: plan.destination || null,
      body_length: plan.body_length ?? null,
      body_sha256_present: typeof plan.body_sha256 === 'string',
      no_send_performed: liveGate.no_send_performed === true,
    },
    summary: get.body?.self_test_recipient?.configured
      ? `self-test last4=${get.body.self_test_recipient.last4}`
      : 'self-test not configured; using sample phone dry-run',
  })

  const dryPayload = get.body?.self_test_recipient?.configured
    ? {
        use_self_test_recipient: true,
        message: 'Safe E2E iMessage dry-run only. Do not send.',
        dry_run: true,
        opener_style: 'direct',
      }
    : {
        phone: samplePhone,
        message: 'Safe E2E iMessage dry-run only. Do not send.',
        dry_run: true,
        opener_style: 'direct',
      }
  const expectedLast4 = get.body?.self_test_recipient?.configured ? get.body.self_test_recipient.last4 : sampleLast4

  const dry = await jsonFetch('/api/imessage/test', {
    method: 'POST',
    body: JSON.stringify(dryPayload),
  })
  record('imessage dry-run', dry.res.ok && dry.body?.dry_run === true && dry.body?.would_queue?.recipient_last4 === expectedLast4, {
    response: dry.body,
    summary: dry.body?.message,
  })

  const blocked = await jsonFetch('/api/imessage/test', {
    method: 'POST',
    body: JSON.stringify({
      ...dryPayload,
      dry_run: false,
      confirm_send: true,
    }),
  })
  record('imessage live blocked without phrase', blocked.res.status === 400 && /SEND LIVE/.test(blocked.body?.error || ''), {
    response: blocked.body,
    summary: blocked.body?.error,
  })

  const gateBlocked = await jsonFetch('/api/imessage/test', {
    method: 'POST',
    body: JSON.stringify({
      ...dryPayload,
      dry_run: false,
      confirm_send: true,
      live_send_phrase: 'SEND LIVE TO JULIAN',
    }),
  })
  record(
    'imessage live blocked by preflight gate',
    gateBlocked.res.status === 423 &&
      gateBlocked.body?.live_send_gate?.no_send_performed === true &&
      Array.isArray(gateBlocked.body?.issues) &&
      gateBlocked.body.issues.includes('live-send environment gate is not ready'),
    {
      response: gateBlocked.body,
      summary: gateBlocked.body?.error,
    },
  )
}

async function verifyScheduledDryRun() {
  const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const create = await jsonFetch('/api/scheduled-messages', {
    method: 'POST',
    body: JSON.stringify({
      match_name: `Safe E2E Readiness ${sampleLast4}`,
      platform: 'iMessage',
      phone: samplePhone,
      message_text: 'Safe E2E scheduled dry-run only. Do not send.',
      scheduled_at: scheduledAt,
      sequence_type: 'manual',
    }),
  })

  const id = create.body?.message?.id || create.body?.message?._id
  record('scheduled create', create.res.status === 201 && Boolean(id), {
    id,
    status: create.body?.message?.status,
    summary: id ? `id=${id}` : create.body?.error,
  })
  if (!id) return

  try {
    const approve = await jsonFetchRetryColdCompile(`/api/scheduled-messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    })
    record('scheduled approve', approve.res.ok && approve.body?.message?.status === 'approved', {
      response: approve.body,
      summary: approve.body?.message?.status || approve.body?.error,
    })

    const blocked = await jsonFetch('/api/scheduled-messages/send', {
      method: 'POST',
      body: JSON.stringify({ id, confirm_send: true, dry_run: false }),
    })
    record('scheduled live blocked without phrase', blocked.res.status === 400 && /SEND LIVE/.test(blocked.body?.error || ''), {
      response: blocked.body,
      summary: blocked.body?.error,
    })

    const gateBlocked = await jsonFetch('/api/scheduled-messages/send', {
      method: 'POST',
      body: JSON.stringify({ id, confirm_send: true, dry_run: false, live_send_phrase: 'SEND LIVE TO JULIAN' }),
    })
    record(
      'scheduled live blocked by preflight gate',
      gateBlocked.res.status === 423 &&
        gateBlocked.body?.live_send_gate?.no_send_performed === true &&
        Array.isArray(gateBlocked.body?.live_send_gate?.missing) &&
        gateBlocked.body.live_send_gate.missing.includes('CLAPCHEEKS_LIVE_SEND_PERMISSION') &&
        Object.prototype.hasOwnProperty.call(gateBlocked.body.live_send_gate, 'redacted_execution_plan') &&
        gateBlocked.body.live_send_gate.redacted_execution_plan?.message_sha256 &&
        !JSON.stringify(gateBlocked.body.live_send_gate).includes(samplePhone) &&
        !JSON.stringify(gateBlocked.body.live_send_gate).includes('Safe E2E scheduled dry-run only. Do not send.'),
      {
        response: gateBlocked.body,
        summary: gateBlocked.body?.error,
      },
    )

    const dry = await jsonFetch('/api/scheduled-messages/send', {
      method: 'POST',
      body: JSON.stringify({ id, confirm_send: true, dry_run: true }),
    })
    const provenance = dry.body?.send_provenance
    const provenanceOk = provenance?.source_label === 'clapcheeks_scheduled_messages_send_api' &&
      provenance?.route === 'POST /api/scheduled-messages/send' &&
      provenance?.phone_last4 === sampleLast4 &&
      typeof provenance?.request_id === 'string' &&
      typeof provenance?.message_sha256 === 'string' &&
      provenance.message_sha256.length === 64 &&
      provenance?.message_length === 'Safe E2E scheduled dry-run only. Do not send.'.length
    record('scheduled dry-run', dry.res.ok && dry.body?.dry_run === true && dry.body?.would_send?.phone_last4 === sampleLast4 && provenanceOk, {
      response: dry.body,
      provenance_ok: provenanceOk,
      summary: dry.body?.would_send ? `adapter=${dry.body.would_send.adapter} provenance=${provenanceOk}` : dry.body?.error,
    })
  } finally {
    const cancel = await jsonFetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' })
    record('scheduled cleanup cancel', cancel.res.ok && cancel.body?.message?.status === 'failed', {
      response: cancel.body,
      summary: cancel.body?.message?.rejection_reason || cancel.body?.error,
    })
  }
}

async function verifyNoActiveTestFixtures() {
  const statuses = ['pending', 'approved']
  const fixtures = []

  for (const status of statuses) {
    const list = await jsonFetch(`/api/scheduled-messages?status=${status}&limit=200`)
    if (!list.res.ok) {
      record('scheduled fixture cleanup', false, {
        status,
        response: list.body,
        summary: `could not list ${status} scheduled messages`,
      })
      return
    }

    for (const message of list.body?.messages || []) {
      const name = String(message.match_name || '')
      const isFixture = name.startsWith('Safe E2E Readiness') ||
        name.startsWith('Safe E2E Browser Guardrail') ||
        name.startsWith('Live Send Evidence')
      if (isFixture) fixtures.push(message)
    }
  }

  const cleanup = []
  for (const fixture of fixtures) {
    const id = fixture.id || fixture._id
    if (!id) {
      cleanup.push({ id: null, ok: false, reason: 'missing id', match_name: fixture.match_name })
      continue
    }
    const cancel = await jsonFetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' })
    cleanup.push({
      id,
      ok: cancel.res.ok && cancel.body?.message?.status === 'failed',
      status: cancel.body?.message?.status,
      rejection_reason: cancel.body?.message?.rejection_reason,
      match_name: fixture.match_name,
    })
  }

  const remaining = []
  for (const status of statuses) {
    const list = await jsonFetch(`/api/scheduled-messages?status=${status}&limit=200`)
    for (const message of list.body?.messages || []) {
      const name = String(message.match_name || '')
      const isFixture = name.startsWith('Safe E2E Readiness') ||
        name.startsWith('Safe E2E Browser Guardrail') ||
        name.startsWith('Live Send Evidence')
      if (isFixture) remaining.push({ id: message.id || message._id, status: message.status, match_name: name })
    }
  }

  record('scheduled fixture cleanup', remaining.length === 0 && cleanup.every((item) => item.ok !== false), {
    cleaned: cleanup,
    remaining,
    summary: remaining.length === 0 ? `active fixtures=${remaining.length}` : `${remaining.length} active fixtures remain`,
  })
}

async function main() {
  console.log(`Safe ClapCheeks E2E readiness against ${base}`)
  await assertRoute('/dashboard', ['ROSTER COMMAND CENTER', 'Test iMessage Automation'])
  await assertRoute('/scheduled', ['Scheduled Messages', '+ Schedule Message'])
  await assertRoute('/intelligence', [])
  await assertRoute('/analytics', ['Analytics'])
  await verifyCoreRouteMatrix()
  await verifyAnalyticsSummaryContract()
  await verifyDashboardHealthContract()
  await verifyMessagesDbReadOnly()
  await verifyImessageDryRun()
  await verifyScheduledDryRun()
  await verifyNoActiveTestFixtures()

  const ok = checks.every((check) => check.ok)
  const evidence = {
    ok,
    base,
    sample_last4: sampleLast4,
    generated_at: new Date().toISOString(),
    no_live_send_performed: true,
    checks,
  }
  await import('node:fs').then((fs) => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2)))
  console.log(`Evidence: ${evidencePath}`)
  if (!ok) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
