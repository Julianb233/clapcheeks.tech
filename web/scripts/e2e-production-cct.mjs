#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const baseUrl = (process.env.CLAPCHEEKS_PRODUCTION_CCT_BASE_URL || 'https://clapcheeks.tech').replace(/\/$/, '')
const chromeDebugUrl = (process.env.CLAPCHEEKS_CCT_DEBUG_URL || 'http://127.0.0.1:9223').replace(/\/$/, '')
const outputRoot = process.env.CLAPCHEEKS_PRODUCTION_CCT_OUTPUT_DIR || '/tmp'
const latestReportPath = process.env.CLAPCHEEKS_PRODUCTION_CCT_LATEST || '/tmp/clapcheeks-production-cct-latest.json'
const skipLinkSweep = process.env.CLAPCHEEKS_CCT_SKIP_LINK_SWEEP === '1'
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = path.join(outputRoot, `clapcheeks-prod-current-cct-${ts}`)
const reportPath = path.join(outDir, 'report.json')
const operatorEmail = process.env.CLAPCHEEKS_OPERATOR_EMAIL || 'julianb233@gmail.com'
const operatorKeychainService = process.env.CLAPCHEEKS_OPERATOR_KEYCHAIN_SERVICE || 'clapcheeks.tech operator login'

const routes = [
  '/dashboard',
  '/ai-first-date',
  '/matches',
  '/dashboard/matches',
  '/dashboard/roster',
  '/dashboard/content-library',
  '/leads',
  '/communications',
  '/conversation',
  '/scheduled',
  '/intelligence',
  '/analytics',
  '/photos',
  '/coaching',
  '/autonomy',
  '/referrals',
  '/settings/ai',
  '/settings',
  '/billing',
  '/device',
  '/support',
]

const screenshotRoutes = new Set(['/dashboard', '/matches', '/dashboard/roster', '/leads', '/communications', '/device'])
const archivedStatuses = new Set(['archived', 'hidden', 'deleted', 'archived_cluster_dupe'])
const imageFields = ['profile_image', 'profile_image_url', 'image_url', 'photo_url', 'primary_photo_url', 'avatar_url']
const keyApis = {
  health: '/api/health',
  token: '/api/agent/token-health',
  status: '/api/agent/status',
  device: '/api/device-control/status',
  analytics: '/api/analytics/summary?days=30',
  profile: '/api/match-profile/add?include_archived=0',
  aiSettings: '/api/ai-settings',
  autonomy: '/api/autonomy-config',
  billing: '/api/billing/status',
  scheduled: '/api/scheduled-messages?status=all&limit=100',
}

mkdirSync(outDir, { recursive: true })

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url}; got status ${response.status}`)
  }
}

function routeUrl(route) {
  return `${baseUrl}${route}`
}

function localApiPath(pathname) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`
}

function photosOf(match) {
  if (Array.isArray(match?.photos)) return match.photos
  if (Array.isArray(match?.profile_photos)) return match.profile_photos
  if (Array.isArray(match?.images)) return match.images
  if (Array.isArray(match?.match_intel?.photos)) return match.match_intel.photos
  return []
}

function hasImage(match) {
  return photosOf(match).length > 0 || imageFields.some((field) => typeof match?.[field] === 'string' && match[field])
}

function platformOf(match) {
  return String(match?.platform || match?.app || '').toLowerCase()
}

function nameOf(match) {
  return String(match?.name || match?.match_name || match?.first_name || '').trim()
}

function deviceStatusSummary(body) {
  const physical = body?.physical_ios || {}
  const transport = physical.transport_visibility || body?.transport_visibility || {}
  return {
    topology: physical.device_topology || null,
    blockers: physical.latest_known_blockers || physical.blockers || [],
    latest_blockers_source: physical.latest_blockers_source || null,
    transport_visibility: transport,
    ios_deploy_bound_udid_visible: transport.ios_deploy_bound_udid_visible ?? null,
    ios_deploy_connection: transport.ios_deploy_connection ?? null,
    pairing_record_for_bound_udid: transport.pairing_record_for_bound_udid ?? null,
    coredevice_bound_udid_visible: transport.coredevice_bound_udid_visible ?? null,
    latest_transport_diagnostics_status: physical.latest_transport_diagnostics?.status || null,
    latest_transport_diagnostics_source: physical.latest_transport_diagnostics?.source || null,
    telemetry_event_id: physical.telemetry_event_id || physical.latest_transport_diagnostics?.telemetry_event_id || null,
    telemetry_occurred_at: physical.telemetry_occurred_at || physical.latest_transport_diagnostics?.telemetry_occurred_at || null,
    transport_blockers: Array.isArray(transport.blockers) ? transport.blockers : [],
  }
}

