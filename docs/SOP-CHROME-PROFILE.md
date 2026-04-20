---
title: Clapcheeks Chrome Profile — Canonical Setup
owner: Julian Bradley
last_updated: 2026-04-20
status: active
related: AI-8313
---

# Clapcheeks Chrome Profile — Canonical Setup

The single source of truth for which Chrome profile Clapcheeks uses, on every Mac Julian owns now and in the future. Agents and humans should always refer back to this doc when setting up a new device.

## The Canonical Profile

| Field | Value |
|---|---|
| **Profile display name** | `cc.tech` (shorthand for clapcheeks.tech — NEVER `Clapcheeks`, `Default`, `.tech`, or anything else) |
| **Chrome user_data_dir** | `$HOME/clapcheeks-chrome/chrome-profile` |
| **Extension path** | `$HOME/clapcheeks-chrome/repo/extensions/token-harvester` |
| **Repo checkout** | `$HOME/clapcheeks-chrome/repo` (clapcheeks.tech, branch: main) |
| **Logs** | `$HOME/clapcheeks-chrome/logs/chrome.{log,err.log}` |
| **Google account signed in** | `julianb233@gmail.com` (personal; same as Clapcheeks super_admin at clapcheeks.tech) |
| **Device token source** | Supabase `clapcheeks_agent_tokens` row where `device_name = 'chrome-extension'`; retrieve with `op item get mbaostn3yooyhlolfxn7pu4nim --reveal` if you need it again |
| **LaunchAgent label** | `tech.clapcheeks.chrome` |
| **Clickable launcher** | `$HOME/Applications/Clapcheeks Chrome.app` |

**Never use a different profile or rename these paths.** The daemon, extension, and SOPs all assume this layout.

## What This Profile Is For

- Running the Clapcheeks Token Harvester Chrome extension to capture tinder.com's `X-Auth-Token` from localStorage
- Staying logged into tinder.com so the extension has something to harvest
- Isolated from Julian's default browsing — a single-purpose second Chrome window

## Isolation from Julian's Default Chrome Profile

Julian's DEFAULT Chrome profile is signed into `julian@aiacrobatics.com` (AI Acrobatics business). It lives in `~/Library/Application Support/Google/Chrome/Default/` and shares NOTHING with the cc.tech profile.

The cc.tech profile is a separate Chrome instance:

- Lives at `~/clapcheeks-chrome/chrome-profile/` (outside Chrome's default `Application Support` tree)
- Launched with `--user-data-dir` pointing at that dir, so Chrome treats it as an independent profile
- Appears in the Dock as a second Chrome window, distinct from the default
- Cookies, extensions, history, logins all isolated

This is intentional. Clapcheeks never touches the business profile and vice versa.

## Always-On Behavior

The user-scope LaunchAgent runs at login (`RunAtLoad=true`) and auto-restarts on crash (`KeepAlive: Crashed=true`). So:

- cc.tech Chrome window opens automatically when Julian logs in
- If the window is closed or Chrome crashes, it relaunches within 2 minutes
- One window is always visible in the Dock alongside the default Chrome
- To stop it entirely: `launchctl unload ~/Library/LaunchAgents/tech.clapcheeks.chrome.plist`

## What It Is NOT For

- General browsing
- Logging into client accounts (GHL, Stripe, etc.)
- Any other dating platform that the extension doesn't know about
- Testing experimental Chrome extensions

## Setup on a New Mac

One-liner. Run in Terminal on the target Mac:

```bash
# 1. Authorize the fleet SSH key so agents can reach this Mac later
curl -fsSL https://raw.githubusercontent.com/Julianb233/clapcheeks.tech/main/scripts/authorize-fleet-key.sh | sudo bash

# 2. Install the Clapcheeks Chrome extension + profile
curl -fsSL https://raw.githubusercontent.com/Julianb233/clapcheeks.tech/main/extensions/token-harvester/install.sh \
  | bash -s -- 3KCgWJxXDmBZkzdg_rXaOYjwwU2GZmA4vhK5xr7KLasnp4e8GVRsTV1xbrYKdPGL
```

After that, an agent (or Julian) can finish the setup remotely:

- Sign the profile into `julianb233@gmail.com` (Chrome UI, profile icon top-right)
- Log into tinder.com in the Clapcheeks window
- Done — extension harvests on every tinder.com page load

## Programmatic Launch

On any Mac with the profile installed, this exact command opens Chrome with everything wired:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/clapcheeks-chrome/chrome-profile" \
  --load-extension="$HOME/clapcheeks-chrome/repo/extensions/token-harvester" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --no-first-run --no-default-browser-check \
  https://tinder.com/app/recs
```

Or: double-click `~/Applications/Clapcheeks Chrome.app`.

## Persistence

A user-scope LaunchAgent at `~/Library/LaunchAgents/tech.clapcheeks.chrome.plist` auto-restarts Chrome if it crashes (`KeepAlive: Crashed=true`). It does NOT run at login (`RunAtLoad: false`) — Julian starts it manually via the `.app` or `launchctl start`.

Control:

```bash
launchctl load   ~/Library/LaunchAgents/tech.clapcheeks.chrome.plist   # start
launchctl unload ~/Library/LaunchAgents/tech.clapcheeks.chrome.plist   # stop
launchctl kickstart -kp gui/$(id -u)/tech.clapcheeks.chrome            # restart
```

## Why One Profile, Not Multiple

- Tinder web allows exactly one active session per account. Multiple Chromes logged in cancel each other out. Picking one canonical profile ensures whichever Mac is active is the authoritative source.
- `chrome.storage.sync` propagates the extension's device token across every Chrome signed into `julianb233@gmail.com` — so even when Julian hasn't manually installed the extension on a new Mac, its config is ready to flow in once install.sh runs.
- Consistent `user_data_dir` path (`~/clapcheeks-chrome/chrome-profile`) means every SOP, launchd plist, and shell script can reference it without per-host variation.

## When You Reset / Reinstall

If the profile gets corrupted or the extension is disabled:

```bash
# Nuke the profile (cookies, extension state — tinder login will be lost)
rm -rf ~/clapcheeks-chrome/chrome-profile

# Rerun install to recreate + reseed the token
curl -fsSL https://raw.githubusercontent.com/Julianb233/clapcheeks.tech/main/extensions/token-harvester/install.sh \
  | bash -s -- 3KCgWJxXDmBZkzdg_rXaOYjwwU2GZmA4vhK5xr7KLasnp4e8GVRsTV1xbrYKdPGL

# Sign back into tinder.com in the new Chrome window
```

## Audit Trail

Who/what accesses this profile gets written to:

- `~/clapcheeks-chrome/logs/chrome.err.log` — Chrome console output
- `clapcheeks_agent_tokens` in Supabase (`last_seen_at` bumped on every harvest)
- `~/.clapcheeks/logs/daemon.err.log` on Mac Mini — every token pull from Supabase

## Related

- [[AI-8313]] — extend god CLI / fleet SSH to reach more Macs (blocks future multi-Mac agent autonomy)
- `docs/SETUP_HINGE_MITM.md` in `clapcheeks.tech` repo — Hinge uses a different path (iPhone mitmproxy), not this Chrome profile
- `extensions/token-harvester/install.sh` — canonical setup script
- `scripts/authorize-fleet-key.sh` — canonical SSH key authorization
