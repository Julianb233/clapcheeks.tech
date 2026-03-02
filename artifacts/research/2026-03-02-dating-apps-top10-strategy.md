# Clap Cheeks — Dating App Integration Research
**Date:** 2026-03-02
**Scope:** Top 10 dating app integration analysis for AI dating co-pilot
**Already Built:** Tinder (REST API), Bumble (browser automation), Hinge (REST API)
**Goal:** Identify 7 additional apps to bring total to 10, ranked by viability

---

## Raw Research Report (JSON)

```json
{
  "top_10_ranked": [
    {
      "rank": 1,
      "name": "OkCupid",
      "status": "RECOMMENDED",
      "user_base": {
        "monthly_active_users": "5M",
        "total_registered": "50M+",
        "primary_demographics": "18-35, college-educated, relationship-oriented",
        "key_markets": ["USA", "Canada", "UK", "Australia"],
        "gender_split": "45% female / 55% male (more balanced than competitors)"
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": true,
        "notes": "OkCupid migrated from REST to GraphQL in 2020. API runs on Apollo Server + Express. All mobile and web clients use the same GraphQL endpoint. Reverse-engineered wrappers exist (okcupidjs, okcupyd on GitHub) but may be stale post-GraphQL migration.",
        "known_endpoints": [
          "https://www.okcupid.com/graphql — primary GraphQL endpoint",
          "https://www.okcupid.com/1/apitun/profile/match_batch — legacy match batch (pre-GraphQL)",
          "https://www.okcupid.com/1/apitun/quickmatch — legacy quickmatch"
        ]
      },
      "authentication": {
        "methods": ["Email + password", "Facebook OAuth", "Apple Sign-In"],
        "session_mechanism": "Cookie-based session token + Bearer JWT in Authorization header",
        "2fa": false,
        "notes": "Legacy okcupidjs used basic auth. Post-GraphQL uses JWT Bearer tokens. Session can be extracted from browser DevTools."
      },
      "unique_mechanics": [
        "Match percentage scoring (up to 4,000+ questions)",
        "DoubleTake feature (like/pass with context)",
        "Boosting (pay-to-be-seen)",
        "Incognito mode",
        "Essay-based profiles (6 prompts)",
        "A-List subscription unlocks who liked you"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Explicitly prohibits robots, scrapers, automated means of access",
        "enforcement": "Account suspension; historically lenient vs Tinder. No CAPTCHA on web client observed in research.",
        "shadowban_risk": "Medium — rate limits on likes/matches enforced"
      },
      "integration_difficulty": "Medium",
      "best_automation_strategy": {
        "primary": "Playwright browser automation on web app (okcupid.com)",
        "secondary": "GraphQL API calls with extracted JWT session token",
        "rate_limiting": "Max 50 likes/hour, 200/day recommended. Random delays 3-8 seconds between actions.",
        "auth_flow": "Login via Playwright, extract cookies + Bearer token, use in API calls",
        "risk_mitigation": "Use residential proxy rotation; avoid bulk-liking >100/session"
      },
      "scoring": {
        "user_base_score": 6,
        "ease_of_automation": 7,
        "risk_level": "Medium",
        "composite_score": 42
      }
    },
    {
      "rank": 2,
      "name": "Badoo",
      "status": "RECOMMENDED",
      "user_base": {
        "monthly_active_users": "30M",
        "total_registered": "420M+",
        "primary_demographics": "18-34, global focus, heavy Latin America + Europe",
        "key_markets": ["Brazil", "Argentina", "Spain", "Italy", "France", "Russia", "Eastern Europe"],
        "gender_split": "69% male / 31% female",
        "revenue_2024": "$205M",
        "notes": "Bumble Inc. owns Badoo. Same parent company as Bumble. Separate app with different algorithm."
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": false,
        "notes": "Unofficial PHP wrapper (tioffs/badoo on GitHub) and badwrapi project demonstrate REST API. Uses Protobuf binary protocol for some endpoints. API compatibility issues noted as of October 2024 — changes to binary protocol.",
        "known_endpoints": [
          "https://api.badoo.com/v1/ — primary REST base",
          "POST /mwebapi.phtml — web app API gateway (Protobuf)",
          "Various photo/match/vote endpoints documented in tioffs/badoo PHP lib"
        ]
      },
      "authentication": {
        "methods": ["Phone number (SMS OTP)", "Facebook OAuth", "Apple Sign-In", "Email"],
        "session_mechanism": "Session token passed in headers; Protobuf-encoded requests",
        "2fa": true,
        "notes": "Phone number is primary auth. SMS OTP required on new device. Binary protocol makes interception harder than pure JSON APIs."
      },
      "unique_mechanics": [
        "Encounters (swipe mode) + Meet (grid browse mode)",
        "SuperPowers subscription (see who liked you)",
        "Verified profile badges",
        "Live video streaming within app",
        "Voted hotlist feature",
        "Available globally in 47 languages / 190 countries"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Strict prohibition on automated access, scraping, or artificial interactions",
        "enforcement": "Account ban on detection; device fingerprinting active. Bumble Inc. legal team is aggressive.",
        "shadowban_risk": "High — Badoo uses behavioral scoring similar to Bumble"
      },
      "integration_difficulty": "Hard",
      "best_automation_strategy": {
        "primary": "Reverse-engineered REST API (PHP lib as reference, port to Node/Python)",
        "secondary": "Playwright browser automation on badoo.com web client",
        "rate_limiting": "Max 30 votes/hour recommended. Protobuf encoding required for mobile API. Web client is JSON-easier.",
        "auth_flow": "Phone number + SMS OTP; recommend using real SIM or virtual number service",
        "risk_mitigation": "Use separate device fingerprint per account; do not reuse phone numbers across accounts"
      },
      "scoring": {
        "user_base_score": 9,
        "ease_of_automation": 5,
        "risk_level": "High",
        "composite_score": 45
      }
    },
    {
      "rank": 3,
      "name": "Grindr",
      "status": "RECOMMENDED",
      "user_base": {
        "monthly_active_users": "13M",
        "total_registered": "30M+",
        "primary_demographics": "LGBTQ+ men, 18-35, urban-heavy",
        "key_markets": ["USA", "UK", "Brazil", "Spain", "Germany", "Australia"],
        "gender_split": "~99% male-identifying users",
        "notes": "Dominant LGBTQ+ dating platform globally. Captive niche market with no competitor at scale."
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": false,
        "notes": "Well-documented unofficial API. PyPI package 'Grindr' (v0.0.8) actively maintained by Isaac Kogan. Multiple GitHub repos with full endpoint docs (RobbieTechie/Grindr-API, Slenderman00/grindr-access). REST v3/v4 + XMPP WebSocket for chat.",
        "known_endpoints": [
          "POST https://grindr.mobi/v3/sessions — authenticate (returns sessionId, profileId, xmppToken)",
          "GET https://grindr.mobi/v3/bootstrap — server config (unauthenticated)",
          "GET https://grindr.mobi/v4/locations/{latlon} — nearby profiles",
          "POST https://grindr.mobi/v3/me/views/{profileId} — view profile",
          "POST https://grindr.mobi/v3/me/favorites/{profileId} — tap/like user",
          "WSS wss://chat.grindr.com:2443/ws-xmpp — XMPP chat over WebSocket"
        ]
      },
      "authentication": {
        "methods": ["Email + password"],
        "session_mechanism": "Header: 'Authorization: Grindr3 {sessionId}'; User-Agent must be set to Grindr Android client string",
        "2fa": false,
        "notes": "User-Agent required: 'grindr3/3.0.1.4529;4529;Unknown;Android 4.4.4' or modern equivalent. Returns HTTP 412 on bad UA. XMPP uses PLAIN SASL with profileId + xmppToken."
      },
      "unique_mechanics": [
        "Grid-based proximity browsing (not swipe-based)",
        "Distance shown to other users (location spoofing common)",
        "Taps (low-commitment expression of interest)",
        "Unlimited profile views (vs swipe limit)",
        "XMPP-based real-time chat",
        "Profile albums (multiple photos)",
        "Tribe tags (community identity labels)"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Prohibits robots, scrapers, apps interacting with Grindr without written permission",
        "enforcement": "ML-based profile scanning, automatic ban on ToS violation. Machine learning scans profile text and media.",
        "shadowban_risk": "Medium-High — mass messaging flagged quickly; profile views are less monitored"
      },
      "integration_difficulty": "Medium",
      "best_automation_strategy": {
        "primary": "REST API calls (pip install Grindr as reference implementation)",
        "secondary": "XMPP WebSocket for chat automation",
        "rate_limiting": "Max 50 profile views/hour; 20 taps/hour; 10 messages/hour to cold profiles. Random delays essential.",
        "auth_flow": "POST /v3/sessions with email+password+GCM token. Cache sessionId + rotate every 24h.",
        "risk_mitigation": "Spoof Android User-Agent; avoid sending identical opener messages; rate-limit taps to human-speed"
      },
      "scoring": {
        "user_base_score": 8,
        "ease_of_automation": 8,
        "risk_level": "Medium-High",
        "composite_score": 64
      }
    },
    {
      "rank": 4,
      "name": "Plenty of Fish (POF)",
      "status": "RECOMMENDED",
      "user_base": {
        "monthly_active_users": "15M",
        "total_registered": "90M+",
        "primary_demographics": "25-45, less college-educated, blue-collar friendly, casual dating",
        "key_markets": ["USA", "Canada", "UK", "Australia"],
        "gender_split": "50% male / 50% female (most balanced of major apps)",
        "notes": "Owned by Match Group. Free-tier heavy — largest free user base of any dating app. Popular in smaller US cities and rural areas."
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": false,
        "notes": "REST API exists (legacy token-based). GitHub POF-bot project demonstrates browser-based automation (Selenium). The public-facing plentyoffishonline.com developer portal had iframe-based API tokens. Modern app uses mobile REST API but no current public wrapper library exists. Web client is automatable via Playwright.",
        "known_endpoints": [
          "https://api.pof.com/ — mobile app REST base (undocumented)",
          "Web: https://www.pof.com/meet — meet/browse feature (Playwright-automatable)",
          "Web: https://www.pof.com/inbox — messaging"
        ]
      },
      "authentication": {
        "methods": ["Email + password", "Facebook OAuth"],
        "session_mechanism": "Cookie-based session on web; Bearer token on mobile API",
        "2fa": true,
        "notes": "2FA via SMS OTP on new device login. Cookie session persists on trusted device. Match Group shared auth infrastructure with other portfolio apps."
      },
      "unique_mechanics": [
        "Ultra Match (advanced compatibility scoring)",
        "Meet Me (hot-or-not style browse)",
        "Chemistry Predictor (personality test)",
        "Free messaging (no match required for some users)",
        "Upgraded members can message anyone",
        "Large free user base = high volume of contacts"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Explicitly prohibits robots, crawlers, automated access, and reverse engineering",
        "enforcement": "Account suspension/ban. HackerOne bug bounty program active — security team is vigilant.",
        "shadowban_risk": "Medium — heavy free user base means less ML investment in bot detection vs premium apps"
      },
      "integration_difficulty": "Medium",
      "best_automation_strategy": {
        "primary": "Playwright browser automation (web.pof.com is full-featured)",
        "secondary": "Intercept mobile API Bearer token via mitmproxy and make direct REST calls",
        "rate_limiting": "Max 100 profile views/hour; 20 messages/hour. Web client responds well to human-paced automation.",
        "auth_flow": "Email + password login via Playwright; extract session cookies; handle SMS OTP once on first login.",
        "risk_mitigation": "Persistent cookie session avoids repeated 2FA triggers; randomize swipe timing"
      },
      "scoring": {
        "user_base_score": 8,
        "ease_of_automation": 7,
        "risk_level": "Medium",
        "composite_score": 56
      }
    },
    {
      "rank": 5,
      "name": "Happn",
      "status": "RECOMMENDED",
      "user_base": {
        "monthly_active_users": "6.5M",
        "total_registered": "100M+",
        "primary_demographics": "25-54, urban-heavy, France-origin strong in Europe + LatAm",
        "key_markets": ["Brazil (~40% of revenue)", "France", "India", "USA", "UK"],
        "gender_split": "55% male / 45% female",
        "revenue_2024": "$25M"
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": false,
        "notes": "REST API well-documented via security research. GitHub: anthonyray/happn-1 (Python), hfreire/happn-wrapper (Node.js), pecee/happn-php-sdk (PHP). Authentication uses Facebook access tokens. Researcher successfully reverse-engineered like/pass endpoints and bypassed premium features.",
        "known_endpoints": [
          "POST https://api.happn.fr/api/auth/token — OAuth token exchange",
          "GET https://api.happn.fr/api/users/me/notifications — crossed paths notifications",
          "GET https://api.happn.fr/api/users/me/recs — recommendations",
          "POST https://api.happn.fr/api/users/{userId}/interactions — like/charmed/pass",
          "GET https://api.happn.fr/api/users/{userId} — public user profile by ID"
        ]
      },
      "authentication": {
        "methods": ["Facebook OAuth (primary)", "Apple Sign-In", "Phone number"],
        "session_mechanism": "OAuth Bearer token from Facebook access token exchange",
        "2fa": false,
        "notes": "Facebook access token passed to Happn API to get Happn Bearer token. Researcher noted access token interception via mitmproxy is straightforward."
      },
      "unique_mechanics": [
        "Crossed paths mechanic — only see people you've physically passed",
        "Charm (super like equivalent)",
        "Map view showing where you crossed paths",
        "Time-limited matches (crossed path window)",
        "CrushTime (guess who liked you game — premium)",
        "Audio messages",
        "Location spoofing defeats the core mechanic (but enables fake location automation)"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Standard prohibition on automated access",
        "enforcement": "Moderate — smaller security team than Tinder/Bumble. Researchers have bypassed premium features without ban.",
        "shadowban_risk": "Low-Medium — location-based model makes high-volume automation less suspicious (you naturally see fewer people)"
      },
      "integration_difficulty": "Medium",
      "best_automation_strategy": {
        "primary": "REST API calls with Facebook OAuth token (extract from mitmproxy or Facebook login flow)",
        "secondary": "GPS spoofing to control what crosses-paths appear (set location to high-traffic areas)",
        "rate_limiting": "Volume naturally limited by location — fake to dense urban areas for more profiles. Max 30 likes/hour.",
        "auth_flow": "Facebook OAuth → exchange for Happn Bearer token. Token refresh every 60 days.",
        "risk_mitigation": "Spoof location to city center; vary interaction timing; avoid 100% like rate"
      },
      "scoring": {
        "user_base_score": 6,
        "ease_of_automation": 8,
        "risk_level": "Low-Medium",
        "composite_score": 48
      }
    },
    {
      "rank": 6,
      "name": "Feeld",
      "status": "RECOMMENDED (niche)",
      "user_base": {
        "monthly_active_users": "500K weekly logins (MAU estimated 2M+)",
        "total_registered": "10M+",
        "primary_demographics": "25-40, open-minded/ENM/polyamory, urban, educated",
        "key_markets": ["USA", "UK", "Netherlands", "Australia", "Canada"],
        "gender_split": "More gender-diverse than any major app; 60% of members are couples",
        "growth": "30% YoY since 2022; record downloads in Q1 2025"
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": true,
        "notes": "FireTail security research (April 2025) revealed Feeld uses GraphQL with BOLA vulnerabilities — non-premium users could access premium data, read other users' chats, and modify other profiles via the GraphQL endpoint. Client-side filtering of 'Status: HIDDEN' fields was exposed in API responses. This means the API is relatively open to interception.",
        "known_endpoints": [
          "GraphQL endpoint at api.feeld.co/graphql (inferred from security research)",
          "Photo CDN with user-ID-based paths (exposed per FireTail research)",
          "Chat API accessible without auth in some endpoints (patched post-disclosure)"
        ]
      },
      "authentication": {
        "methods": ["Phone number (SMS OTP)", "Apple Sign-In"],
        "session_mechanism": "JWT Bearer token; session tied to device",
        "2fa": true,
        "notes": "Phone-first auth. Security researchers noted that auth bypass was possible on some endpoints pre-2025 patches. Post-patch: standard JWT auth required for all sensitive endpoints."
      },
      "unique_mechanics": [
        "Couples and singles both have profiles",
        "Desires system (kink/interest tags)",
        "Non-monogamy focused community norms",
        "Profile linked to partner profile",
        "Membership-based (no free swipes beyond limit)",
        "State of Dating annual report — strong community identity"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Standard prohibition; community-safety focused enforcement",
        "enforcement": "Light — small trust & safety team. Security researchers disclosed BOLA vulns and were not banned during research.",
        "shadowban_risk": "Low — smaller user base, less ML investment in bot detection"
      },
      "integration_difficulty": "Medium",
      "best_automation_strategy": {
        "primary": "GraphQL API calls (intercept via mitmproxy on mobile app)",
        "secondary": "Playwright on web app if available",
        "rate_limiting": "Conservative — community is small; over-automation quickly becomes suspicious. Max 20 likes/day.",
        "auth_flow": "Phone + SMS OTP; extract JWT Bearer token from mobile app traffic",
        "risk_mitigation": "Low volume, highly targeted likes. Quality over quantity — niche community where spammy behavior is very visible."
      },
      "scoring": {
        "user_base_score": 4,
        "ease_of_automation": 7,
        "risk_level": "Low",
        "composite_score": 28
      }
    },
    {
      "rank": 7,
      "name": "Coffee Meets Bagel (CMB)",
      "status": "LOWER PRIORITY",
      "user_base": {
        "monthly_active_users": "1M (estimated, declining)",
        "total_registered": "10M+",
        "primary_demographics": "25-35, female-skewed, Asian-American community strong, quality-over-quantity daters",
        "key_markets": ["USA", "Singapore", "Australia"],
        "gender_split": "65% female / 35% male",
        "notes": "Had major service outage August 2023. Declining engagement. Niche but loyal user base."
      },
      "api_approach": {
        "private_rest_api_exists": true,
        "graphql_available": false,
        "notes": "API base confirmed at https://api.coffeemeetsbagel.com. /bagels endpoint fetches daily matches. GitHub: neelkhutale19/CoffeeMeetsBagel-API-Testing shows Postman test collection with endpoint structure. Company uses Appium for internal mobile UI testing — suggests app-only API, no web client.",
        "known_endpoints": [
          "GET https://api.coffeemeetsbagel.com/bagels — daily bagels (matches)",
          "POST https://api.coffeemeetsbagel.com/bagels/{id}/like — like a bagel",
          "POST https://api.coffeemeetsbagel.com/bagels/{id}/pass — pass a bagel",
          "GET https://api.coffeemeetsbagel.com/me — own profile"
        ]
      },
      "authentication": {
        "methods": ["Facebook OAuth (primary)", "Phone number", "Email"],
        "session_mechanism": "OAuth Bearer token",
        "2fa": false,
        "notes": "Company refused to engage with security researchers who found API flaws. Suggests reactive rather than proactive security posture."
      },
      "unique_mechanics": [
        "Daily bagel limit (curated matches, not infinite swipe)",
        "Beans currency (in-app currency for premium actions)",
        "Women see men who already liked them first",
        "7-day match expiry window",
        "Suggested icebreaker questions",
        "Activity score system (rewards engagement)"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Standard prohibition",
        "enforcement": "Limited — small security team. Company had major outage indicating infrastructure stress.",
        "shadowban_risk": "Low-Medium"
      },
      "integration_difficulty": "Medium",
      "best_automation_strategy": {
        "primary": "REST API calls with OAuth Bearer token (intercept from mobile app via mitmproxy)",
        "secondary": "Appium iOS/Android automation",
        "rate_limiting": "App enforces daily bagel limits server-side — automation mainly useful for auto-like + icebreaker messaging. Max 21 bagels/day (app limit).",
        "auth_flow": "Facebook OAuth → Bearer token. Extract from mitmproxy session.",
        "risk_mitigation": "Volume is naturally capped by app mechanics. Low automation risk."
      },
      "scoring": {
        "user_base_score": 3,
        "ease_of_automation": 6,
        "risk_level": "Low-Medium",
        "composite_score": 18
      }
    },
    {
      "rank": 8,
      "name": "Match.com",
      "status": "LOWER PRIORITY",
      "user_base": {
        "monthly_active_users": "5.8M",
        "total_registered": "30M+",
        "primary_demographics": "30-55, marriage/serious relationship seekers, 80% college-educated, fastest-growing: 50+",
        "key_markets": ["USA", "UK", "Canada", "Australia"],
        "gender_split": "58% male / 42% female",
        "notes": "Owned by Match Group. Legacy platform — oldest major dating site (1995). Subscription-heavy model ($40+/month). Higher intent users."
      },
      "api_approach": {
        "private_rest_api_exists": false,
        "graphql_available": false,
        "notes": "No known public or reverse-engineered API. Web-first platform with no dedicated mobile API layer documented publicly. Site uses server-rendered pages + JS components. Playwright browser automation is the only viable path. Login CAPTCHA protection active on some flows.",
        "known_endpoints": [
          "https://www.match.com/search/ — browse profiles (Playwright target)",
          "https://www.match.com/inbox/ — messaging (Playwright target)"
        ]
      },
      "authentication": {
        "methods": ["Email + password", "Facebook OAuth", "Apple Sign-In"],
        "session_mechanism": "Cookie-based session",
        "2fa": false,
        "notes": "Match Group shared auth infrastructure. reCAPTCHA v3 active on login pages."
      },
      "unique_mechanics": [
        "Mutual match required before full messaging (on free tier)",
        "'Wink' low-commitment expression of interest",
        "Detailed profile (height, religion, kids, income optional)",
        "Daily 'Today's Matches' curated list",
        "Match Guarantee (refund if no dates in 6 months)",
        "Older, more serious user base = higher quality conversations"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Strict prohibition; Match Group legal team is industry's most active in pursuing scrapers",
        "enforcement": "reCAPTCHA on login, device fingerprinting, IP-based rate limiting. Match Group has sued scraping operations.",
        "shadowban_risk": "High — sophisticated fraud detection inherited from Match Group platform infrastructure"
      },
      "integration_difficulty": "Hard",
      "best_automation_strategy": {
        "primary": "Playwright browser automation with stealth plugins (puppeteer-extra-plugin-stealth equivalent)",
        "secondary": "Not recommended — no viable API path",
        "rate_limiting": "Max 20 profile views/hour; 5 winks/hour. Must bypass reCAPTCHA v3 scoring.",
        "auth_flow": "Playwright login with cookie persistence; handle reCAPTCHA via 2captcha API or similar.",
        "risk_mitigation": "Residential proxies essential; random human-speed delays; avoid peak-hour automation"
      },
      "scoring": {
        "user_base_score": 6,
        "ease_of_automation": 3,
        "risk_level": "High",
        "composite_score": 18
      }
    },
    {
      "rank": 9,
      "name": "The League",
      "status": "NOT RECOMMENDED",
      "user_base": {
        "monthly_active_users": "200K-500K (estimated)",
        "total_registered": "1M+",
        "primary_demographics": "25-40, Ivy League + top university graduates, high earners, ambitious professionals",
        "key_markets": ["NYC", "SF", "LA", "Chicago", "Boston", "London"],
        "gender_split": "50% male / 50% female (curated)",
        "notes": "Acquired by Match Group July 2022. Waitlist-based admission. Only 500 daily profiles shown (The Daily). Very small active user base per city."
      },
      "api_approach": {
        "private_rest_api_exists": false,
        "graphql_available": false,
        "notes": "No public or reverse-engineered API documented. Mobile-only app (iOS + Android). No web client. Would require Appium for automation. Very small user base per market makes automation less valuable.",
        "known_endpoints": []
      },
      "authentication": {
        "methods": ["LinkedIn (required)", "Facebook", "Phone number"],
        "session_mechanism": "Mobile app JWT",
        "2fa": false,
        "notes": "LinkedIn account required and verified against educational/professional background. Human approval process for new members — bots would not pass screening."
      },
      "unique_mechanics": [
        "Human concierge approval process",
        "LinkedIn + Facebook verification required",
        "Only 500 profiles shown daily (The Daily)",
        "Waitlist system per city",
        "League X for top-tier subscribers (1:1 concierge matching)",
        "VIP tiers (Member, Owner, Investor, Billionaire)"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "Identity verification via LinkedIn makes bot creation very difficult",
        "enforcement": "Human review process — bots/fake profiles identified during onboarding",
        "shadowban_risk": "N/A — likely immediate ban on detection"
      },
      "integration_difficulty": "Very Hard",
      "best_automation_strategy": {
        "primary": "Appium iOS/Android (theoretical only)",
        "secondary": "Not viable at scale — waitlist + human approval blocks programmatic account creation",
        "rate_limiting": "App limits to 500 profiles/day anyway",
        "auth_flow": "Real LinkedIn account required; cannot be automated at scale",
        "risk_mitigation": "Not recommended — ROI too low for effort required"
      },
      "scoring": {
        "user_base_score": 2,
        "ease_of_automation": 1,
        "risk_level": "Very High",
        "composite_score": 2
      }
    },
    {
      "rank": 10,
      "name": "Thursday",
      "status": "NOT RECOMMENDED — APP SHUT DOWN",
      "user_base": {
        "monthly_active_users": "0 — SHUT DOWN",
        "total_registered": "2M (at peak)",
        "primary_demographics": "20-35, London/UK + NYC heavy",
        "key_markets": ["UK", "USA"],
        "notes": "CRITICAL: Thursday shut down its dating app in 2025 due to 'rapidly declining consumer interest'. Pivoted to Thursday Events (in-person event ticketing). App is no longer operational as a dating platform."
      },
      "api_approach": {
        "private_rest_api_exists": false,
        "graphql_available": false,
        "notes": "App is defunct. No integration possible."
      },
      "authentication": {
        "methods": ["N/A"],
        "session_mechanism": "N/A",
        "2fa": false,
        "notes": "App discontinued."
      },
      "unique_mechanics": [
        "HISTORICAL: Only active on Thursdays (one day per week)",
        "No messaging outside Thursdays",
        "Forced scarcity model",
        "NOW: Thursday Events — in-person ticketed singles events"
      ],
      "tos_stance": {
        "bots_prohibited": true,
        "automation_clause": "N/A — app shut down",
        "enforcement": "N/A",
        "shadowban_risk": "N/A"
      },
      "integration_difficulty": "N/A — impossible, app discontinued",
      "best_automation_strategy": {
        "primary": "Do not integrate",
        "secondary": "Consider Thursday Events webhook for event discovery if pivoting to IRL date coordination features",
        "rate_limiting": "N/A",
        "auth_flow": "N/A",
        "risk_mitigation": "N/A"
      },
      "scoring": {
        "user_base_score": 0,
        "ease_of_automation": 0,
        "risk_level": "N/A",
        "composite_score": 0
      }
    }
  ],

  "recommended_7_to_build": [
    {
      "priority": 1,
      "name": "Grindr",
      "reason": "Best API documentation of any dating app. PyPI package exists. REST v3/v4 + XMPP fully reverse-engineered. 13M MAU in a captive LGBTQ+ market with no competitor. Medium risk. Highest composite score.",
      "estimated_build_time": "1-2 weeks",
      "composite_score": 64
    },
    {
      "priority": 2,
      "name": "Badoo",
      "reason": "30M MAU — largest user base of any app on this list. Strong Latin America + Europe presence. PHP wrapper exists as reference. Hard but possible via web client Playwright. High growth market.",
      "estimated_build_time": "2-3 weeks",
      "composite_score": 45
    },
    {
      "priority": 3,
      "name": "Happn",
      "reason": "Python + Node.js wrappers documented. Facebook OAuth makes auth easy. Location spoofing enables coverage of any area. Low-Medium risk. Unique crossed-paths mechanic = authentic-feeling automation. Brazil/Europe reach.",
      "estimated_build_time": "1-2 weeks",
      "composite_score": 48
    },
    {
      "priority": 4,
      "name": "OkCupid",
      "reason": "5M MAU with highest female percentage of any app on list. GraphQL API discoverable via DevTools. Existing wrappers as reference. Match percentage provides quality filter inputs. Medium difficulty.",
      "estimated_build_time": "1-2 weeks",
      "composite_score": 42
    },
    {
      "priority": 5,
      "name": "Plenty of Fish (POF)",
      "reason": "15M MAU — second largest free user base. POF-bot GitHub project proves automation feasibility. Balanced gender split. Playwright web automation straightforward. Good for US/Canada/UK volume.",
      "estimated_build_time": "1-2 weeks",
      "composite_score": 56
    },
    {
      "priority": 6,
      "name": "Feeld",
      "reason": "Premium niche — ENM/polyamory/kink community has no other AI co-pilot competitor. GraphQL API with documented BOLA vulns = relatively open. Low risk enforcement. Unique value prop for Clap Cheeks.",
      "estimated_build_time": "2 weeks",
      "composite_score": 28
    },
    {
      "priority": 7,
      "name": "Coffee Meets Bagel",
      "reason": "Niche but loyal female-skewed user base. API confirmed at api.coffeemeetsbagel.com. Daily bagel limit caps automation risk naturally. Good for quality-conscious users in USA/Singapore/Australia.",
      "estimated_build_time": "1-2 weeks",
      "composite_score": 18
    }
  ],

  "not_recommended": [
    {
      "name": "Match.com",
      "reason": "reCAPTCHA v3 on login, no documented API, Match Group actively pursues scrapers legally. Hard difficulty + High risk + aging demographic = low ROI."
    },
    {
      "name": "The League",
      "reason": "Human approval process + LinkedIn verification makes programmatic account creation impossible. 200K-500K MAU is too small per city to be worth the effort."
    },
    {
      "name": "Thursday",
      "reason": "APP IS SHUT DOWN. Dating app closed in 2025. Pivoted to in-person events. Do not integrate."
    }
  ],

  "risk_summary": "Overall risk assessment: The primary risk vectors across all dating apps are (1) device fingerprinting on mobile-native apps, (2) behavioral analysis detecting non-human swipe/like patterns, (3) IP-based rate limiting, and (4) phone number / email account bans. The safest automation approach is REST API with extracted Bearer tokens (rather than browser automation) combined with residential proxy rotation, random timing delays (3-15 seconds between actions), and conservative rate limits (never exceed 50% of human-plausible daily activity). Apps owned by Match Group (OkCupid, POF, Match.com, Hinge, The League) share infrastructure and potentially share ban signals — a ban on one may flag others. Bumble Inc. apps (Bumble + Badoo) similarly share infrastructure. Operate separate accounts and separate proxy pools per app family. The LGBTQ+ apps (Grindr, Feeld) carry additional ethical responsibility — user location data is sensitive and must never be stored, logged, or leaked. Grindr's historical data breach (sold user HIV status to third parties, 2018) makes privacy practices a legal exposure for any integration.",

  "strategy_per_app": {
    "Grindr": {
      "approach": "REST API v3/v4 + XMPP WebSocket for chat. Use 'pip install Grindr' as implementation reference. Spoof Android User-Agent. Cache sessionId and rotate every 24h.",
      "rate_limits": "50 profile views/hour, 20 taps/hour, 10 cold messages/hour",
      "auth_method": "POST /v3/sessions with email+password. Returns sessionId, profileId, xmppToken. Header: 'Authorization: Grindr3 {sessionId}'",
      "unique_mechanics": "Grid-based proximity browse (not swipe). Taps = low-commitment like. XMPP real-time chat. No daily swipe limit on free tier.",
      "risk_level": "Medium-High",
      "primary_markets": "USA, UK, Brazil, Spain, Germany"
    },
    "Badoo": {
      "approach": "Playwright browser automation on badoo.com (web client = JSON API, not Protobuf). Mobile API uses binary Protobuf — use web client instead for easier implementation.",
      "rate_limits": "30 votes/hour, 200 votes/day max. Mimic human browse patterns.",
      "auth_method": "Phone number + SMS OTP. Cookie-based session on web. Use virtual SIM service for account creation.",
      "unique_mechanics": "Encounters (swipe) + Meet (grid browse). SuperPowers subscription required to see who liked you. 47 languages / 190 countries.",
      "risk_level": "High",
      "primary_markets": "Brazil, Argentina, Spain, Italy, France, Russia, Eastern Europe"
    },
    "Happn": {
      "approach": "REST API with Facebook OAuth Bearer token. Use anthonyray/happn-1 (Python) or hfreire/happn-wrapper (Node.js) as reference. Spoof GPS location to dense urban areas for max profile volume.",
      "rate_limits": "30 likes/hour. Location-based model naturally limits volume. Set fake location to city center (Times Square, London Bridge, etc.) for maximum crosses.",
      "auth_method": "Facebook access_token → POST /api/auth/token → Happn Bearer token. Token valid ~60 days.",
      "unique_mechanics": "Crossed paths mechanic. Charm = super like. Must have 'crossed paths' with user to like them — GPS spoofing defeats this gate and enables likes of anyone near spoofed location.",
      "risk_level": "Low-Medium",
      "primary_markets": "Brazil, France, India, USA, UK"
    },
    "OkCupid": {
      "approach": "GraphQL API calls with JWT Bearer token extracted from authenticated session (DevTools > Network > Authorization header). Playwright login flow, then switch to direct GraphQL calls.",
      "rate_limits": "50 likes/hour, 200/day. DoubleTake feature uses individual profile API calls. Random 3-8s delays.",
      "auth_method": "Email+password or Facebook. JWT Bearer token in Authorization header. Cookie session backup. No CAPTCHA on web observed.",
      "unique_mechanics": "Match percentage (0-100%). DoubleTake queues profiles with context. A-List subscription unlocks who liked you. Essay prompts enable AI response matching to user's profile content.",
      "risk_level": "Medium",
      "primary_markets": "USA, Canada, UK, Australia"
    },
    "Plenty of Fish": {
      "approach": "Playwright browser automation on pof.com. POF-bot GitHub as reference implementation. Extract session cookies after Playwright login. Handle SMS OTP once on first login, then persist cookies.",
      "rate_limits": "100 profile views/hour, 20 messages/hour. Meet Me feature has server-side rate limits.",
      "auth_method": "Email + password login on web. SMS OTP on new device. Cookie-based session (persists 30 days on trusted device).",
      "unique_mechanics": "Meet Me (hot-or-not). Free messaging (some users). Chemistry Predictor adds compatibility signals. Large free user base = high volume potential.",
      "risk_level": "Medium",
      "primary_markets": "USA, Canada, UK, Australia"
    },
    "Feeld": {
      "approach": "GraphQL API (intercept from mobile app via mitmproxy or Charles Proxy). JWT Bearer token from phone auth. Conservative rate limits — small, tight-knit community.",
      "rate_limits": "20 likes/day MAX. Quality over quantity essential. Community notices spam behavior.",
      "auth_method": "Phone number + SMS OTP → JWT Bearer token. Apple Sign-In alternative. Device-bound session.",
      "unique_mechanics": "Couples profiles (both partners can be active). Desires/kink tags enable precise AI matching. Non-monogamy norms mean different opener strategies required. Premium Majestic membership required for full features.",
      "risk_level": "Low",
      "primary_markets": "USA, UK, Netherlands, Australia, Canada"
    },
    "Coffee Meets Bagel": {
      "approach": "REST API at api.coffeemeetsbagel.com with Facebook OAuth Bearer token. Intercept from mobile app. Appium as fallback. Daily bagel cap (21/day) limits automation naturally.",
      "rate_limits": "21 bagels/day (server-enforced app limit). Automation mainly for auto-like + icebreaker generation.",
      "auth_method": "Facebook OAuth → Bearer token. Phone number alternative. No 2FA observed.",
      "unique_mechanics": "Daily curated batch (not infinite scroll). Women see men who liked them first. 7-day match expiry. Beans currency for premium actions. Activity score rewards engagement.",
      "risk_level": "Low-Medium",
      "primary_markets": "USA, Singapore, Australia"
    }
  }
}
```