function summarizeInventory(profileBody) {
  const rows = Array.isArray(profileBody?.profiles)
    ? profileBody.profiles
    : Array.isArray(profileBody?.matches)
      ? profileBody.matches
      : Array.isArray(profileBody)
        ? profileBody
        : []
  const active = rows.filter((row) => !archivedStatuses.has(String(row?.status || '').toLowerCase()))
  const hinge = active.filter((row) => platformOf(row) === 'hinge')
  return {
    rowCount: rows.length,
    total: active.length,
    hinge: hinge.length,
    tinder: active.filter((row) => platformOf(row) === 'tinder').length,
    imessage: active.filter((row) => {
      const platform = platformOf(row)
      return platform === 'imessage' || platform === 'offline'
    }).length,
    hingeWithImages: hinge.filter(hasImage).length,
    genericNames: active.filter((row) => {
      const name = nameOf(row)
      return !name || /^(unknown|unknown match|match|new match)$/i.test(name)
    }).length,
    initialOnlyHinge: hinge
      .filter((row) => /^[A-Z]$/.test(nameOf(row)))
      .map((row) => ({
        id: row.id || row._id,
        name: nameOf(row),
        images: photosOf(row).length,
        identity_quality: row.identity_quality || row.match_intel?.identity_quality || null,
      }))
      .slice(0, 20),
  }
}

function sanitizedFixtureEvidence(fixture) {
  const leadIntel = fixture.leadEditBody?.match?.match_intel || {}
  return {
    status: fixture.status,
    id: fixture.id,
    patchStatus: fixture.patchStatus,
    enrichStatus: fixture.enrichStatus,
    enrichSuccess: fixture.enrichBody?.success === true,
    detail: {
      hasQaNote: fixture.detail?.hasQaNote === true,
      hasDatePlanned: fixture.detail?.hasDatePlanned === true,
      brokenImages: fixture.detail?.brokenImages ?? null,
    },
    leadEditStatus: fixture.leadEditStatus,
    leadEdit: {
      lead_stage: leadIntel.lead_stage || null,
      lead_tag_present: typeof leadIntel.lead_tag === 'string' && leadIntel.lead_tag.length > 0,
      lead_notes_present: typeof leadIntel.lead_notes === 'string' && leadIntel.lead_notes.length > 0,
      lead_outcome: leadIntel.lead_outcome || null,
      lead_stage_entered_at_present: typeof leadIntel.lead_stage_entered_at === 'string' && leadIntel.lead_stage_entered_at.length > 0,
    },
    archiveStatus: fixture.archiveStatus,
  }
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
  return fetchJson(`${chromeDebugUrl}/json/new?${routeUrl('/dashboard')}`, { method: 'PUT' })
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails))
  }
  return result.result.value
}

async function api(client, method, url, body) {
  return evaluate(
    client,
    `fetch(${JSON.stringify(localApiPath(url))}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}
    }).then(async (response) => {
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return { status: response.status, ok: response.ok, body: json, text: text.slice(0, 600) }
    })`,
  )
}

