# Resend DNS Records for clapcheeks.tech

Domain ID: `51af3022-069c-4619-aa39-20304a1a5c10`
Region: `us-east-1`
Created: 2026-03-02

Add these DNS records to the clapcheeks.tech domain:

## 1. DKIM (TXT Record)

| Field | Value |
|-------|-------|
| Type | TXT |
| Name | `resend._domainkey` |
| Value | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDBsWJVNJjvovaPzyOWkHXVKXt7xC7HhjEwsVOFh/cvdD0JnsdImFLEegLTV9QdbRXtjk4II8GGyKPT0DV/ORWOgec4AEWxwAhf4grahaLbOxbGyee9nthHF9GtbYL7IcSdlxOUsWiYOwvpha4KL1WxGaLiNVdPiip4mRgS7UXqswIDAQAB` |
| TTL | Auto |

## 2. SPF - MX Record

| Field | Value |
|-------|-------|
| Type | MX |
| Name | `send` |
| Value | `feedback-smtp.us-east-1.amazonses.com` |
| Priority | 10 |
| TTL | 60 |

## 3. SPF - TXT Record

| Field | Value |
|-------|-------|
| Type | TXT |
| Name | `send` |
| Value | `v=spf1 include:amazonses.com ~all` |
| TTL | 60 |

## Verification

After adding DNS records, verify domain status:
```bash
RESEND_KEY=$(op read "op://API-Keys/RESEND-global/credential")
curl -s -X POST "https://api.resend.com/domains/51af3022-069c-4619-aa39-20304a1a5c10/verify" \
  -H "Authorization: Bearer $RESEND_KEY"
```
