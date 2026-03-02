# Platform Risks & Terms of Service

## Overview

Dating app automation violates the Terms of Service of all major platforms. Outward is built for **personal use only**. Using it may result in account suspension, permanent ban, or — in rare cases involving data scraping at scale — legal action under computer fraud statutes.

Read this document before using the tool. Understanding your risk profile per platform allows you to make informed decisions about which platforms to automate and at what intensity.

---

## Risk Levels by Platform

| Platform | Ban Risk | Detection Method | Notes |
|----------|----------|-----------------|-------|
| Tinder | **HIGH** | ML + velocity detection | Shares infra with Hinge, OkCupid, POF |
| Bumble | **HIGH** | ML fingerprinting + behavioral analysis | Shares infra with Badoo |
| Hinge | **MEDIUM-HIGH** | API rate limits + behavioral analysis | Match Group family |
| Grindr | **LOW-MEDIUM** | Less aggressive enforcement | Widely used in automation community |
| Badoo | **MEDIUM** | Web fingerprinting | Bumble Inc. family — shared ban signals |
| Happn | **LOW** | Minimal enforcement | Small team, limited ML investment |
| OKCupid | **MEDIUM** | Match Group family sharing | Shares ban signals with Tinder |
| POF | **LOW-MEDIUM** | Basic rate limiting | Match Group family but older stack |
| Feeld | **LOW** | Small team, ENM community | Minimal automated enforcement |
| CMB | **LOW** | Hard daily limits built-in | 21/day cap is the platform limit itself |

---

## Platform Family Risk Groups

Understanding platform ownership is critical — bans often propagate across products within the same corporate family.

### Match Group (Highest Cross-Ban Risk)

**Products:** Tinder, Hinge, OkCupid, POF, Match.com, Meetic, OurTime, and others.

Match Group platforms share user identity infrastructure, phone number verification, and ban signal databases. A ban on Tinder may result in automatic or manual bans on Hinge, OkCupid, and POF — sometimes immediately, sometimes within days.

**Risk factors:**
- All Match Group apps link your account to your phone number at the device level
- Behavioral signals (swipe velocity, session duration, interaction patterns) are analyzed by shared ML systems
- Phone number bans persist even if you create a new account

**Mitigation:**
- Use a dedicated phone number (Google Voice or a burner SIM) for all Match Group apps
- Use separate proxy pools and different device fingerprints per app
- Never run Match Group apps at the same time from the same IP
- Keep daily limits conservative (see recommended settings in `USER_GUIDE.md`)

---

### Bumble Inc.

**Products:** Bumble, Badoo, Fruitz.

Bumble and Badoo share a user database, phone verification, and ban signal systems. A ban on Bumble will often propagate to Badoo and vice versa.

**Mitigation:**
- Use a separate phone number from your Match Group number
- Use separate proxy per app if using cloud mode
- Do not run Bumble and Badoo in the same session window

---

### Independents (Lower Cross-Ban Risk)

**Products:** Grindr, Happn, Feeld, Coffee Meets Bagel.

These platforms have no shared infrastructure with each other or with Match Group / Bumble Inc. A ban on one does not affect the others.

**Notes:**
- Grindr has historically had weaker enforcement and is widely used in the automation community. Still, use respectful limits.
- Happn has a small engineering team with limited investment in automation detection.
- Feeld is a niche platform — aggressive automation would stand out. Conservative limits are important here for account health AND community norms.
- CMB's built-in 21/day limit means you literally cannot over-swipe.

---

## Detection Mechanisms

### Velocity Detection

Platforms measure how fast you swipe relative to normal human behavior. Swiping 100 profiles in 2 minutes is a clear automation flag. Outward uses **Gaussian jitter** (mean 6s delay, standard deviation 2.5s) between actions to simulate human pacing.

Do not override or reduce delay settings. The jitter is calibrated to stay inside normal human behavioral variance.

### Behavioral Fingerprinting

Modern platforms (Tinder, Bumble) use ML models trained on billions of sessions to detect non-human interaction patterns including:
- Perfect regularity in swipe timing
- Identical session start/end times daily
- Unnaturally consistent like ratios
- No profile photo views before swiping
- Swipe patterns that don't correlate with photo attractiveness scoring

Outward introduces randomness across all of these dimensions. However, no mitigation is perfect.

### Device and IP Fingerprinting

Platforms correlate:
- Device ID (IDFA/GAID for mobile, canvas fingerprint for browser)
- IP address and ISP type (datacenter IPs are flagged)
- GPS/location consistency
- Browser user-agent and TLS fingerprint