---

## Executive Summary

### Already Built (3)
| App | MAU | Approach | Status |
|-----|-----|----------|--------|
| Tinder | 75M | REST API | LIVE |
| Bumble | 42M | Browser | LIVE |
| Hinge | 23M | REST API | LIVE |

### Recommended 7 to Build (ranked)
| Priority | App | MAU | Difficulty | Risk | Key Reason |
|----------|-----|-----|------------|------|------------|
| 1 | Grindr | 13M | Medium | Med-High | Best API docs, captive market, PyPI lib exists |
| 2 | Badoo | 30M | Hard | High | Massive LatAm/Europe reach, largest MAU on list |
| 3 | Happn | 6.5M | Medium | Low-Med | Facebook OAuth easy, location spoofing = full coverage |
| 4 | OkCupid | 5M | Medium | Medium | Highest female %, GraphQL discoverable |
| 5 | POF | 15M | Medium | Medium | Free user base, proven Playwright automation |
| 6 | Feeld | 2M | Medium | Low | Zero competitor in ENM/kink space |
| 7 | CMB | 1M | Medium | Low-Med | Female-skewed, auto-capped rate limits |

### Do Not Build
| App | Reason |
|-----|--------|
| Thursday | SHUT DOWN — app is defunct as of 2025 |
| The League | LinkedIn verification blocks bot accounts, tiny per-city user base |
| Match.com | reCAPTCHA + Match Group legal team + no API path = very high risk, hard difficulty |

