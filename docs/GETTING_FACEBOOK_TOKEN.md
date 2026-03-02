# Getting Your Facebook Access Token for Happn

Happn uses Facebook OAuth for login. To use Outward with Happn, you need a Facebook User Access Token with the correct permissions.

---

## Overview

| | Details |
|---|---|
| Why needed | Happn authenticates users via Facebook OAuth |
| Token type | Facebook User Access Token |
| Required permissions | `email`, `public_profile` |
| Short-lived validity | 1-2 hours |
| Long-lived validity | 60 days |
| Where to store | `~/.clapcheeks/.env` as `HAPPN_FB_TOKEN` |

---

## Prerequisites

- A Facebook account linked to your Happn account
- A Facebook Developer account (free) — [developers.facebook.com](https://developers.facebook.com)

If you have not already linked Facebook to Happn: open Happn → Settings → Connected Accounts → Facebook → Connect.

---

## Step 1: Create a Facebook App (One-Time)

You need a Facebook App to use the Graph API Explorer. This is free and takes about 2 minutes.

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in
2. Click **My Apps** → **Create App**
3. Select **Consumer** as the app type
4. Enter any name (e.g., `HappnHelper`) and your contact email
5. Click **Create App** — complete any CAPTCHA if prompted
6. Your app is created. Note the **App ID** and **App Secret** (found in Settings → Basic) — you will need these for long-lived tokens

You do not need to publish or submit the app for review. Using it privately for your own account does not require review.

---

## Step 2: Generate a User Access Token

1. Go to the **Graph API Explorer**: [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer/)

2. In the top-right dropdown, select the app you just created (e.g., `HappnHelper`)

3. Click **Generate Access Token**

4. A permissions dialog will appear. Make sure to add:
   - `email`
   - `public_profile`

   These are the minimum permissions Happn requires for login.

5. Click **Continue as [Your Name]** → **OK**

6. The **Access Token** field at the top of the Explorer will now contain your token (starts with `EAA...`)

7. Click the blue copy icon next to the token to copy it

---

## Step 3: Save the Token

Add the token to your Outward environment file:

```bash
echo 'HAPPN_FB_TOKEN=EAAxxxxxxxxxxxxxxxxxx' >> ~/.clapcheeks/.env
```

Or open the file directly:
```bash
nano ~/.clapcheeks/.env
```

Add the line:
```
HAPPN_FB_TOKEN=EAAxxxxxxxxxxxxxxxxxx
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X` in nano).

Verify Outward can authenticate:
```bash
clapcheeks status --platform happn
```

---

## Step 4: Exchange for a Long-Lived Token (Recommended)

Short-lived tokens from the Explorer expire in 1-2 hours. For practical use, exchange for a long-lived token that lasts 60 days.

### Via Browser (Simplest)

Construct the following URL, replacing the placeholders with your values:

```
https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN
```

- `YOUR_APP_ID`: found in Facebook Developer Console → your app → Settings → Basic → App ID
- `YOUR_APP_SECRET`: Settings → Basic → App Secret (click "Show")
- `YOUR_SHORT_LIVED_TOKEN`: the token you copied in Step 2

Paste the full URL into your browser while logged into Facebook. The response will be JSON:

```json
{
  "access_token": "EAAxxxxxxxxxxxxxxxxxx",
  "token_type": "bearer",
  "expires_in": 5183944
}
```

Copy the new `access_token` value — this is your long-lived token.

### Via curl (Alternative)

```bash
curl -G "https://graph.facebook.com/oauth/access_token" \
  --data-urlencode "grant_type=fb_exchange_token" \
  --data-urlencode "client_id=YOUR_APP_ID" \
  --data-urlencode "client_secret=YOUR_APP_SECRET" \
  --data-urlencode "fb_exchange_token=YOUR_SHORT_LIVED_TOKEN"
```

### Save the Long-Lived Token

Update `~/.clapcheeks/.env` with the new long-lived token:

```
HAPPN_FB_TOKEN=EAAxxxxxxxxxxxxxxxxxx  # long-lived version
```

---

## Token Renewal

Long-lived tokens automatically renew if used within 60 days. If you use Outward regularly, the token will stay active indefinitely through automatic renewal.

If the token expires:
1. Return to the Graph API Explorer and generate a new short-lived token
2. Exchange it for a long-lived token using the process above
3. Update `~/.clapcheeks/.env` with the new token

Outward will notify you via Telegram (if configured) and log a warning when a Happn authentication failure is detected.

---

## Checking Token Validity

You can inspect your token at the [Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/):

1. Go to [developers.facebook.com/tools/debug/accesstoken](https://developers.facebook.com/tools/debug/accesstoken/)
2. Paste your token in the Access Token field
3. Click **Debug**

The output shows:
- **Expires**: when the token expires (or "Never" for page tokens)
- **Scopes**: permissions granted (should include `email`, `public_profile`)
- **Valid**: whether the token is currently active

---

## Troubleshooting

### "Invalid OAuth access token" from Happn

Your token has expired or was entered incorrectly. Generate a new token and update `~/.clapcheeks/.env`.

### Graph API Explorer shows no apps in the dropdown

You have not created a Facebook App yet. Complete Step 1 first.

### "App not authorized" when generating token

Your Facebook account may have logged out of the Developer Console session. Refresh the page, log in again, and retry.

### Long-lived token exchange returns an error

- Confirm your App ID and App Secret are correct (no extra spaces)
- Ensure the short-lived token was generated from the same Facebook app
- Try the browser URL method instead of curl if one fails

### Token has correct scopes but Happn still rejects it

Happn's OAuth integration may require the account to have Facebook connected before using a token. Open the Happn app and connect your Facebook account via Settings → Connected Accounts → Facebook, then generate a new token.

---

## Security Note

Your Facebook access token provides read access to your Facebook profile and email. Store it only in `~/.clapcheeks/.env` and never share it.

Set correct file permissions:
```bash
chmod 600 ~/.clapcheeks/.env
```

Facebook access tokens can be revoked at any time at [facebook.com/settings?tab=applications](https://www.facebook.com/settings?tab=applications) → Active Sessions → HappnHelper → Remove.
