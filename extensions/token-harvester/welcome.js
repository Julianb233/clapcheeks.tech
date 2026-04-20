// Reads ?device_token=... from the URL and saves it to chrome.storage.sync.
// Called by install.sh so the user never has to open the popup or paste manually.

function $(id) { return document.getElementById(id); }

const params = new URLSearchParams(location.search);
const token = (params.get('device_token') || '').trim();
const name = (params.get('device_name') || 'chrome-ext').trim();
const origin = (params.get('api_origin') || 'https://clapcheeks.tech').trim();

async function configure() {
  if (!token) {
    return fail('No device_token in URL. Run the install script with your token.');
  }
  if (!chrome?.storage?.sync) {
    return fail('chrome.storage.sync is unavailable. Extension not loaded correctly.');
  }
  try {
    await chrome.storage.sync.set({
      device_token: token,
      device_name: name,
      api_origin: origin,
    });
    ok(token, name, origin);
  } catch (err) {
    fail(`Save failed: ${err.message}`);
  }
}

function ok(token, name, origin) {
  $('msg').textContent = 'Device token saved. Extension is configured.';
  const s = $('status');
  s.style.display = 'block';
  s.innerHTML =
    `<div>device_name:  <code>${escapeHtml(name)}</code></div>` +
    `<div>api_origin:   <code>${escapeHtml(origin)}</code></div>` +
    `<div>device_token: <code>${escapeHtml(token.slice(0, 12) + '...' + token.slice(-4))}</code></div>`;
  $('next').style.display = 'block';
  // Clean the URL so the token isn't left in history
  history.replaceState({}, '', location.pathname);
}

function fail(message) {
  $('msg').textContent = '';
  const s = $('status');
  s.className = 'status error';
  s.style.display = 'block';
  s.textContent = message;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

configure();
