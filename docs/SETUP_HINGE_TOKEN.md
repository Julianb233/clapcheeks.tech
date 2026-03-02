# Getting Your Hinge Bearer Token

Hinge uses a private REST API (`api.hingeaws.net`). Clap Cheeks supports two modes for Hinge:

- **Browser mode** (default): slower but requires no token
- **API mode** (recommended): faster, more reliable, lower ban risk — requires a Bearer token

This guide explains how to capture your Hinge Bearer token using two methods.

---

## Why Use API Mode?

| | Browser Mode | API Mode |
|---|---|---|
| Speed | ~3-5s per action | ~0.3s per action |
| Detection risk | Higher (browser fingerprint) | Lower (mimics official client) |
| Token setup | None | One-time capture (~10 min) |
| Re-auth | Cookies expire (7-30 days) | Token expires (~7 days) |

For most users, API mode is worth the one-time setup.

---

## Method 1: iOS + Charles Proxy (Recommended)

Charles Proxy intercepts HTTPS traffic between your iPhone and the internet, letting you inspect Hinge API requests and copy the auth token.

### Requirements
- Mac with Charles Proxy installed ([charlesproxy.com](https://www.charlesproxy.com) — 30-day free trial, then $50 one-time)
- iPhone on the same WiFi network as your Mac

### Steps

**1. Install and launch Charles Proxy on your Mac**

Download from [charlesproxy.com](https://www.charlesproxy.com). Launch it — it will start intercepting traffic from your Mac immediately.

**2. Find your Mac's local IP address**

```bash
ipconfig getifaddr en0
```

Note the IP (e.g., `192.168.1.42`). You will need this for your iPhone proxy settings.

**3. Configure your iPhone to route through Charles**

On your iPhone:
1. Open Settings → Wi-Fi
2. Tap the (i) next to your current network
3. Scroll down to HTTP Proxy → Configure Proxy → Manual
4. Server: your Mac's IP address from step 2
5. Port: `8888`
6. Save

**4. Install the Charles SSL certificate on your iPhone**

This allows Charles to intercept HTTPS (encrypted) traffic from Hinge.

On your iPhone's browser, navigate to: `chls.pro/ssl`

This will download the Charles certificate. Then:
1. Settings → General → VPN & Device Management
2. Tap the Charles certificate → Install → Install (confirm)
3. Settings → General → About → Certificate Trust Settings
4. Enable full trust for the Charles certificate

**5. Filter Charles to show only Hinge traffic**

In Charles on your Mac:
1. Proxy → SSL Proxying Settings
2. Add `api.hingeaws.net` with port `443`

**6. Open Hinge on your iPhone**

Any action in the app (opening a profile, swiping, viewing likes) will generate API requests. You will see them appear in Charles.

**7. Find the Authorization header**

In Charles:
1. Look for requests to `api.hingeaws.net` in the left panel
2. Click any request
3. Go to the Request tab → Headers section
4. Find the `Authorization` header — it will look like:
   ```
   Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
5. Copy the entire value after `Bearer ` (the token itself)

**8. Save the token**

Add to `~/.clapcheeks/.env`:
```
HINGE_AUTH_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

Clap Cheeks will automatically detect this variable and use API mode for Hinge.

**9. Clean up**

After capturing the token, remove the proxy from your iPhone (Settings → Wi-Fi → your network → HTTP Proxy → Off). Leaving it on will route all your phone traffic through Charles unnecessarily.

---

## Method 2: Android + HTTP Toolkit (Free)

HTTP Toolkit is a free, open-source alternative to Charles Proxy that works with Android.

### Requirements
- Android phone (physical device or emulator)
- HTTP Toolkit installed on your computer ([httptoolkit.tech](https://httptoolkit.tech) — free)
- USB cable to connect your Android device

### Steps

**1. Install HTTP Toolkit**

Download from [httptoolkit.tech](https://httptoolkit.tech) — available for Mac, Windows, and Linux. No license required.

**2. Connect your Android device via USB**

Enable USB debugging on your Android phone:
1. Settings → About Phone → tap Build Number 7 times to enable Developer Options
2. Settings → Developer Options → USB Debugging → enable

Connect your phone with a USB cable.

**3. Launch HTTP Toolkit and select "Android device via ADB"**

HTTP Toolkit will:
- Detect your connected device
- Automatically install its CA certificate on the device
- Configure your device's network to route through the proxy

**4. Enable HTTPS interception for Hinge**

In HTTP Toolkit:
1. Click "Intercept" on the left panel
2. The proxy is now active for all traffic from your Android device

**5. Open Hinge on your Android device**

Any action in the app generates intercepted requests visible in HTTP Toolkit.

**6. Find the Authorization header**

In HTTP Toolkit:
1. Look for requests to `api.hingeaws.net` in the request log
2. Click any request
3. Look at the Request Headers section
4. Copy the `Authorization: Bearer <token>` value

**7. Save the token**

Add to `~/.clapcheeks/.env`:
```
HINGE_AUTH_TOKEN=<your token>
```

---

## Token Validity and Renewal

Hinge Bearer tokens expire after approximately **7 days**.

When your token expires, Clap Cheeks will:
1. Log an authentication error in `~/.clapcheeks/logs/agent.log`
2. Fall back to browser mode automatically (if browser mode is configured)
3. Send a Telegram notification if your bot is configured

To renew, repeat the capture process above. The full capture takes about 5 minutes once you are familiar with the steps.

### Checking If Your Token Is Valid

```bash
clapcheeks status --platform hinge
```

The status output will show whether API mode is active and when the token was last validated.

---

## Troubleshooting

### Charles shows no requests from Hinge

- Ensure your iPhone is on the same WiFi network as your Mac
- Confirm the proxy settings are saved correctly on iPhone
- Verify the Charles SSL certificate is installed AND trusted (the trust step is separate from install)
- Try force-closing and reopening Hinge

### "SSL handshake error" in Charles

The SSL certificate is not trusted on your iPhone. Go back to Settings → General → About → Certificate Trust Settings and verify the Charles certificate is toggled on.

### Token does not work / "401 Unauthorized" in Clap Cheeks

- The token may have already expired — re-capture it
- Ensure there is no leading/trailing whitespace in the `.env` file value
- Confirm you copied the token value only, not the `Bearer ` prefix (Clap Cheeks adds that automatically)

### HTTP Toolkit certificate install fails on Android

- Ensure the phone is running Android 7 or later
- Some OEM Android builds (Samsung Knox, etc.) block system CA certificate installation. Use an alternative Android device or a standard Android emulator.

---

## Security Note

Your Hinge Bearer token is a credential equivalent to your account password for API purposes. Store it only in `~/.clapcheeks/.env` and never share it. The file should be readable only by your user:

```bash
chmod 600 ~/.clapcheeks/.env
```
