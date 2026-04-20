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

## Multi-device

Install the extension on every Chrome you're signed into tinder.com on.
The last-writer-wins: whichever Chrome most recently harvested a token
becomes the one the daemon uses.

## Future additions

- Bumble content script (you already have the pattern — fold it in here
  so all three platforms live in one extension).
- Popup badge with freshness indicator.
- Firefox manifest (file is MV3 so portable).
