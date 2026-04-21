// Receives token harvest messages from content scripts, dedupes,
// and uploads to clapcheeks.tech/api/ingest/platform-token.
//
// Phase M (AI-8345) ALSO hosts a job-poller alarm that drains the
// clapcheeks_agent_jobs queue every ~10s. Each pending job is a
// description of an HTTP request the daemon wants executed inside
// Julian's real Chrome session (credentials: include -> his
// residential IP + genuine cookies + genuine browser fingerprint).
// We fetch, then POST the response back to /api/ingest/api-result.
// This removes the VPS entirely from the anti-bot surface.

const API_ORIGIN_DEFAULT = "https://clapcheeks.tech";
const SYNC_ALARM = "clapcheeks.resync";
const JOB_ALARM = "clapcheeks.jobs";

// Global anti-bot throttle. At most one Tinder/Hinge/Instagram fetch
// every 3s across the whole extension, with 2-8s of random jitter
// ADDED before every fetch. Matches the Phase M spec (AI-8345).
const MIN_GLOBAL_GAP_MS = 3_000;
const JITTER_MIN_MS = 2_000;
const JITTER_MAX_MS = 8_000;

let _lastFetchAt = 0;
let _jobLoopRunning = false;

// Config lives in chrome.storage.sync so all your Chromes (signed into the
// same Google account with Sync enabled) share the device token + API
// origin. Install the extension once, paste the token once, and every
// Chrome you own inherits the setup.
//
// `last_upload` (the dedup cache) stays in chrome.storage.local because it
// is per-device, high-churn, and doesn't need to propagate.
async function getConfig() {
  const [syncPart, localPart] = await Promise.all([
    chrome.storage.sync.get(["api_origin", "device_name", "device_token"]),
    chrome.storage.local.get(["last_upload"]),
  ]);
  return {
    api_origin: syncPart.api_origin || API_ORIGIN_DEFAULT,
    device_name: syncPart.device_name || _hostHint(),
    device_token: syncPart.device_token || "",
    last_upload: localPart.last_upload || {},
  };
}

function _hostHint() {
  // Best-effort "which Chrome is this" tag — shown in dashboard.
  try {
    const parts = (navigator.userAgent.match(/\((.*?)\)/) || [])[1] || "";
    if (parts.includes("Mac")) return "mac-chrome";
    if (parts.includes("Windows")) return "win-chrome";
    if (parts.includes("iPhone")) return "ios-chrome";
    if (parts.includes("Android")) return "android-chrome";
  } catch {}
  return "chrome-ext";
}