async function pageProof(client, route) {
  await client.send('Page.navigate', { url: routeUrl(route) })
  let settled = null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    settled = await evaluate(
      client,
      `(() => {
        const text = document.body?.innerText || ''
        const lower = text.toLowerCase()
        return {
          readyState: document.readyState,
          textLength: text.length,
          title: document.title,
          appError: lower.includes('application error') || lower.includes('runtime error') || lower.includes('could not load'),
          routeReady: text.length > 80,
          dashboardHealthReady: location.pathname !== '/dashboard' || text.includes('Health check'),
          rosterReady: location.pathname !== '/dashboard/roster' || Boolean(document.querySelector('[data-testid="roster-kanban"]')),
          aiSettingsReady: location.pathname !== '/settings/ai' || text.includes('Approval gates'),
          settingsReady: location.pathname !== '/settings' || text.includes('Weekly Reports'),
          leadsReady: location.pathname !== '/leads' || text.includes('Every match, every stage'),
        }
      })()`,
    )
    if (
        settled.appError ||
      (settled.readyState === 'complete' &&
        settled.routeReady &&
        settled.dashboardHealthReady &&
        settled.rosterReady &&
        settled.aiSettingsReady &&
        settled.settingsReady &&
        settled.leadsReady)
    ) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await evaluate(
    client,
    `new Promise(async (resolve) => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
      resolve(true)
    })`,
  )
  const data = await evaluate(
    client,
    `(() => {
      const text = document.body.innerText || ''
      const lower = text.toLowerCase()
      const anchors = [...document.querySelectorAll('a[href]')].map((anchor) => ({
        href: anchor.href,
        text: (anchor.innerText || anchor.ariaLabel || '').trim().slice(0, 80),
      }))
      const images = [...document.images].map((image) => ({
        src: image.currentSrc || image.src,
        alt: image.alt || '',
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
      }))
      return {
        url: location.href,
        title: document.title,
        textLength: text.length,
        settled: ${JSON.stringify(settled)},
        hasSignIn: lower.includes('sign in') && lower.includes('email'),
        appError: lower.includes('application error') || lower.includes('runtime error') || lower.includes('could not load'),
        brokenImages: images.filter((image) => image.src && image.complete && (image.width === 0 || image.height === 0)),
        imageCount: images.length,
        internalLinks: anchors
          .filter((anchor) => anchor.href.startsWith(${JSON.stringify(baseUrl)}) && !anchor.href.includes('/api/') && !anchor.href.includes('/_next/'))
          .map((anchor) => ({ ...anchor, pathname: new URL(anchor.href).pathname })),
        dashboardHealth: location.pathname === '/dashboard'
          ? {
              visible: text.includes('Health check'),
              noRuntimeBlockers: text.includes('No runtime blockers found.'),
              refreshButton: Boolean(document.querySelector('button[aria-label="Refresh health check"]')),
              mentionsRuntime: text.includes('Live runtime, Convex, billing, and watcher status.'),
            }
          : null,
        rosterControls: location.pathname === '/dashboard/roster'
          ? {
              searchInput: Boolean(document.querySelector('input[aria-label="Search roster"]')),
              searchPlaceholder: Boolean(document.querySelector('input[placeholder*="Search roster"]')),
              favoritesButton: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('Favorites')),
              atRiskButton: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('At-risk health')),
              clearButtonInitiallyHidden: ![...document.querySelectorAll('button')].some((button) => (button.innerText || '').trim() === 'Clear'),
              cardCount: document.querySelectorAll('[data-testid="roster-card"]').length,
              kanbanVisible: Boolean(document.querySelector('[data-testid="roster-kanban"]')),
            }
          : null,
        settingsControls: location.pathname === '/settings'
          ? {
              weeklyReports: lower.includes('weekly reports'),
              emailReportsCheckbox: Boolean(document.querySelector('input[type="checkbox"]')),
              reportDaySelect: Boolean(document.querySelector('select')),
              savePreferencesButton: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('Save preferences')),
              integrationsSection: lower.includes('integrations'),
            }
          : null,
        aiSettingsControls: location.pathname === '/settings/ai'
          ? {
              personaTab: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('Persona')),
              dripTab: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('Drip rules')),
              datesTab: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('Dates & calendar')),
              approvalTab: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').includes('Approval gates')),
              voiceStyleInput: lower.includes('voice style'),
              attractionHooks: lower.includes('attraction hooks'),
              saveButton: [...document.querySelectorAll('button')].some((button) => (button.innerText || '').trim() === 'Save'),
            }
          : null,
        leadsControls: location.pathname === '/leads'
          ? {
              heading: text.includes('Leads'),
              boardCopy: text.includes('Every match, every stage'),
              matchedColumn: text.includes('Matched'),
              openedColumn: text.includes('Opened'),
              replyingColumn: text.includes('Replying'),
              dateProposedColumn: text.includes('Date proposed'),
              dateBookedColumn: text.includes('Date booked'),
              archivedColumn: text.includes('Archived'),
            }
          : null,
        textExcerpt: text.slice(0, 1000),
      }
    })()`,
  )

  if (screenshotRoutes.has(route)) {
    const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const screenshotPath = path.join(outDir, `${route.replace(/^\//, '').replace(/\//g, '-') || 'root'}.png`)
    writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'))
    data.screenshotPath = screenshotPath
  }
  return data
}

