"""Read Tinder's X-Auth-Token from the local Chrome on this Mac.

Three strategies, tried in order. All zero-cost and local:

    1. AppleScript + Chrome "Allow JavaScript from Apple Events"
       Opens/focuses tinder.com and runs JS to read localStorage.
       Requirement: Chrome > View > Developer > "Allow JavaScript from
       Apple Events" enabled once.

    2. Chrome DevTools Protocol on localhost:9222
       Requires Chrome launched with --remote-debugging-port=9222.

    3. (deferred) Chrome LevelDB disk read — Chrome encrypts localStorage
       values with the macOS keychain, so this is a last resort and not
       currently implemented.

If none work, the caller (tinder_api.py) falls back to the Browserbase
flow in tinder_auth.py. Same public shape: returns {token, ...} or raises.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from pathlib import Path

import requests

logger = logging.getLogger("clapcheeks.tinder_local")

_ENV_FILE = Path.home() / ".clapcheeks" / ".env"
_LOCAL_STORAGE_KEYS = (
    "TinderWeb/APIToken",
    "TinderWeb/ApiToken",
    "auth_token",
    "X-Auth-Token",
    "userSessionToken",
)

# Candidate app bundles to drive via AppleScript, in order.
_CHROME_APPS = ("Google Chrome", "Chromium", "Brave Browser", "Arc")

CDP_PORT_DEFAULT = 9222


class TinderLocalAuthFailed(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def refresh_token(*, timeout_seconds: int = 20) -> dict:
    """Pull a fresh Tinder token from the local browser. Write to .env."""
    strategies = (
        ("applescript", _read_via_applescript),
        ("cdp", _read_via_cdp),
    )
    errors: list[str] = []
    for name, fn in strategies:
        try:
            token = fn(timeout_seconds=timeout_seconds)
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            logger.debug("strategy %s failed: %s", name, exc)
            continue
        if token:
            _persist_token(token)
            logger.info("Tinder token harvested locally via %s", name)
            return {"token": token, "source": name}
    raise TinderLocalAuthFailed(
        "Local Chrome did not yield a Tinder token. Tried: " + "; ".join(errors)
    )


# ---------------------------------------------------------------------------
# Strategy 1 — AppleScript
# ---------------------------------------------------------------------------

_ENSURE_TAB_JS = """
(function(){
  return {
    url: location.href,
    keys: Object.keys(localStorage),
    values: Object.fromEntries(
      Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])
    ),
    cookies: document.cookie
  };
})();
"""


def _applescript(src: str) -> str:
    r = subprocess.run(
        ["osascript", "-e", src],
        capture_output=True, text=True, timeout=20,
    )
    if r.returncode != 0:
        raise TinderLocalAuthFailed(f"osascript: {r.stderr.strip()}")
    return r.stdout.strip()


def _find_or_open_tinder_tab(app_name: str) -> str:
    """Focus or open a tinder.com tab. Returns the JSON-ish blob
    returned by `_ENSURE_TAB_JS`.
    """
    # The AppleScript: search windows/tabs for one whose URL contains
    # "tinder.com". If not found, open a new tab to tinder.com, wait
    # a few seconds, then run the JS.
    tmpl = r'''
on run
  tell application "{APP}"
    activate
    set targetTabRef to missing value
    set targetWinRef to missing value
    try
      repeat with w in windows
        set i to 0
        repeat with t in tabs of w
          set i to i + 1
          if URL of t contains "tinder.com" then
            set targetTabRef to t
            set targetWinRef to w
            set active tab index of w to i
            exit repeat
          end if
        end repeat
        if targetTabRef is not missing value then exit repeat
      end repeat
    end try
    if targetTabRef is missing value then
      set targetWinRef to (make new window)
      set targetTabRef to active tab of targetWinRef
      set URL of targetTabRef to "https://tinder.com/app/recs"
      delay 4
    end if
    -- Give the page a second to hydrate localStorage
    delay 1
    set jsCmd to "JSON.stringify((" & quoted form of "{JS}" & "))"
    -- A cleaner approach: inject JSON.stringify around our function
    set output to execute targetTabRef javascript "JSON.stringify((" & "{JS}" & "))"
    return output
  end tell
end run
'''
    # Escape the JS body once (no backslashes in ours, just strip newlines)
    js_inline = _ENSURE_TAB_JS.replace("\n", " ").replace('"', '\\"')
    src = (
        tmpl.replace("{APP}", app_name)
            .replace("{JS}", js_inline)
    )
    return _applescript(src)


def _read_via_applescript(*, timeout_seconds: int) -> str | None:
    _ = timeout_seconds  # unused — AppleScript is fast
    last_err: str | None = None
    for app in _CHROME_APPS:
        try:
            raw = _find_or_open_tinder_tab(app)
        except TinderLocalAuthFailed as exc:
            last_err = str(exc)
            continue
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            last_err = f"{app}: AppleScript returned non-JSON"
            continue
        token = _pick_token(data.get("values") or {}, data.get("cookies") or "")
        if token:
            return token
        last_err = f"{app}: page loaded but no token key found"
    if last_err:
        raise TinderLocalAuthFailed(last_err)
    return None


# ---------------------------------------------------------------------------
# Strategy 2 — CDP (Chrome remote-debugging-port)
# ---------------------------------------------------------------------------

def _read_via_cdp(*, timeout_seconds: int = 20) -> str | None:
    port = int(os.environ.get("CLAPCHEEKS_CDP_PORT", CDP_PORT_DEFAULT))
    host = os.environ.get("CLAPCHEEKS_CDP_HOST", "localhost")

    # Discover a tinder.com tab
    try:
        tabs = requests.get(
            f"http://{host}:{port}/json", timeout=5,
        ).json()
    except Exception as exc:
        raise TinderLocalAuthFailed(
            f"Chrome CDP unreachable at {host}:{port} ({exc}). "
            "Launch Chrome with --remote-debugging-port=9222 or enable "
            "AppleScript path."
        )
    tinder_tabs = [
        t for t in tabs
        if "tinder.com" in (t.get("url") or "") and t.get("type") == "page"
    ]
    if not tinder_tabs:
        raise TinderLocalAuthFailed("No tinder.com tab found via CDP.")

    # Use Playwright's CDP client to evaluate
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError as exc:
        raise TinderLocalAuthFailed(
            f"Playwright unavailable: {exc}"
        ) from exc

    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(f"http://{host}:{port}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        target = None
        for p in ctx.pages:
            if "tinder.com" in p.url:
                target = p
                break
        if not target:
            raise TinderLocalAuthFailed(
                "Connected via CDP but no tinder.com page found."
            )
        data = target.evaluate(_ENSURE_TAB_JS)
    token = _pick_token(data.get("values") or {}, data.get("cookies") or "")
    return token


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pick_token(values: dict, cookies: str) -> str | None:
    import re as _re
    jwt_re = _re.compile(r"^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
    uuid_re = _re.compile(r"^[0-9a-f-]{20,40}$")

    # Direct key lookup first
    for k in _LOCAL_STORAGE_KEYS:
        v = values.get(k)
        if v:
            return _strip(v)

    # Scan for JWT / UUID shapes
    for k, v in values.items():
        if not isinstance(v, str):
            continue
        s = _strip(v)
        if jwt_re.match(s) or uuid_re.match(s):
            logger.info("Found token candidate under localStorage key %s", k)
            return s

    # Cookie fallback
    for part in cookies.split(";"):
        part = part.strip()
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        if k.strip().lower() in {"x-auth-token", "authtoken", "auth_token"}:
            return _strip(v)
    return None


def _strip(v: str) -> str:
    v = v.strip()
    if v.startswith('"') and v.endswith('"'):
        v = v[1:-1]
    return v


def _persist_token(token: str) -> None:
    updates = {
        "TINDER_AUTH_TOKEN": token,
        "TINDER_WIRE_FORMAT": "json",
        "CLAPCHEEKS_TINDER_MODE": "api",
    }
    _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    current: dict[str, str] = {}
    order: list[str] = []
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            s = line.strip()
            if "=" in s and not s.startswith("#"):
                k, v = s.split("=", 1)
                k = k.strip()
                current[k] = v.strip().strip('"').strip("'")
                if k not in order:
                    order.append(k)
            else:
                order.append(line)
    current.update(updates)
    for k in updates:
        if k not in order:
            order.append(k)
    seen: set[str] = set()
    lines: list[str] = []
    for marker in order:
        if marker in current and marker not in seen:
            lines.append(f"{marker}={current[marker]}")
            seen.add(marker)
        elif "=" in marker or not marker.strip() or marker.strip().startswith("#"):
            lines.append(marker)
    for k, v in current.items():
        if k not in seen:
            lines.append(f"{k}={v}")
    _ENV_FILE.write_text("\n".join(lines) + "\n")
    try:
        _ENV_FILE.chmod(0o600)
    except Exception:
        pass
    for k, v in updates.items():
        os.environ[k] = v