async function upload({ platform, token, storage_key }) {
  if (!token) return { ok: false, reason: "no_token" };
  const cfg = await getConfig();
  if (!cfg.device_token) {
    console.warn("[clapcheeks] device_token not set; open the popup.");
    return { ok: false, reason: "no_device_token" };
  }

  // Dedupe — don't repost if same token in the last 5 min
  const cacheKey = `${platform}:${token.slice(-24)}`;
  const last = cfg.last_upload[cacheKey];
  if (last && Date.now() - last < 5 * 60_000) {
    return { ok: true, reason: "cached" };
  }

  let resp;
  try {
    resp = await fetch(`${cfg.api_origin}/api/ingest/platform-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Token": cfg.device_token,
        "X-Device-Name": cfg.device_name,
      },
      body: JSON.stringify({
        platform,
        token,
        storage_key,
        at: Date.now(),
      }),
    });
  } catch (err) {
    console.warn("[clapcheeks] upload network error:", err);
    return { ok: false, reason: "network" };
  }

  if (!resp.ok) {
    console.warn("[clapcheeks] upload rejected:", resp.status, await resp.text());
    return { ok: false, reason: `status_${resp.status}` };
  }

  cfg.last_upload[cacheKey] = Date.now();
  await chrome.storage.local.set({ last_upload: cfg.last_upload });
  return { ok: true };
}

// Harvest Instagram session cookies (HttpOnly, only accessible via
// chrome.cookies API). Requires "cookies" permission + IG host perms.
async function harvestInstagramSession() {
  try {
    const domains = ["https://www.instagram.com", "https://instagram.com"];
    const out = {};
    for (const domain of domains) {
      const cookies = await chrome.cookies.getAll({ url: domain });
      for (const c of cookies) out[c.name] = c.value;
    }
    if (!out.sessionid || !out.ds_user_id) {
      return { ok: false, reason: "no_session" };
    }
    const token = JSON.stringify({
      sessionid: out.sessionid,
      ds_user_id: out.ds_user_id,
      csrftoken: out.csrftoken,
      mid: out.mid,
      ig_did: out.ig_did,
      rur: out.rur,
      harvested_at: Date.now(),
    });
    return await upload({
      platform: "instagram",
      token,
      storage_key: "cookies:instagram",
    });
  } catch (err) {
    console.warn("[clapcheeks] ig harvest error:", err);
    return { ok: false, reason: "ig_harvest_error" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "token_harvest") {
    upload(msg).then(sendResponse);
    return true; // async
  }
  if (msg?.kind === "ig_harvest") {
    harvestInstagramSession().then(sendResponse);
    return true;
  }
  if (msg?.kind === "status") {
    getConfig().then((cfg) => sendResponse({
      api_origin: cfg.api_origin,
      device_name: cfg.device_name,
      configured: !!cfg.device_token,
      last_upload: cfg.last_upload,
    }));
    return true;
  }
  if (msg?.kind === "save_config") {
    // Sync scope so every Chrome on this Google account gets it
    chrome.storage.sync.set({
      api_origin: msg.api_origin || API_ORIGIN_DEFAULT,
      device_name: msg.device_name || _hostHint(),
      device_token: msg.device_token || "",
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Periodic re-harvest alarm — on Chromes that stay open the token can
// rotate silently. The alarm pokes each open Tinder tab every 30 min.
// The JOB_ALARM fires every ~10s and drains the agent-jobs queue.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
  // periodInMinutes min is 1/60 on newer Chrome, else 0.5. Use 0.17
  // (~10s) which Chrome floors to 1m on some channels - acceptable,
  // still yields job throughput well under Tinder's anti-bot radar.
  chrome.alarms.create(JOB_ALARM, { periodInMinutes: 0.17 });
});
chrome.runtime.onStartup.addListener(() => {
  // Re-create alarms on every Chrome startup so the poller comes back
  // even if the user wiped alarms manually.
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
  chrome.alarms.create(JOB_ALARM, { periodInMinutes: 0.17 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    const tabs = await chrome.tabs.query({
      url: ["https://tinder.com/*", "https://*.tinder.com/*",
            "https://hinge.co/*"],
    });
    for (const tab of tabs) {
      try {
        await chrome.tabs.reload(tab.id);
      } catch { /* ignore */ }
    }
    await harvestInstagramSession();
    return;
  }
  if (alarm.name === JOB_ALARM) {
    await drainOneJob();
    return;
  }
});

// ---------------------------------------------------------------------------
// Phase M: agent-jobs queue drainer
// ---------------------------------------------------------------------------
//
// The extension holds a device_token (one per device, generated in
// /settings/ai). It does NOT have a Supabase key. So to fetch "what is
// my next job" it hits a thin server endpoint (/api/agent/next-job)
// that uses the service-role client to look up the owning user and
// return the single oldest pending job.
//
// One job per tick, never batch. Random 2-8s jitter before every
// fetch. Global min-gap of 3s between fetches. Backoff on 429.

async function _nowMs() { return Date.now(); }
function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function _randJitter() {
  return JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
}

async function _respectGlobalGap() {
  const now = await _nowMs();
  const since = now - _lastFetchAt;
  const gap = MIN_GLOBAL_GAP_MS - since;
  if (gap > 0) await _sleep(gap);
}

async function claimNextJob(cfg) {
  // Ask the server for the oldest pending job owned by this device's
  // user. Server atomically transitions pending -> claimed so two
  // extensions (two Chrome windows) don't race on the same row.
  let resp;
  try {
    resp = await fetch(`${cfg.api_origin}/api/agent/next-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Token": cfg.device_token,
        "X-Device-Name": cfg.device_name,
      },
      body: JSON.stringify({ claimed_by: cfg.device_name }),
    });
  } catch (err) {
    console.warn("[clapcheeks] next-job network error:", err);
    return null;
  }
  if (resp.status === 204) return null; // no work
  if (!resp.ok) {
    console.warn("[clapcheeks] next-job rejected:", resp.status, await resp.text());
    return null;
  }
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function deliverResult(cfg, payload) {
  try {
    const r = await fetch(`${cfg.api_origin}/api/ingest/api-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Token": cfg.device_token,
        "X-Device-Name": cfg.device_name,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.warn("[clapcheeks] api-result rejected:", r.status, await r.text());
    }
  } catch (err) {
    console.warn("[clapcheeks] api-result network error:", err);
  }
}

async function drainOneJob() {
  if (_jobLoopRunning) return;
  _jobLoopRunning = true;
  try {
    const cfg = await getConfig();
    if (!cfg.device_token) return; // not configured yet
    const job = await claimNextJob(cfg);
    if (!job || !job.id) return;

    const params = job.job_params || {};
    const url = params.url;
    if (!url) {
      await deliverResult(cfg, {
        job_id: job.id,
        status_code: 0,
        body: null,
        error: "missing_url",
      });
      return;
    }

    // Jitter + global gap BEFORE the fetch so we look human.
    await _respectGlobalGap();
    await _sleep(_randJitter());

    let statusCode = 0;
    let bodyOut = null;
    let errOut = null;
    let headersOut = {};
    try {
      const init = {
        method: (params.method || "GET").toUpperCase(),
        credentials: "include", // ride Julian's real session cookies
        headers: params.headers || {},
      };
      if (params.body !== null && params.body !== undefined &&
          init.method !== "GET" && init.method !== "HEAD") {
        if (typeof params.body === "string") {
          init.body = params.body;
        } else {
          init.body = JSON.stringify(params.body);
          init.headers["Content-Type"] ??= "application/json";
        }
      }
      const resp = await fetch(url, init);
      statusCode = resp.status;
      _lastFetchAt = await _nowMs();

      // Capture useful response headers (Tinder's rate-limit hints).
      try {
        for (const k of ["x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"]) {
          const v = resp.headers.get(k);
          if (v) headersOut[k] = v;
        }
      } catch { /* ignore */ }

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        bodyOut = await resp.json().catch(() => null);
      } else {
        bodyOut = await resp.text().catch(() => null);
      }

      // 429 backoff: skip the next tick by bumping _lastFetchAt far
      // enough out. We DON'T retry here - the daemon decides whether
      // to re-enqueue.
      if (statusCode === 429) {
        _lastFetchAt = (await _nowMs()) + 60_000;
      }
    } catch (err) {
      errOut = String(err && err.message ? err.message : err);
      _lastFetchAt = await _nowMs();
    }

    await deliverResult(cfg, {
      job_id: job.id,
      status_code: statusCode,
      body: bodyOut,
      headers: headersOut,
      error: errOut,
    });
  } finally {
    _jobLoopRunning = false;
  }
}