function operatorPassword() {
  if (process.env.CLAPCHEEKS_OPERATOR_PASSWORD) return process.env.CLAPCHEEKS_OPERATOR_PASSWORD
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-w', '-s', operatorKeychainService], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

async function ensureAuthenticated(client) {
  await client.send('Page.navigate', { url: routeUrl('/dashboard') })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const current = await evaluate(
    client,
    `(() => ({
      url: location.href,
      text: document.body?.innerText || '',
      emailInputs: document.querySelectorAll('input[type="email"], input[name="email"]').length,
      passwordInputs: document.querySelectorAll('input[type="password"], input[name="password"]').length,
    }))()`,
  )
  if (!current.url.includes('/login') && !/sign in/i.test(current.text)) {
    return { authenticated: true, source: 'existing_session', url: current.url }
  }

  const password = operatorPassword()
  if (!password) {
    return {
      authenticated: false,
      source: 'missing_operator_password',
      url: current.url,
      error: `Missing CLAPCHEEKS_OPERATOR_PASSWORD or Keychain service "${operatorKeychainService}"`,
    }
  }

  await client.send('Page.navigate', { url: routeUrl('/login') })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await evaluate(
    client,
    `(() => {
      const setNativeValue = (element, value) => {
        const prototype = Object.getPrototypeOf(element)
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
        if (descriptor?.set) descriptor.set.call(element, value)
        else element.value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setNativeValue(document.querySelector('input[name="email"], input[type="email"]'), ${JSON.stringify(operatorEmail)})
      setNativeValue(document.querySelector('input[name="password"], input[type="password"]'), ${JSON.stringify(password)})
      document.querySelector('button[type="submit"]')?.click()
      return true
    })()`,
  )

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const status = await evaluate(
      client,
      `(() => ({
        url: location.href,
        text: document.body?.innerText || '',
      }))()`,
    )
    if (status.url.includes('/dashboard') || status.text.includes('ROSTER COMMAND CENTER')) {
      return { authenticated: true, source: 'operator_login', url: status.url }
    }
    if (/invalid login credentials|operator auth is not configured/i.test(status.text)) {
      return { authenticated: false, source: 'operator_login', url: status.url, error: status.text.slice(0, 500) }
    }
  }

  const finalStatus = await evaluate(
    client,
    `(() => ({ url: location.href, text: (document.body?.innerText || '').slice(0, 500) }))()`,
  )
  return { authenticated: false, source: 'operator_login_timeout', ...finalStatus }
}