---

## Implementation Notes

### Account Pool Strategy
- Maintain separate proxy pools per app ownership family:
  - **Match Group family:** Tinder, Hinge, OkCupid, POF, Match.com, The League → shared infrastructure, potentially shared ban signals
  - **Bumble Inc. family:** Bumble, Badoo → shared infrastructure
  - **Independent:** Grindr, Happn, Feeld, CMB → isolated risk

### Phone Number Supply
Apps requiring phone auth (Badoo, Feeld, POF): Use virtual SIM services (TextNow, Hushed, Twilio) for account creation. Maintain number per account for 2FA.

### Rate Limit Framework (Universal)
```
Max actions per hour = floor(human_plausible_daily_activity / 12)
Random delay = Math.random() * (max_delay - min_delay) + min_delay
  where min_delay = 3000ms, max_delay = 15000ms
Session break: 15-30min pause every 2 hours of activity
```

### Privacy & Legal Exposure
- **NEVER store user location data** from Grindr, Happn, Feeld — LGBTQ+ and ENM communities face real-world safety risks
- **GDPR compliance required** for any EU user data (Badoo/Happn strong EU presence)
- **Do not aggregate** profile data beyond session — scraping profiles for analysis likely violates CFAA and app ToS in ways that create legal liability
- Clap Cheeks should operate as a co-pilot (user's own account, user's own data) not as a scraping service