For cloud mode, use **residential proxies** — datacenter IPs (AWS, GCP, DigitalOcean) are flagged by all major platforms.

### API Abuse Detection

For platforms accessed via API (Hinge, OkCupid, Grindr, Feeld), request rate, header patterns, and token usage patterns are monitored. Outward enforces per-platform rate limits that fall within typical client behavior.

---

## Ban Avoidance Best Practices

1. **Honor rate limits** — Outward enforces daily caps per platform. Do not override them, even if you have Gold/Unlimited subscriptions that technically allow unlimited likes. Rate is more detectable than total count.

2. **Simulate active hours** — Configure `active_hours` in your config to run only during reasonable waking hours (e.g., 9am–11pm). Running at 3am every day is a signal.

3. **Vary your like ratio** — Do not like 100% of profiles. A 60-70% like ratio looks natural. Liking every profile is the single most obvious automation signal.

4. **Use residential proxies in cloud mode** — Datacenter IPs (AWS, DigitalOcean, Vultr, etc.) are flagged by Tinder and Bumble. Use providers like Brightdata, Smartproxy, or Oxylabs for residential IPs.

5. **Use a dedicated phone number** — Tinder and Bumble link bans to phone numbers, not just accounts. If your account is banned, a new account with the same number gets shadowbanned or immediately banned. Use Google Voice, TextNow, or a dedicated SIM.

6. **Do not combine VPN + automation from the same IP** — Routing automation traffic through a consumer VPN on the same IP you use personally creates inconsistent location signals. Use separate IP sources.

7. **Rotate sessions** — Do not run the agent continuously 24/7. Run it in sessions of 2-4 hours with natural gaps, simulating when a real person picks up their phone.

8. **Keep opener quality high** — Low-quality, repetitive openers that trigger spam reports from matches will accelerate ban detection. The AI is designed to avoid this — do not use hardcoded templates.

---

## What Happens If You Get Banned

### Soft Ban / Shadowban
Your account still appears functional but is shown to far fewer potential matches. Signs: dramatically reduced match rate, messages not delivered, profile views drop to near zero.

**Response:** Stop all automation for 2-3 weeks. Normal activity may restore standing. If not, consider a fresh account with a new phone number.

### Hard Ban
Account is suspended. You may or may not receive an email notification.

**Response:** Do not appeal immediately — appeals sometimes trigger additional review of activity. Wait 30 days. If appealing, claim the ban was in error and provide no additional detail.

**For Match Group bans:** A hard ban on Tinder typically propagates to Hinge, OkCupid, and POF within 24-72 hours. Prepare to use new credentials (email + phone number) across all Match Group apps.

### Device Ban
Your physical device is flagged. New accounts on the same device will be immediately banned.

**Response:** For iPhone, reset Advertising Identifier (Settings → Privacy → Tracking → Reset Advertising Identifier). For browser mode, use a fresh browser profile with cleared fingerprint.

---

## Terms of Service References

The following sections of each platform's ToS are most directly applicable:

| Platform | ToS Section | Key Prohibition |
|----------|-------------|-----------------|
| Tinder | Section 5 — Prohibited Activities | No automated access, no bots, no data scraping |
| Bumble | Section 6 — Acceptable Use | No automated scripts, no crawlers, no artificial interaction |
| Grindr | Section 4.2 — Prohibited Conduct | No automated data collection or interaction |
| OKCupid | Section 2 — Using OkCupid | No automated interaction with the service |
| Hinge | Section 6 — Prohibited Activities | No reverse engineering, no automated access (Match Group ToS) |
| Feeld | Section 5 — Restrictions | No automated access or bots |

All platform ToS prohibit automation. This list is not exhaustive. Review each platform's current ToS at your discretion as terms change frequently.

---

## Legal Disclaimer

This software is provided for **educational and personal use only**.

Users are solely responsible for:
- Compliance with the Terms of Service of each platform used
- Compliance with applicable local, state, and federal laws
- Any consequences arising from use of this software, including account bans, data loss, or legal action

The developers of Outward accept no liability for account suspensions, permanent bans, data breaches, privacy violations, or any other consequences resulting from use of this tool.

**Do not use this tool to:**
- Scrape or sell user data from dating platforms
- Send unsolicited commercial messages
- Harass or deceive other users
- Operate at scale for commercial matchmaking services without platform partnership agreements

Use responsibly. Automate the tedium, not your ethics.
