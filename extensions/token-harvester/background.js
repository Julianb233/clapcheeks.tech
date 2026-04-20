// Receives token harvest messages from content scripts, dedupes,
// and uploads to clapcheeks.tech/api/ingest/platform-token.

const API_ORIGIN_DEFAULT = "https://clapcheeks.tech";
const SYNC_ALARM = "clapcheeks.resync";

// Stored config + last-sent state
async function getConfig() {
  const { api_origin, device_name, device_token, last_upload } =
    await chrome.storage.local.get([
      "api_origin", "device_name", "device_token", "last_upload",
    ]);
  return {
    api_origin: api_origin || API_ORIGIN_DEFAULT,
    device_name: device_name || "chrome-ext",
    device_token: device_token || "",
    last_upload: last_upload || {},
  };
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
    chrome.storage.local.set({
      api_origin: msg.api_origin || API_ORIGIN_DEFAULT,
      device_name: msg.device_name || "chrome-ext",
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
