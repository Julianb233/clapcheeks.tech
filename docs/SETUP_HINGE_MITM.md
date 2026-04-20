# Passive Hinge Token Capture via iPhone Proxy

No more weekly Charles runs. Once this is set up, your Hinge token
refreshes itself every time you open Hinge on your iPhone while home
on Wi-Fi. Zero manual work after the one-time iPhone config.

## How it works

- mitmproxy runs permanently on your Mac Mini (launchd, port 8080).
- Your iPhone Wi-Fi points at the Mac as its HTTP proxy (for your home
  network only — cellular is untouched).
- Hinge's iOS app doesn't pin TLS, so mitmproxy reads the
  `Authorization: Bearer` header on every Hinge API request.
- The addon uploads the fresh token to `clapcheeks.tech/api/ingest/platform-token`
  using the same device token as the Chrome extension.
- The clapcheeks daemon pulls the new token from Supabase on its next
  30-min sync, writes it to `~/.clapcheeks/.env`, and the next swipe
  session uses it.

## One-time iPhone setup (about 3 minutes)

### 1. Set Wi-Fi proxy

On the iPhone, while connected to your home Wi-Fi:

1. Settings → Wi-Fi → tap the (i) next to your network
2. Scroll down to **HTTP Proxy** → Configure Proxy → **Manual**
3. Server: `192.168.1.120`
4. Port: `8080`
5. Authentication: off
6. Save

Do this for every Wi-Fi network where you want passive capture.
Cellular is untouched by Wi-Fi proxy settings.

### 2. Install the mitmproxy CA cert

Still on the iPhone:

1. Open Safari → go to **http://mitm.it**
   (note: `http`, not `https` — the cert page refuses https until
   the cert is trusted)
2. Tap the **Apple** icon to download the iOS profile
3. Settings → General → **VPN & Device Management**
4. Tap the **mitmproxy** profile → Install → enter passcode → Install
5. Settings → General → About → **Certificate Trust Settings**
6. Toggle on full trust for **mitmproxy**

### 3. Prove it works

- Open Hinge on the iPhone. Let it load the feed.
- On the Mac Mini: `tail -f ~/.clapcheeks/logs/mitm.log`
- You should see a line like:
  `mitm_hinge: harvested token from https://prod-api.hingeaws.net/...`
- In `clapcheeks_user_settings` on Supabase, `hinge_auth_token` will
  have a fresh value and `hinge_auth_token_updated_at` will be within
  the last minute.

## What this does NOT do

- **No cellular interception.** Wi-Fi proxy only. If you never come
  home, tokens eventually expire.
- **No other app interception.** Only `*.hingeaws.net` and `hinge.co`
  hosts are matched in the addon. Other app traffic passes through
  unexamined but still goes through the proxy (slight latency).
- **No data exfiltration.** The addon only reads the Authorization
  header. Message bodies, images, timelines — none touched, none logged.

## If you want to turn it off

```bash
launchctl unload ~/Library/LaunchAgents/tech.clapcheeks.mitm.plist
```

Also remove the proxy on your iPhone (Settings → Wi-Fi → network → HTTP Proxy → Off).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `tail -f mitm.log` shows nothing after opening Hinge | iPhone proxy not configured on current Wi-Fi, or not on home Wi-Fi right now. |
| Hinge fails to load on iPhone ("cannot connect") | mitmproxy cert not trusted. Redo Certificate Trust Settings step. |
| mitm.err.log shows `address already in use` | Another process on :8080. `lsof -iTCP:8080` to find it. |
| API returns 401 (`invalid_device_token`) | Device token rotated. Update the plist env var and `launchctl unload/load`. |

## Security notes

- mitmproxy can see decrypted traffic for any host you hit through it.
  Keep the proxy off on networks you don't trust (public Wi-Fi, coffee
  shops).
- The mitmproxy CA is installed only on YOUR iPhone. It does not affect
  anyone else. Remove the profile when not in use if you're paranoid.
- The addon uploads tokens only (never message bodies). All uploads
  are scoped to YOUR user via your device token.
