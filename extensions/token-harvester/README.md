# Clapcheeks Token Harvester (Chrome extension)

Pushes your Tinder web auth token to the Clapcheeks cloud whenever you
visit tinder.com. The daemon on your Mac Mini polls Supabase and picks
up the latest token automatically. No Browserbase, no cost, no dedicated
phone.

## Install

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this directory (`extensions/token-harvester`).

You'll see a small icon in the toolbar. Click it, paste your **device
token** (generate one in `clapcheeks.tech/settings/ai → Devices`), and
hit Save.

## How it works

- On any tinder.com page, a content script reads the auth token out of
  `localStorage`.
- The background worker POSTs it to
  `https://clapcheeks.tech/api/ingest/platform-token` with your device
  token as auth.
- The API writes the token to the `clapcheeks_user_settings.tinder_auth_token`
  column (scoped to your user_id via RLS).
- The daemon polls that column every 30 min and writes the fresh token
  to `~/.clapcheeks/.env` so the next platform tick picks it up.

## Privacy

- Only the token + its storage key travel to the API. No message
  contents, swipe history, or personal data.
- Dedup window: same token is only uploaded once per 5 min to avoid
  spam.
- You can revoke the device token any time in `/settings/ai → Devices`.

## Multi-device (recommended when you have many Chromes)

Two layers that together solve "same config across all 7 Chromes":

### 1. Chrome config (the per-install layer)

Two cases depending on how your Chromes are signed in:

**Case A — same Google account on all Chromes.** Turn on Sync
(Settings > You and Google > Sync) for Extensions + Settings. Install
the extension once, paste the device token once. Every other Chrome
on that account inherits it via `chrome.storage.sync`.

**Case B — DIFFERENT Google accounts on each Chrome** (common when
you keep work/personal/throwaway accounts separate). `chrome.storage.sync`
does NOT bridge accounts. You install the extension once per Chrome
(`chrome://extensions` > Load unpacked), open the popup, and paste
the SAME device token into each. One token string, N pastes. Takes
about 10 seconds per Chrome.

That's fine server-side: whatever Chrome harvests a token, the API
resolves your device token to your single user_id, and the daemon
sees one unified view. Last-writer-wins.

If the extension is loaded "unpacked" (dev mode), Chrome won't sync
the *install* itself even with Case A — you'd load-unpacked on each.
Packaging as a `.crx` (or publishing to the Chrome Web Store) fixes
that for Case A: install once, appears everywhere.

### 2. Tinder session (the account layer)

Tinder allows only ONE active web session per account at a time.
Logging in on Chrome #2 silently kills Chrome #1's session. So:

- Designate ONE Chrome per "bank of devices" as your Tinder Chrome.
  Log into tinder.com there.
- The extension on the OTHER Chromes will simply report no token
  found — that's fine, they stay dormant.
- If you move to a new machine, log in there and the extension
  takes over. Last-writer-wins: whichever Chrome just harvested
  a valid token becomes the authoritative one in Supabase.

### Dedicated "Clapcheeks" profile (optional but clean)

On each machine, create a dedicated Chrome profile ("Clapcheeks")
just for tinder.com. Install the extension in that profile only.
Keeps your main browsing isolated from the automation and makes the
answer to "which Chrome harvested last?" deterministic.

## Future additions

- Bumble content script (you already have the pattern — fold it in here
  so all three platforms live in one extension).
- Popup badge with freshness indicator.
- Firefox manifest (file is MV3 so portable).