async function runSafeFixture(client) {
  const fixtureStamp = Date.now().toString().slice(-6)
  const fixture = await api(client, 'POST', '/api/matches/offline', {
    name: `CCT QA ${fixtureStamp}`,
    phone: `757555${fixtureStamp.slice(-4)}`,
    instagram_handle: `cctqa_${fixtureStamp}`,
    met_at: 'production CCT QA',
    first_impression: 'Safe production QA fixture; archive after verification.',
  })
  const fixtureId = fixture.body?.match?.id
  const result = {
    status: fixture.status,
    id: fixtureId,
    patchStatus: null,
    patchBody: null,
    enrichStatus: null,
    enrichBody: null,
    detail: null,
    leadEditStatus: null,
    leadEditBody: null,
    archiveStatus: null,
  }
  if (!fixtureId) return result

  const patch = await api(client, 'PATCH', `/api/matches/${encodeURIComponent(fixtureId)}`, {
    stage: 'date_planned',
    status: 'conversing',
    julian_rank: 7,
    notes: `CCT QA patch ${fixtureStamp}`,
    match_intel_patch: {
      qa_fixture: true,
      qa_stamp: fixtureStamp,
      lead_stage: 'date_proposed',
      operator_notes: `CCT QA operator note ${fixtureStamp}`,
    },
  })
  result.patchStatus = patch.status
  result.patchBody = patch.body

  const enrich = await api(client, 'POST', '/api/match-profile/enrich', {
    profile_id: fixtureId,
  })
  result.enrichStatus = enrich.status
  result.enrichBody = enrich.body

  await client.send('Page.navigate', { url: routeUrl(`/matches/${encodeURIComponent(fixtureId)}`) })
  await new Promise((resolve) => setTimeout(resolve, 1800))
  result.detail = await evaluate(
    client,
    `(() => {
      const text = document.body.innerText || ''
      const formText = [...document.querySelectorAll('textarea,input')]
        .map((element) => element.value || '')
        .join('\\n')
      return {
        url: location.href,
        text: text.slice(0, 2200),
        hasQaNote: text.includes(${JSON.stringify(fixtureStamp)}) || formText.includes(${JSON.stringify(fixtureStamp)}),
        hasDatePlanned: text.toLowerCase().includes('date planned'),
        brokenImages: [...document.images].filter((image) => image.src && image.complete && (image.naturalWidth === 0 || image.naturalHeight === 0)).length,
      }
    })()`,
  )

  const leadEditStamp = new Date().toISOString()
  const leadEdit = await api(client, 'PATCH', `/api/matches/${encodeURIComponent(fixtureId)}`, {
    stage: 'date_planned',
    status: 'active',
    match_intel_patch: {
      qa_fixture: true,
      qa_stamp: fixtureStamp,
      lead_stage: 'date_booked',
      lead_stage_entered_at: leadEditStamp,
      lead_tag: `CCT lead edit ${fixtureStamp}`,
      lead_notes: `CCT lead drawer note ${fixtureStamp}`,
      lead_outcome: 'production_cct_verified',
    },
  })
  result.leadEditStatus = leadEdit.status
  result.leadEditBody = leadEdit.body

  const archive = await api(client, 'DELETE', `/api/matches/${encodeURIComponent(fixtureId)}`)
  result.archiveStatus = archive.status
  return result
}