---

## Sources

- [GitHub: okcupidjs — OkCupid API wrapper](https://github.com/tranhungt/okcupidjs)
- [OkCupid: REST to GraphQL migration](https://michaelgeraci.com/work/okapi/)
- [GitHub: tioffs/badoo — Unofficial Badoo API (PHP)](https://github.com/tioffs/badoo)
- [GitHub: quark1482/badwrapi — Badoo API wrapper](https://github.com/quark1482/badwrapi)
- [GitHub: RobbieTechie/Grindr-API — Unofficial Grindr API docs](https://github.com/RobbieTechie/Grindr-API)
- [Grindr PyPI package](https://pypi.org/project/Grindr/0.0.8/)
- [GitHub: Slenderman00/grindr-access](https://github.com/Slenderman00/grindr-access)
- [GitHub: anthonyray/happn-1 — Python Happn wrapper](https://github.com/anthonyray/happn-1)
- [GitHub: hfreire/happn-wrapper — Node.js Happn wrapper](https://github.com/hfreire/happn-wrapper)
- [Hacking Happn for learning — Medium](https://medium.com/@ayush786113/hacking-happn-for-learning-69ab04f91bf0)
- [Feeld API security vulnerabilities — FireTail (April 2025)](https://www.firetail.ai/blog/feeld-dating-app-api)
- [Feeld security — Security Boulevard](https://securityboulevard.com/2025/04/feeld-dating-app-api-firetail-blog/)
- [GitHub: neelkhutale19/CoffeeMeetsBagel-API-Testing](https://github.com/neelkhutale19/CoffeeMeetsBagel-API-Testing)
- [Grindr Terms of Service](https://www.grindr.com/terms-of-service)
- [Grindr spam and banning policy](https://www.grindr.com/blog/spam-banning-support-and-moderation-update)
- [Thursday dating app shut down — Global Dating Insights](https://www.globaldatinginsights.com/featured/thursday-shutters-dating-app-to-shift-focus-on-real-world-events/)
- [Thursday dating app review — DatingScout](https://www.datingscout.com/thursday-dating-app/review)
- [Badoo statistics 2025 — ROAST](https://roast.dating/blog/badoo-statistics)
- [Badoo revenue — Business of Apps](https://www.businessofapps.com/data/badoo-statistics/)
- [Happn statistics 2025 — ROAST](https://roast.dating/blog/happn-statistics)
- [Dating app MAU rankings — DeveloperBazaar](https://developerbazaar.com/dating-app-statistics/)
- [POF Terms of Use](https://www.pof.com/terms/)
- [POF Bug Bounty — HackerOne](https://hackerone.com/pof)
- [Match.com statistics — DoULike](https://www.doulike.com/blog/online-dating/match-com-statistics/)
- [The League review 2025 — DatingScout](https://www.datingscout.com/the-league/review)
- [Coffee Meets Bagel reverse engineering — LaptrinhX](https://laptrinhx.com/reverse-engineering-apis-coffee-meets-bagel-1612016490/)
- [Dating app shadowban detection 2025](https://datephotos.ai/blog/dating-app-shadowban-detect-fix-2025)
- [Grindr unofficial API documentation (locatr)](https://github.com/devupper/locatr/blob/master/unofficial-grindr-api-documentation.md)
- [Reversing unofficial APIs — GitHub](https://github.com/ropcat/reversing-unofficial-APIs)
