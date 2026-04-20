# Capturing Your Tinder Auth Token

Two paths. Both produce an `X-Auth-Token` that Clapcheeks can use to hit
`api.gotinder.com` directly.

| Path | Source | Difficulty | Wire format | Status |
|------|--------|------------|-------------|--------|
| **Web** | tinder.com in Chrome | ⭐ easy (2 min) | JSON | **Recommended, works today** |
| **iOS** | Tinder.app on iPhone | 🔨 hard (hours) | protobuf | Needs schema extraction |

---

## Path A — Web capture (RECOMMENDED)

Tinder's web client uses the same API but still speaks JSON, with no TLS
pinning. Token capture is a 30-second DevTools operation.

1. Open [tinder.com](https://tinder.com) in Chrome and log in.
2. Open DevTools (Cmd/Ctrl + Opt + I) → **Network** tab.
3. Filter by **Fetch/XHR** and refresh the page.
4. Click any request to `api.gotinder.com` (e.g. `/v2/profile`, `/v2/matches`).
5. In **Headers → Request Headers**, copy the value of `X-Auth-Token`.
6. Run `clapcheeks setup-tinder-token` and paste it when prompted.

The CLI will probe `/v2/profile` to verify the token works, then write:

```
TINDER_AUTH_TOKEN=<token>
TINDER_WIRE_FORMAT=json
CLAPCHEEKS_TINDER_MODE=api
```

to `~/.clapcheeks/.env`. Next `clapcheeks swipe tinder` uses the iPhone-API
path automatically.

**Token lifetime:** the web token lasts until you log out or the session
expires (typically ~30 days). Recapture when you see 401 errors.

---

## Path B — iOS capture (advanced)

Required only if you want to use the iOS protobuf wire format — e.g. to mimic
the iOS client fingerprint exactly instead of the web one. The extra
anti-ban value is debated; Path A is the pragmatic choice.

### Prereqs

- A proxy with a trusted CA (Charles, mitmproxy, or HTTP Toolkit)
- A way to bypass **TLS certificate pinning** on iOS
- The `.proto` schemas captured from the Tinder IPA

### Pinning bypass — two options

**B1. Jailbroken iPhone (simplest)**
1. Jailbreak (unc0ver, palera1n — depends on iOS version)
2. Install **SSL Kill Switch 2** from Sileo/Cydia
3. Toggle "Disable Certificate Validation" in Settings
4. Proxy via Charles, open Tinder, copy `X-Auth-Token` from any request

**B2. Non-jailbroken + Frida-Gadget** (needs Apple Developer account, $99/yr)
1. Get the Tinder IPA (iMazing or pull from jailbroken backup)
2. Inject `FridaGadget.dylib` — see
   [httptoolkit/frida-interception-and-unpinning](https://github.com/httptoolkit/frida-interception-and-unpinning)
3. Re-sign with `codesign` / `cyan` / `ignite`
4. Sideload via Sideloadly or AltStore
5. Launch with Frida's unpinning script attached, proxy via Charles
6. Copy `X-Auth-Token`

### Protobuf schemas

The iOS body format is protobuf. You need `.proto` schemas to encode/decode:

1. Extract `Payload/Tinder.app/Tinder` from the IPA
2. Reverse field tags with
   [blackbox-protobuf](https://github.com/NCCGroup/blackboxprotobuf) against
   captured request bodies, or disassemble the binary in Ghidra/Hopper
3. Generate Python modules:

   ```bash
   protoc --python_out=agent/clapcheeks/platforms/tinder_proto/ tinder.proto
   ```

4. Drop the resulting `*_pb2.py` files into
   `agent/clapcheeks/platforms/tinder_proto/`
5. Fill in the `_encode_*` / `_decode_*` seams in
   `agent/clapcheeks/platforms/tinder_api.py`
6. Set `TINDER_WIRE_FORMAT=protobuf` in `~/.clapcheeks/.env`

Until those modules exist, protobuf mode raises `TinderProtobufNotConfigured`
on the first RPC.

---

## Env vars (reference)

Write to `~/.clapcheeks/.env` (0600):

```
TINDER_AUTH_TOKEN=<X-Auth-Token value>
TINDER_WIRE_FORMAT=json                  # json | protobuf
CLAPCHEEKS_TINDER_MODE=api               # api | browser
TINDER_APP_VERSION=14.26.0               # protobuf mode only
TINDER_PERSISTENT_ID=<uuid>              # optional
TINDER_LOCALE=en-US                      # default en-US
```

`chmod 600 ~/.clapcheeks/.env`

## Legal

Tinder's ToS forbid automated access. Accounts can and do get shadow-banned
or permanently banned for automation. This code is for research — you are
responsible for how you use it.
