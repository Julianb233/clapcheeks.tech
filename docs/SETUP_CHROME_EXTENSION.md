# Chrome Extension Setup — Making Hinge / IG / Tinder Actually Pull Data

The clapcheeks daemon on the VPS never calls tinder.com / hinge.co /
instagram.com directly anymore (that tripped Tinder's anti-bot on
2026-04-20). Everything flows through a Chrome extension that runs in
Julian's real browser, uses `credentials: 'include'` on `fetch()`, and
posts results back to `clapcheeks.tech/api/ingest/api-result`.

Without the extension installed and running somewhere, **no jobs get
drained**. That's the single missing piece today.

## Current State (2026-04-24)

| Platform | Token in DB | Source | Last Refresh |
|----------|-------------|--------|--------------|
| Hinge     | ✅ present  | iphone-mitm (HTTP Toolkit on iOS) | 2026-04-22 |
| Instagram | ✅ present  | chrome-extension (stale, pre-reinstall)  | 2026-04-20 |
| Tinder    | ❌ missing  | —      | never        |

**Extension status:** no device registered with a recent `last_seen_at`.
The old `iphone-mitm` row exists (for iOS traffic capture) but that
path doesn't drain the job queue — that's a Chrome-only loop.

## One-Time Install (~2 min)

1. On your MacBook Pro, clone the repo if you haven't already:
   ```bash
   cd ~
   git clone git@github.com:Julianb233/clapcheeks.tech.git
   ```

2. In Chrome, go to `chrome://extensions` → toggle **Developer mode** on
   (top right) → click **Load unpacked** → select the folder
   `~/clapcheeks.tech/extensions/token-harvester/`.

3. Pin the extension to the toolbar (puzzle icon → pin).

4. Click the extension icon → paste the device token:
   ```
   vCXauk9mtBMiL330nXzkirMPyGRUhHE_ZlrVUmQ4Od2SXTcSLbLs8-m8v_SvKDGG
   ```
   Keep `api_origin` at `https://clapcheeks.tech` and `device_name` at
   `julian-mbp-chrome` (whatever you like). Click **Save**.

That's it. The extension now:
- polls `clapcheeks.tech/api/agent/next-job` every ~10s and drains
  any pending Hinge / Tinder / Instagram jobs using your real session
- harvests the Tinder + Hinge auth tokens from localStorage whenever
  you visit those sites, and POSTs them to the ingest endpoint
- uses `chrome.cookies` to capture Instagram session cookies (sessionid,
  ds_user_id, csrftoken, mid, ig_did) whenever you visit instagram.com

## Per-Platform Setup

### Instagram (you did this already)
Just visit `https://www.instagram.com/` in the same Chrome profile
where the extension is installed. The extension will automatically
harvest fresh session cookies and update `clapcheeks_user_settings
.instagram_auth_token`. No further action.

### Hinge
Visit `https://hinge.co` in the same Chrome profile. The content script
will harvest the auth token from localStorage. (The existing Hinge
token came from the iOS app via HTTP Toolkit — still works, but the
Chrome path keeps it fresh.)

### Tinder
Visit `https://tinder.com` in the same Chrome profile. Log in if you
aren't already. The content script picks up `TinderWeb/APIToken` from
localStorage and posts it to the ingest endpoint. Within ~5 seconds
`clapcheeks_user_settings.tinder_auth_token` will be populated and the
`snapshot_now.py` CLI will start returning real matches.

## Verify It's Working

Run on the VPS:
```bash
cd /opt/agency-workspace/clapcheeks.tech
PYTHONPATH=agent python3 agent/scripts/snapshot_now.py
```

Expected output when the extension is active:
```
Chrome extension: ACTIVE (device 'julian-mbp-chrome' active)

[hinge] pulling matches + top 5 threads…
  ✓ 23 matches, 5 threads (12.4s)

[instagram] pulling DM inbox + top 5 threads…
  ✓ 18 threads in inbox, 5 fully pulled (15.1s)

[tinder] pulling matches + bundled messages…
  ✓ 47 matches (7.8s)
```

Output gets saved to `~/.clapcheeks/snapshots/snapshot-<timestamp>.json`
for eyeballing.

## Troubleshooting

### "Extension: OFFLINE" after install
- Make sure you clicked **Save** in the popup after pasting the token
- Reload the extension (`chrome://extensions` → toggle off / on)
- Open the service worker console (Details → Inspect service worker)
  and look for errors
- The status is based on `clapcheeks_agent_tokens.last_seen_at`, which
  gets updated by the `/api/agent/next-job` endpoint — if you haven't
  hit that endpoint yet, status will stay OFFLINE until the first poll

### Tinder selfie verification
If you started seeing "verify it's you" flows on tinder.com after
2026-04-20, that's the spillover from the old VPS-direct architecture.
Complete the verification; the new Chrome-extension path should not
trigger it again (credentials come from your real browser session).

### Instagram sessions expire
Instagram session cookies last ~30 days. If jobs start returning 401,
visit instagram.com and log in again — the extension will capture
fresh cookies automatically.

## Minting a Second Device Token

If you want a separate Chrome profile (e.g. Mac Mini + MacBook Pro):
```bash
cd /opt/agency-workspace/clapcheeks.tech
PYTHONPATH=agent python3 agent/scripts/mint_device_token.py \
  --device-name julian-mini-chrome
```

Each Chrome profile needs its own token — they are stored per-row in
`clapcheeks_agent_tokens`. Having two active is fine; the job-claim
endpoint is atomic so they won't race.

## Architecture Recap

```
┌──────────┐  enqueue_job  ┌─────────────────────────┐
│  daemon  │──────────────▶│ clapcheeks_agent_jobs   │
│  (VPS)   │               │ (pending / claimed /    │
│          │◀─ poll result │  completed / stale)     │
└──────────┘               └─────────────────────────┘
                                  ▲            │
                      claim via   │            │ POST result
                   /api/agent/    │            │
                      next-job    │            ▼
                           ┌──────────────────────┐
                           │ token-harvester      │
                           │ Chrome extension     │
                           │ (Julian's MBP)       │
                           └──────────────────────┘
                                  │
                                  │ fetch(..., credentials: 'include')
                                  ▼
                           Tinder / Hinge / Instagram
                           (Julian's real session + IP)
```

**This is the Phase M (AI-8345) architecture.** The VPS stays safely off
the anti-bot surface; every request that matters rides Julian's genuine
browser fingerprint + residential IP.
