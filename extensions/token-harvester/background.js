// Receives token harvest messages from content scripts, dedupes,
// and uploads to clapcheeks.tech/api/ingest/platform-token.

const API_ORIGIN_DEFAULT = "https://clapcheeks.tech";
const SYNC_ALARM = "clapcheeks.resync";

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "token_harvest") {
    upload(msg).then(sendResponse);
    return true; // async
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
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  const tabs = await chrome.tabs.query({
    url: ["https://tinder.com/*", "https://*.tinder.com/*",
          "https://hinge.co/*"],
  });
  for (const tab of tabs) {
    try {
      await chrome.tabs.reload(tab.id);
    } catch { /* ignore */ }
  }
});