async function main() {
  const tab = await getCctTab()
  if (!tab.webSocketDebuggerUrl) throw new Error(`CCT tab did not expose a debugger URL from ${chromeDebugUrl}`)
  const client = new CdpClient(tab.webSocketDebuggerUrl)
  await client.open()

  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Network.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    })

    const auth = await ensureAuthenticated(client)

    const pages = []
    for (const route of routes) {
      pages.push({ route, ...(await pageProof(client, route)) })
    }

    const linkPaths = skipLinkSweep
      ? []
      : [
          ...new Set(
            pages
              .flatMap((page) => page.internalLinks.map((link) => link.pathname))
              .filter((pathname) => !pathname.includes('['))
              .filter((pathname) => pathname !== '/logout'),
          ),
        ].slice(0, 100)
    const linkChecks = []
    for (const pathname of linkPaths) {
      const response = await api(client, 'GET', pathname)
      linkChecks.push({ path: pathname, status: response.status, ok: response.status < 400 })
    }

    const apis = {}
    for (const [key, url] of Object.entries(keyApis)) {
      apis[key] = await api(client, 'GET', url)
    }

    const inventory = summarizeInventory(apis.profile.body)
    const fixture = await runSafeFixture(client)
    const autonomyBody = apis.autonomy.body?.config || apis.autonomy.body || {}
    const autonomySave = await api(client, 'PUT', '/api/autonomy-config', {
      config: { ...autonomyBody, global_level: autonomyBody.global_level || 'custom' },
    })
    const suggest = await api(client, 'POST', '/api/conversation/suggest', {
      matchName: 'Maya',
      platform: 'hinge',
      conversationContext: 'She said she loves tiny wine bars and live jazz. Draft a reply that sounds like Julian, short and specific.',
      profile_context: {
        prompts: ['The way to win me over is: pick the spot and make me laugh'],
        interests: ['jazz', 'wine bars'],
      },
    })

    const deviceSummary = deviceStatusSummary(apis.device.body)
    const dashboardPage = pages.find((page) => page.route === '/dashboard')
    const rosterPage = pages.find((page) => page.route === '/dashboard/roster')
    const settingsPage = pages.find((page) => page.route === '/settings')
    const aiSettingsPage = pages.find((page) => page.route === '/settings/ai')
    const leadsPage = pages.find((page) => page.route === '/leads')
    const dashboardHealth = dashboardPage?.dashboardHealth || {}
    const rosterControls = rosterPage?.rosterControls || {}
    const settingsControls = settingsPage?.settingsControls || {}
    const aiSettingsControls = aiSettingsPage?.aiSettingsControls || {}
    const leadsControls = leadsPage?.leadsControls || {}
    const transportBlockers = deviceSummary.transport_blockers || []
    const checks = [
      {
        name: 'all target routes load authenticated',
        pass: pages.every((page) => page.url.startsWith(baseUrl) && page.textLength > 80 && !page.hasSignIn && !page.appError),
      },
      {
        name: 'no broken images on target routes',
        pass: pages.every((page) => page.brokenImages.length === 0),
      },
      {
        name: 'internal links return <400',
        pass: linkChecks.every((link) => link.ok),
      },
      {
        name: 'key authenticated APIs 200',
        pass: Object.values(apis).every((response) => response.status >= 200 && response.status < 300),
      },
      {
        name: 'Hinge inventory has images and no generic names',
        pass: inventory.hinge > 0 && inventory.hingeWithImages === inventory.hinge && inventory.genericNames === 0,
      },
      {
        name: 'safe fixture create patch detail archive',
        pass: fixture.status === 201 &&
          Boolean(fixture.id) &&
          fixture.patchStatus === 200 &&
          fixture.enrichStatus === 200 &&
          fixture.enrichBody?.success === true &&
          fixture.detail?.hasQaNote === true &&
          fixture.detail?.hasDatePlanned === true &&
          fixture.detail?.brokenImages === 0 &&
          fixture.archiveStatus === 200,
      },
      {
        name: 'lead edit persists through match patch API',
        pass: fixture.leadEditStatus === 200 &&
          fixture.leadEditBody?.match?.match_intel?.lead_stage === 'date_booked' &&
          fixture.leadEditBody?.match?.match_intel?.lead_tag === `CCT lead edit ${fixture.leadEditBody?.match?.match_intel?.qa_stamp || ''}` &&
          fixture.leadEditBody?.match?.match_intel?.lead_outcome === 'production_cct_verified',
      },
      {
        name: 'autonomy settings roundtrip save',
        pass: autonomySave.status === 200 && Boolean(autonomySave.body?.config),
      },
      {
        name: 'draft suggestion returns approval-gated copy',
        pass: suggest.status === 200 && Array.isArray(suggest.body?.suggestions) && suggest.body.suggestions.length > 0,
      },
      {
        name: 'device topology and physical blockers visible',
        pass: Boolean(deviceSummary.topology) && Boolean(deviceSummary.blockers?.length),
      },
      {
        name: 'device status uses latest transport telemetry source',
        pass: ['latest_transport_diagnostics_json', 'latest_completion_audit_telemetry'].includes(deviceSummary.latest_blockers_source) &&
          deviceSummary.latest_transport_diagnostics_status === 'loaded' &&
          Array.isArray(deviceSummary.blockers) &&
          Array.isArray(transportBlockers) &&
          transportBlockers.every((blocker) => deviceSummary.blockers.includes(blocker)),
      },
      {
        name: 'dashboard health card renders live service status',
        pass: dashboardHealth.visible === true &&
          dashboardHealth.refreshButton === true &&
          dashboardHealth.mentionsRuntime === true,
      },
      {
        name: 'roster search and filter controls render',
        pass: rosterControls.kanbanVisible === true &&
          rosterControls.searchInput === true &&
          rosterControls.searchPlaceholder === true &&
          rosterControls.favoritesButton === true &&
          rosterControls.atRiskButton === true &&
          typeof rosterControls.cardCount === 'number',
      },
      {
        name: 'settings report controls render',
        pass: settingsControls.weeklyReports === true &&
          settingsControls.emailReportsCheckbox === true &&
          settingsControls.reportDaySelect === true &&
          settingsControls.savePreferencesButton === true &&
          settingsControls.integrationsSection === true,
      },
      {
        name: 'AI settings voice and approval controls render',
        pass: aiSettingsControls.personaTab === true &&
          aiSettingsControls.dripTab === true &&
          aiSettingsControls.datesTab === true &&
          aiSettingsControls.approvalTab === true &&
          aiSettingsControls.voiceStyleInput === true &&
          aiSettingsControls.attractionHooks === true &&
          aiSettingsControls.saveButton === true,
      },
      {
        name: 'leads stage board renders funnel controls',
        pass: leadsControls.heading === true &&
          leadsControls.boardCopy === true &&
          leadsControls.matchedColumn === true &&
          leadsControls.openedColumn === true &&
          leadsControls.replyingColumn === true &&
          leadsControls.dateProposedColumn === true &&
          leadsControls.dateBookedColumn === true &&
          leadsControls.archivedColumn === true,
      },
    ]

    const apiSummary = Object.fromEntries(Object.entries(apis).map(([key, response]) => {
      let summary = response.body
      if (key === 'profile') summary = { rowCount: inventory.rowCount, inventory }
      if (key === 'scheduled') {
        const rows = Array.isArray(response.body?.messages)
          ? response.body.messages
          : Array.isArray(response.body?.scheduled_messages)
            ? response.body.scheduled_messages
            : Array.isArray(response.body)
              ? response.body
              : []
        summary = {
          total: rows.length,
          by_status: rows.reduce((acc, row) => {
            const status = String(row?.status || 'unknown')
            acc[status] = (acc[status] || 0) + 1
            return acc
          }, {}),
          redacted: true,
        }
      }
      if (key === 'device') {
        summary = deviceStatusSummary(response.body)
      }
      if (key === 'analytics') summary = response.body?.totals || response.body
      return [key, { status: response.status, ok: response.ok, summary }]
    }))
    const screenshots = pages.filter((page) => page.screenshotPath).map((page) => page.screenshotPath)

    const fixtureEvidence = sanitizedFixtureEvidence(fixture)
    const report = {
      ts,
      outDir,
      baseUrl,
      chromeDebugUrl,
      auth,
      pages,
      screenshots,
      linkChecks,
      skipLinkSweep,
      apis: apiSummary,
      inventory,
      deviceStatus: deviceSummary,
      fixture: fixtureEvidence,
      autonomySave: { status: autonomySave.status, ok: autonomySave.ok },
      suggest: {
        status: suggest.status,
        count: suggest.body?.suggestions?.length || 0,
        suggestions: suggest.body?.suggestions || null,
      },
      checks,
      passed: checks.filter((check) => check.pass).length,
      total: checks.length,
      noLiveOutboundSendPerformed: true,
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    writeFileSync(latestReportPath, JSON.stringify(report, null, 2))

    const summary = {
      reportPath,
      latestReportPath,
      auth,
      passed: report.passed,
      total: report.total,
      failed: checks.filter((check) => !check.pass),
      inventory,
      fixture: fixtureEvidence,
      screenshots,
    }
    console.log(JSON.stringify(summary, null, 2))
    if (!auth.authenticated || report.passed !== report.total) process.exitCode = 1
  } finally {
    client.close()
  }
}

main().catch((error) => {
  const failure = {
    reportPath,
    latestReportPath,
    error: error instanceof Error ? error.message : String(error),
    noLiveOutboundSendPerformed: true,
  }
  writeFileSync(reportPath, JSON.stringify(failure, null, 2))
  writeFileSync(latestReportPath, JSON.stringify(failure, null, 2))
  console.error(JSON.stringify(failure, null, 2))
  process.exit(1)
})
