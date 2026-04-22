# Instagram DM Integration — Implementation Spec

Complete design for adding Instagram Direct Message support to Clapcheeks. Instagram is fundamentally different from dating apps: there is no mutual match gate, conversations can be cold-opened, and the platform's anti-automation enforcement is among the most aggressive in social media.

---

## 1. Instagram DM Access Options — Full Comparison

### Option A: Instagram Graph API / Messenger API (Official)

**What it is:** Meta's official API for Instagram messaging, built on the Messenger Platform infrastructure.

**Capabilities:**
- Send and receive DMs programmatically
- Webhook-based real-time message delivery
- Media attachments (images, video, audio)
- Ice breakers and quick replies
- Message read receipts

**Hard Limitations:**
- **Business/Creator accounts ONLY** — personal accounts are completely excluded. There is no official API path for personal Instagram accounts.
- Requires Facebook Business Page linked to the Instagram Professional account
- Facebook App Review required (weeks of review, no guarantee)
- 1,000-follower minimum for DM API access
- **24-hour messaging window**: you can only message users who engaged with your content in the last 24 hours. Cold DMs are blocked.
- One automated message per user per trigger event
- Rate limit: 200 DMs/hour (reduced from 5,000 in October 2024 — a 96% cut)
- `HUMAN_AGENT` message tag extends the window to 7 days, but only for human-agent responses to user-initiated conversations

**Verdict: NOT VIABLE for Clapcheeks.** The personal account restriction, 24-hour window, and engagement prerequisite make this unusable for a dating co-pilot. Users will not convert their personal Instagram to a business account, and cold DMs are the primary use case.

### Option B: Instagram Private API (instagrapi / aiograpi)

**What it is:** Reverse-engineered Instagram mobile API, packaged as Python libraries. Mimics the official Instagram mobile app's HTTP requests.

**Key Libraries:**
- **instagrapi** (PyPI: `instagrapi`) — synchronous, most popular, actively maintained through 2026
- **aiograpi** — async version of instagrapi, same maintainers

**Capabilities:**
- Login by username/password (supports 2FA via TOTP, SMS, email)
- Session persistence via session ID / cookies
- Full DM access: read threads, send text/media/links, receive messages
- Profile data extraction (bio, follower count, posts, stories)
- Story viewing and interaction
- Works with personal accounts
- No follower minimum, no Facebook Business Page requirement

**Key Methods (instagrapi):**
```python
cl = instagrapi.Client()
cl.login(username, password)

# Read DM threads
threads = cl.direct_threads(amount=20)

# Read messages in a thread
messages = cl.direct_messages(thread_id, amount=50)

# Send a message
cl.direct_send("Hello!", user_ids=[user_pk])

# Reply in existing thread
cl.direct_answer(thread_id, "Reply text")

# Send media
cl.direct_send_photo(path, user_ids=[user_pk])

# Get pending message requests
cl.direct_pending_inbox()
```

**Risks:**
- Violates Instagram ToS (same as all dating app automation in Clapcheeks)
- Instagram periodically patches the private API — library updates lag by days/weeks
- Challenge/checkpoint flows can block login (requires solving challenges programmatically or manually)
- 403 errors on `direct_send()` are increasingly common as Meta tightens enforcement
- IP-based rate limiting and device fingerprinting

**Verdict: BEST OPTION for personal account DMs, but requires careful session management and rate limiting to avoid action blocks.**

### Option C: Playwright Browser Automation on instagram.com

**What it is:** Automate the Instagram web app directly in a browser, same approach Clapcheeks uses for Tinder/Bumble/Hinge.

**Capabilities:**
- Full DM access through the web UI (read, send, manage requests)
- Profile viewing, story viewing
- Works with any account type
- Reuses existing `BrowserDriver`, `SessionStore`, and `StealthConfig` infrastructure
- Cookie-based session persistence (already implemented in `session.py`)

**Challenges:**
- Instagram's web app is a React SPA with obfuscated class names that change frequently
- DOM selectors are unstable — every Instagram deploy can break selectors
- Instagram uses advanced bot detection: CDP detection, canvas fingerprinting, WebGL fingerprinting, behavioral analysis
- Slower than API-based approaches (DOM manipulation vs HTTP requests)
- Requires maintaining a visible browser session (resource-heavy)
- Instagram web DM UI has limited functionality compared to mobile (no voice messages, limited media previews)

**Verdict: VIABLE as a fallback when the private API is blocked, but should not be the primary approach. The selector instability and detection risk make it fragile for production use.**

### Option D: Mobile Automation (Appium on iOS/Android)

**What it is:** Automate the Instagram mobile app on a real or emulated device using Appium.

**Capabilities:**
- Full access to every Instagram feature (DMs, stories, reels, etc.)
- Hardest to detect (running the real app on a real device)
- Accessibility selectors are more stable than web DOM selectors

**Challenges:**
- Requires a dedicated Android emulator or physical device
- Appium setup is complex (Android SDK, ADB, etc.)
- Significantly more infrastructure than web or API approaches
- Slower than API (UI interaction overhead)
- Does not integrate with existing Playwright architecture
- Scaling requires multiple emulator instances

**Verdict: OVERKILL for the current phase. Worth considering if both private API and Playwright fail, but the infrastructure cost is too high to justify as a first approach.**

### Option E: Third-Party Services (Unipile, Apify, etc.)

**What it is:** SaaS platforms that proxy Instagram access through their infrastructure.

**Examples:**
- **Unipile**: Unified messaging API supporting Instagram DMs
- **Apify**: Instagram DM automation actors
- **HikerAPI**: SaaS wrapper around instagrapi

**Capabilities:**
- Abstracts away session management, proxy rotation, and challenge handling
- Some offer webhook-based message delivery
- Managed rate limiting

**Drawbacks:**
- Monthly subscription cost ($50-200/month per account)
- Your Instagram credentials pass through a third party
- Dependency on their uptime and Instagram compatibility
- Limited customization compared to direct API/browser control
- Privacy concern: all message content passes through their servers

**Verdict: FALLBACK OPTION for users who want zero-setup Instagram integration. Not suitable as the core implementation due to privacy concerns and cost, but could be offered as a premium "managed" integration tier.**

---

## 2. Recommended Approach: Hybrid Private API + Playwright Fallback

### Primary: instagrapi (Private API)

Use `instagrapi` as the primary DM transport. It provides the fastest, most reliable access to Instagram DMs for personal accounts. The async variant `aiograpi` aligns with the existing async patterns in the codebase.

### Fallback: Playwright Browser Automation

When the private API encounters persistent challenges (checkpoint loops, 403 blocks, API changes), fall back to Playwright browser automation using the existing `BrowserDriver` infrastructure. This mirrors how dating app scrapers already work.

### Architecture Decision

```
InstagramClient
  |
  |-- tries: InstagrapiTransport (private API)
  |     fast, reliable, low resource
  |     handles: DM read/send, profile data, story viewing
  |
  |-- falls back to: PlaywrightTransport (browser automation)
  |     slower, resource-heavy, but works when API is blocked
  |     handles: same operations via DOM interaction
  |
  |-- session shared: both transports share credential/session state
```

---

## 3. Instagram Scraper Design

### 3.1 Module Structure

```
agent/clapcheeks/platforms/instagram.py    # Main InstagramClient
agent/clapcheeks/platforms/ig_api.py       # instagrapi transport
agent/clapcheeks/platforms/ig_browser.py   # Playwright transport
```

### 3.2 Login Flow & Session Persistence

```python
"""Instagram login — supports both API and browser transports."""

from pathlib import Path
import json

IG_SESSION_DIR = Path.home() / ".clapcheeks" / "sessions"
IG_SESSION_FILE = IG_SESSION_DIR / "instagram_api.json"

class InstagramSession:
    """Persist Instagram session across restarts.

    For API transport: stores session ID, device info, cookies
    For browser transport: delegates to existing SessionStore("instagram")
    """

    def save_api_session(self, client) -> None:
        """Save instagrapi client session to disk."""
        IG_SESSION_DIR.mkdir(parents=True, exist_ok=True)
        settings = client.get_settings()
        IG_SESSION_FILE.write_text(json.dumps(settings, indent=2))

    def load_api_session(self, client) -> bool:
        """Restore instagrapi client from saved session."""
        if not IG_SESSION_FILE.exists():
            return False
        try:
            settings = json.loads(IG_SESSION_FILE.read_text())
            client.set_settings(settings)
            client.login_by_sessionid(settings.get("sessionid", ""))
            return True
        except Exception:
            return False
```

**Login strategy:**
1. Try loading saved session (session ID + cookies)
2. If session is expired or missing, authenticate with username + password
3. Handle 2FA challenges:
   - TOTP (authenticator app): use `pyotp` to generate codes from stored seed
   - SMS/email: prompt user for code via CLI or dashboard notification
4. Handle checkpoint challenges:
   - If Instagram requires email/phone verification, prompt user
   - Store verification state to avoid re-prompting
5. Save session on successful login for next restart

### 3.3 DM Inbox Reading

```python
class InstagrapiTransport:
    """Primary transport: Instagram Private API via instagrapi."""

    def get_inbox(self, limit: int = 20) -> list[dict]:
        """Get DM threads sorted by most recent message."""
        threads = self.client.direct_threads(amount=limit)
        result = []
        for thread in threads:
            last_msg = thread.messages[0] if thread.messages else None
            users = [u.username for u in thread.users]
            result.append({
                "thread_id": thread.id,
                "users": users,
                "user_pks": [u.pk for u in thread.users],
                "last_message": last_msg.text if last_msg else "",
                "last_message_time": last_msg.timestamp if last_msg else None,
                "is_from_me": last_msg.user_id == self.client.user_id if last_msg else False,
                "unread": not thread.read_state,  # 0 = unread
            })
        return result

    def get_pending_requests(self) -> list[dict]:
        """Get message requests (DMs from non-followers)."""
        threads = self.client.direct_pending_inbox()
        return [
            {
                "thread_id": t.id,
                "users": [u.username for u in t.users],
                "preview": t.messages[0].text if t.messages else "",
            }
            for t in threads
        ]

    def accept_request(self, thread_id: str) -> bool:
        """Accept a pending message request."""
        return self.client.direct_thread_approve(thread_id)
```

### 3.4 Conversation Reading

```python
    def get_messages(self, thread_id: str, limit: int = 50) -> list[dict]:
        """Get messages from a specific conversation thread."""
        messages = self.client.direct_messages(thread_id, amount=limit)
        result = []
        for msg in messages:
            result.append({
                "message_id": msg.id,
                "text": msg.text or "",
                "user_id": msg.user_id,
                "is_from_me": msg.user_id == self.client.user_id,
                "timestamp": msg.timestamp,
                "item_type": msg.item_type,  # "text", "media", "reel_share", etc.
                "media_url": getattr(msg, "media", {}).get("url") if hasattr(msg, "media") else None,
            })
        # Messages come newest-first from API, reverse for chronological
        result.reverse()
        return result
```

### 3.5 Sending Messages

```python
    def send_message(self, user_pk: int, text: str) -> bool:
        """Send a DM to a user by their user PK (numeric ID)."""
        try:
            self.client.direct_send(text, user_ids=[user_pk])
            return True
        except Exception as exc:
            logger.error("Failed to send Instagram DM to %s: %s", user_pk, exc)
            return False

    def reply_to_thread(self, thread_id: str, text: str) -> bool:
        """Reply in an existing DM thread."""
        try:
            self.client.direct_answer(thread_id, text)
            return True
        except Exception as exc:
            logger.error("Failed to reply in thread %s: %s", thread_id, exc)
            return False
```

### 3.6 Message Request Handling

```python
    def handle_message_requests(self, auto_accept: bool = True) -> list[dict]:
        """Process pending message requests.

        For dating use: auto-accept requests that look like potential matches
        (profile analysis determines interest level).
        """
        requests = self.get_pending_requests()
        accepted = []

        for req in requests:
            if auto_accept:
                if self.accept_request(req["thread_id"]):
                    accepted.append(req)
                    logger.info("Accepted message request from %s", req["users"])

        return accepted
```

### 3.7 Profile Data Extraction

```python
    def get_profile(self, username: str) -> dict:
        """Extract profile data for AI context."""
        try:
            user = self.client.user_info_by_username(username)
            return {
                "user_pk": user.pk,
                "username": user.username,
                "full_name": user.full_name,
                "bio": user.biography,
                "follower_count": user.follower_count,
                "following_count": user.following_count,
                "is_private": user.is_private,
                "is_verified": user.is_verified,
                "profile_pic_url": str(user.profile_pic_url),
                "external_url": user.external_url,
                "category": user.category,  # e.g., "Artist", "Personal Blog"
                "media_count": user.media_count,
            }
        except Exception as exc:
            logger.error("Failed to get profile for %s: %s", username, exc)
            return {}

    def get_recent_posts(self, user_pk: int, limit: int = 6) -> list[dict]:
        """Get recent posts for conversation context."""
        try:
            medias = self.client.user_medias(user_pk, amount=limit)
            return [
                {
                    "media_id": m.id,
                    "caption": m.caption_text or "",
                    "media_type": m.media_type,  # 1=photo, 2=video, 8=carousel
                    "like_count": m.like_count,
                    "comment_count": m.comment_count,
                    "taken_at": m.taken_at,
                    "thumbnail_url": str(m.thumbnail_url) if m.thumbnail_url else None,
                }
                for m in medias
            ]
        except Exception as exc:
            logger.error("Failed to get posts for %s: %s", user_pk, exc)
            return []
```

### 3.8 Story Viewing & Reactions

```python
    def get_user_stories(self, user_pk: int) -> list[dict]:
        """Get current stories for a user (for story-reply openers)."""
        try:
            stories = self.client.user_stories(user_pk)
            return [
                {
                    "story_pk": s.pk,
                    "media_type": s.media_type,
                    "taken_at": s.taken_at,
                    "caption": getattr(s, "caption", None),
                    "mentions": [m.user.username for m in (s.mentions or [])],
                    "hashtags": [h.hashtag.name for h in (s.hashtags or [])],
                    "location": s.location.name if s.location else None,
                    "thumbnail_url": str(s.thumbnail_url) if s.thumbnail_url else None,
                }
                for s in stories
            ]
        except Exception as exc:
            logger.error("Failed to get stories for %s: %s", user_pk, exc)
            return []

    def reply_to_story(self, story_pk: int, text: str) -> bool:
        """Reply to a specific story (appears as DM with story context)."""
        try:
            self.client.direct_send(text, media_ids=[story_pk])
            return True
        except Exception as exc:
            logger.error("Story reply failed: %s", exc)
            return False
```

### 3.9 Playwright Fallback Transport

```python
"""Playwright browser transport for Instagram — fallback when API is blocked."""

from clapcheeks.browser.driver import BrowserDriver
from clapcheeks.browser.stealth import human_delay, random_delay, human_mouse_move

INSTAGRAM_URL = "https://www.instagram.com"
IG_DM_URL = f"{INSTAGRAM_URL}/direct/inbox/"

# Instagram web selectors — these WILL break and need maintenance.
# Use multiple fallback selectors per element.
IG_SELECTORS = {
    "dm_inbox": '[aria-label="Direct messaging"], [aria-label*="Direct"], a[href="/direct/inbox/"]',
    "thread_item": '[class*="x9f619"][role="listitem"], div[class*="thread"]',
    "thread_name": 'span[class*="x1lliihq"], [dir="auto"] span',
    "message_input": 'textarea[placeholder*="Message"], div[aria-label*="Message"][role="textbox"]',
    "send_button": 'button[type="submit"], div[role="button"]:has-text("Send")',
    "message_bubble": 'div[class*="x78zum5"][dir="auto"], div[role="row"]',
    "message_text": 'span[dir="auto"], div[dir="auto"]',
    "message_request_tab": 'a[href*="requests"], [aria-label*="request"]',
    "accept_button": 'button:has-text("Accept"), [aria-label*="Accept"]',
    "profile_link": 'a[href*="/"][role="link"]',
}

class PlaywrightTransport:
    """Browser-based Instagram transport. Slower but works when API is blocked."""

    def __init__(self, headless: bool = False) -> None:
        self.driver = BrowserDriver(platform="instagram", headless=headless)
        self._page = None

    async def login(self) -> bool:
        """Navigate to Instagram and wait for session or manual login."""
        self._page = await self.driver.launch()
        await self._page.goto(INSTAGRAM_URL, wait_until="domcontentloaded")

        # Check if already logged in (session cookies loaded by SessionStore)
        try:
            await self._page.locator(IG_SELECTORS["dm_inbox"]).first.wait_for(
                state="visible", timeout=8_000,
            )
            return True
        except Exception:
            pass

        # Not logged in — prompt user
        print(
            "\n=== Instagram Login Required ===\n"
            "Please log in to Instagram in the browser window.\n"
            "Waiting up to 120 seconds...\n"
        )

        for _ in range(40):
            await asyncio.sleep(3)
            try:
                await self._page.locator(IG_SELECTORS["dm_inbox"]).first.wait_for(
                    state="visible", timeout=2_000,
                )
                return True
            except Exception:
                continue

        raise TimeoutError("Instagram login timed out after 120 seconds.")

    async def navigate_to_dms(self) -> None:
        """Navigate to the DM inbox."""
        await self._page.goto(IG_DM_URL, wait_until="domcontentloaded")
        await random_delay(1.5, 3.0)

    async def send_message(self, username: str, text: str) -> bool:
        """Send a DM via browser UI."""
        # Navigate to user's DM thread
        await self._page.goto(
            f"{INSTAGRAM_URL}/direct/t/{username}/",
            wait_until="domcontentloaded",
        )
        await random_delay(1.0, 2.5)

        try:
            input_el = self._page.locator(IG_SELECTORS["message_input"]).first
            await input_el.wait_for(state="visible", timeout=5_000)

            # Type character-by-character for human-like behavior
            for char in text:
                await input_el.type(char, delay=random.uniform(30, 120))

            await random_delay(0.5, 1.5)

            # Press Enter to send (more natural than clicking Send button)
            await self._page.keyboard.press("Enter")
            return True
        except Exception as exc:
            logger.error("Browser DM send failed: %s", exc)
            return False
```

### 3.10 Anti-Detection Measures

The existing `stealth.py` provides a foundation, but Instagram requires additional measures:

```python
"""Instagram-specific anti-detection beyond base stealth.py."""

# Extended stealth init script for Instagram
IG_STEALTH_SCRIPT = """
// Base webdriver override (from stealth.py)
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// Instagram checks these specifically
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

// Prevent CDP detection (Instagram checks for Runtime.evaluate)
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

// Override permissions API (Instagram checks notification permission state)
const originalQuery = window.Notification.permission;
Object.defineProperty(Notification, 'permission', { get: () => 'default' });

// Canvas fingerprint randomization
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type) {
    if (type === 'image/png') {
        const ctx = this.getContext('2d');
        if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            // Add subtle noise to prevent fingerprint matching
            for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i] += Math.floor(Math.random() * 2) - 1;
            }
            ctx.putImageData(imageData, 0, 0);
        }
    }
    return originalToDataURL.apply(this, arguments);
};

// WebGL fingerprint randomization
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.apply(this, arguments);
};
"""

# Human-like interaction patterns for Instagram
INSTAGRAM_BEHAVIOR = {
    "scroll_before_action": True,      # Scroll the page before clicking anything
    "hover_before_click": True,        # Mouse hover 200-800ms before clicking
    "read_delay_per_word": 0.15,       # Seconds per word of visible content
    "between_messages_min": 30,        # Minimum seconds between DMs to different people
    "between_messages_max": 180,       # Maximum seconds between DMs
    "session_duration_min": 300,       # Minimum session: 5 minutes
    "session_duration_max": 1800,      # Maximum session: 30 minutes
    "scroll_variance": 0.3,            # +/- 30% scroll distance variance
    "typo_rate": 0.02,                 # 2% chance of typo per character (corrected)
}
```

### 3.11 Rate Limiting for Instagram

Add Instagram to the existing rate limiter:

```python
# Addition to rate_limiter.py DAILY_LIMITS
DAILY_LIMITS["instagram"] = {
    "dms_new": 20,        # New DMs to people not in existing threads (AGGRESSIVE limit)
    "dms_reply": 50,      # Replies in existing threads
    "story_replies": 15,  # Story replies (these are DMs with context)
    "profile_views": 50,  # Profile lookups
    "follows": 10,        # New follows (if enabled)
    "story_views": 30,    # Story views
}

# Addition to DELAY_CONFIG
DELAY_CONFIG["instagram_dm"] = {
    "mean": 45.0,   # Much slower than dating app swipes
    "std": 20.0,
    "min": 15.0,
    "max": 120.0,
}

DELAY_CONFIG["instagram_story_reply"] = {
    "mean": 30.0,
    "std": 10.0,
    "min": 10.0,
    "max": 60.0,
}
```

**Conservative limits rationale:**
- Instagram allows ~50-100 manual DMs/day for established accounts, but Clapcheeks should stay well below that
- New cold DMs (to non-contacts) are the highest risk action -- limited to 20/day
- Replies in existing threads are lower risk -- limited to 50/day
- Story replies are the most natural DM entry point and lowest risk -- 15/day
- Spacing messages 30-120 seconds apart within a session prevents velocity detection

---

## 4. Follow-Up System — Instagram-Specific Features

### 4.1 Story-Based Re-engagement

Instagram provides a unique re-engagement vector that dating apps lack: stories. When a conversation goes cold, reacting to or replying to someone's story is the most natural way to re-enter their awareness without looking desperate.

```python
class InstagramFollowUp:
    """Instagram-specific follow-up and re-engagement strategies."""

    def find_story_opportunities(self, cold_contacts: list[dict]) -> list[dict]:
        """Check cold contacts for active stories worth replying to.

        Priority: contacts with 3-7 days of silence who just posted a story.
        This is the golden window — story reply feels organic, not chasing.
        """
        opportunities = []
        for contact in cold_contacts:
            days_cold = contact["days_cold"]
            if days_cold < 3 or days_cold > 14:
                continue

            stories = self.ig_client.get_user_stories(contact["user_pk"])
            if not stories:
                continue

            # Find the most reply-worthy story
            best_story = self._score_story_replyability(stories)
            if best_story:
                opportunities.append({
                    "contact": contact,
                    "story": best_story,
                    "strategy": "story_reply",
                    "days_cold": days_cold,
                })

        return opportunities

    def _score_story_replyability(self, stories: list[dict]) -> dict | None:
        """Score stories by how natural a reply would feel.

        High score: travel photo, food, activity, asking a question
        Low score: generic repost, ad/promotion, no clear reply hook
        """
        scored = []
        for story in stories:
            score = 0.0
            caption = (story.get("caption") or "").lower()

            # Question in caption = easy reply hook
            if "?" in caption:
                score += 3.0

            # Location = conversation starter
            if story.get("location"):
                score += 2.0

            # Mentions = social context
            if story.get("mentions"):
                score += 1.0

            # Recency bonus (newer stories get higher score)
            # Stories expire after 24h, so all are recent by definition
            score += 1.0

            scored.append((score, story))

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1] if scored and scored[0][0] >= 2.0 else None
```

### 4.2 Platform Transition (Instagram -> Phone/iMessage)

```python
class PlatformTransition:
    """Manage the transition from Instagram DMs to phone number / iMessage.

    Strategy: After 5-10 messages of good conversation, suggest moving
    to text. This is the bridge from social media to personal contact.
    """

    TRANSITION_READINESS_SIGNALS = [
        "message_count >= 8",           # Enough conversation history
        "response_rate > 0.7",          # They reply to most messages
        "avg_response_time < 3600",     # Reply within an hour on average
        "mutual_questions >= 3",         # Both sides asking questions
        "positive_sentiment_streak >= 3", # Last 3+ messages positive
    ]

    TRANSITION_PHRASES = [
        "I'm barely on here — easier to text me at {phone}",
        "Let's move this to text, I miss notifications on here lol",
        "My IG notifications are broken. Text me? {phone}",
    ]

    def suggest_transition(self, conversation_state: dict) -> dict | None:
        """Returns transition suggestion if readiness signals are met."""
        if not self._check_readiness(conversation_state):
            return None

        return {
            "action": "suggest_phone_exchange",
            "confidence": self._calculate_transition_confidence(conversation_state),
            "suggested_message": random.choice(self.TRANSITION_PHRASES),
        }
```

### 4.3 Cross-Conversation Tracking

```python
class CrossPlatformTracker:
    """Track the same person across Instagram + dating apps.

    Links are established via:
    1. Instagram username mentioned in dating app bio
    2. Phone number shared in either conversation
    3. Manual linking by user in the dashboard
    """

    def check_dating_app_bio_for_instagram(
        self, bio: str
    ) -> str | None:
        """Extract Instagram handle from a dating app bio.

        Common patterns:
        - "ig: @username"
        - "insta: username"
        - "@username" (when context suggests Instagram)
        - "find me on ig username"
        """
        import re

        patterns = [
            r'(?:ig|insta|instagram)\s*[:\-]?\s*@?(\w{1,30})',
            r'@(\w{1,30})\s*(?:on\s+)?(?:ig|insta|instagram)',
            r'(?:find\s+me\s+on\s+(?:ig|insta))\s+@?(\w{1,30})',
        ]

        for pattern in patterns:
            match = re.search(pattern, bio, re.IGNORECASE)
            if match:
                return match.group(1).lower()

        return None

    def link_profiles(
        self, user_id: str, instagram_username: str, source_platform: str
    ) -> None:
        """Create a cross-platform identity link in the database."""
        # Store in Supabase contacts table
        # Links: contacts.platform_ids = {"hinge": "...", "instagram": "..."}
        pass
```

---

## 5. Cross-Platform Identity Linking

### 5.1 Data Model

```sql
-- Extension to existing contacts table
ALTER TABLE contacts ADD COLUMN platform_ids JSONB DEFAULT '{}';
-- Example: {"hinge": "hinge_user_123", "instagram": "cool_person", "phone": "+15551234567"}

ALTER TABLE contacts ADD COLUMN instagram_username TEXT;
ALTER TABLE contacts ADD COLUMN instagram_user_pk BIGINT;

-- Cross-platform link events (audit trail)
CREATE TABLE cross_platform_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES contacts(id),
    source_platform TEXT NOT NULL,
    target_platform TEXT NOT NULL,
    link_method TEXT NOT NULL,  -- 'bio_extract', 'phone_match', 'manual', 'name_photo'
    confidence FLOAT DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 5.2 Linking Methods

| Method | Confidence | How It Works |
|--------|-----------|--------------|
| **Bio extraction** | 0.95 | Parse Instagram handle from Hinge/Bumble/Tinder bio text |
| **Phone number match** | 1.0 | Same phone number shared in Instagram DM and iMessage |
| **Manual link** | 1.0 | User explicitly confirms "this person on Hinge is also @username on Instagram" |
| **Name + photo similarity** | 0.6 | Same first name + visual similarity in profile photos (requires image embedding comparison) |

### 5.3 Unified Conversation View

When profiles are linked, the system should:
- Merge conversation history across platforms into a single timeline for AI context
- Track which platform has the most active/recent conversation
- Avoid duplicate re-engagement (do not follow up on Hinge AND Instagram simultaneously)
- Use the best available profile data from any linked platform for AI personalization

---

## 6. Instagram-Specific AI Rules

Instagram conversations are fundamentally different from dating app conversations. The AI system prompt and behavior rules must adapt accordingly.

### 6.1 Story Reply Openers

Story replies are the most natural way to start a conversation on Instagram. The AI must reference the actual story content:

```python
STORY_REPLY_SYSTEM_PROMPT = """
You are replying to someone's Instagram story to start a conversation.
Your reply should:
1. Reference something SPECIFIC in their story (not just "cool story!")
2. Be brief: 1-2 sentences max, feel like a spontaneous reaction
3. Ask a question or make a comment that invites a response
4. Match the energy of the story (funny story = funny reply, travel = adventurous)
5. NEVER be generic ("that's awesome!", "nice!", "wow!")
6. NEVER be creepy or overly forward
7. Sound like you're casually reacting, not strategically messaging

Examples of GOOD story replies:
- Story shows them cooking: "Ok but did the pasta actually turn out? That sauce looks suspiciously perfect"
- Story shows them hiking: "Where is that?? I've been trying to find trails that don't look like a parking lot on weekends"
- Story shows them at a concert: "Wait you were at that show?? How was the sound from where you were?"

Examples of BAD story replies:
- "You're so beautiful" (too forward for a story reply)
- "Looks fun!" (generic, no conversation hook)
- "We should do that together sometime" (too presumptuous)
"""
```

### 6.2 Cold DM Approach

Unlike dating apps where both people swiped right (mutual interest), Instagram DMs are cold outreach. The tone must account for this:

```python
COLD_DM_SYSTEM_PROMPT = """
You are writing a first DM to someone on Instagram. There is NO mutual match —
they did not swipe right on you. This means:

1. You need a REASON to message them. Reference:
   - A specific post or story of theirs
   - A shared interest visible in their bio/posts
   - A mutual friend or event
   - Their content (compliment their work, not their looks)

2. The tone is CASUAL and LOW-PRESSURE:
   - No dating intent in the first message
   - Start a genuine conversation about shared interests
   - Make it easy for them to respond (ask a question)
   - One message only — no double-texting if they don't respond

3. NEVER in a first Instagram DM:
   - Ask them out
   - Comment on their physical appearance
   - Send a pickup line
   - Use dating app energy ("hey gorgeous")
   - Send a paragraph-length message
   - Reference that you found them on a dating app

4. The goal is to start a conversation, not close a date.
   The date ask happens after 5-10 messages of genuine back-and-forth.
"""
```

### 6.3 Value-First Engagement Strategy

Before DMing someone on Instagram, the agent should establish a lightweight presence:

```python
ENGAGEMENT_SEQUENCE = {
    "day_1": "like 1-2 of their recent posts",
    "day_2": "view their stories (will show up in their viewer list)",
    "day_3_4": "like another post or two, react to a story with emoji",
    "day_5_plus": "reply to a story with a genuine comment (this opens the DM)",
}

# This creates a sense of familiarity before the DM arrives.
# They see your name in their notifications 2-3 times before you message.
# When the DM arrives, you're "that person who's been engaging" — not a stranger.
```

### 6.4 Tone Calibration

```python
INSTAGRAM_TONE_RULES = {
    "formality": "lower than dating apps — Instagram is casual",
    "message_length": "shorter than Hinge comments — 1-2 sentences typical",
    "emoji_usage": "match their usage — if they use none, you use none",
    "response_time": "faster than dating apps — Instagram is real-time feel",
    "humor_threshold": "higher — Instagram culture rewards humor over sincerity",
    "vulnerability": "lower initially — build to vulnerability, don't lead with it",
    "question_frequency": "every other message, not every message — avoid interview mode",
}
```

---

## 7. Risk Mitigation — Avoiding Instagram Bans

### 7.1 Action Limits

| Action | Per Hour | Per Day | Notes |
|--------|----------|---------|-------|
| New DMs (cold outreach) | 3-5 | 15-20 | Highest risk action — keep very low |
| DM replies (existing threads) | 10-15 | 40-50 | Lower risk but still monitored |
| Story replies | 5-8 | 15-20 | Moderate risk, depends on account age |
| Story views | 20-30 | 50-80 | Low risk, appears as normal browsing |
| Post likes | 15-20 | 50-80 | Moderate risk at high velocity |
| Profile views | 10-15 | 40-50 | Low risk individually, high risk in bursts |
| Follows | 2-3 | 8-10 | Moderate-high risk — Instagram tracks follow velocity |

**New accounts (< 30 days):** cut ALL limits by 60%. New accounts get flagged much faster.

### 7.2 Human-Like Behavior Patterns

```python
class InstagramBehaviorSimulator:
    """Generate human-like interaction patterns for Instagram."""

    def generate_session_schedule(self) -> list[dict]:
        """Create a daily session schedule that mimics real usage.

        Real Instagram users check the app 5-10 times per day,
        for 2-10 minutes per session, with longer sessions in
        the evening.
        """
        import random
        from datetime import time as dtime

        sessions = []

        # Morning check (7-9 AM) — short
        sessions.append({
            "start": dtime(random.randint(7, 8), random.randint(0, 59)),
            "duration_min": random.randint(2, 5),
            "actions": ["check_dms", "view_stories"],
        })

        # Midday check (11 AM - 1 PM) — short
        sessions.append({
            "start": dtime(random.randint(11, 12), random.randint(0, 59)),
            "duration_min": random.randint(3, 8),
            "actions": ["check_dms", "reply_dms", "view_stories"],
        })

        # Afternoon (3-5 PM) — moderate
        sessions.append({
            "start": dtime(random.randint(15, 16), random.randint(0, 59)),
            "duration_min": random.randint(5, 12),
            "actions": ["check_dms", "reply_dms", "view_stories", "like_posts"],
        })

        # Evening (7-10 PM) — longest session, primary DM window
        sessions.append({
            "start": dtime(random.randint(19, 21), random.randint(0, 59)),
            "duration_min": random.randint(10, 25),
            "actions": [
                "check_dms", "reply_dms", "send_new_dms",
                "view_stories", "story_replies", "like_posts",
            ],
        })

        # Late night (10 PM - 12 AM) — 50% chance, moderate
        if random.random() < 0.5:
            sessions.append({
                "start": dtime(random.randint(22, 23), random.randint(0, 59)),
                "duration_min": random.randint(3, 10),
                "actions": ["check_dms", "reply_dms", "view_stories"],
            })

        return sessions

    def add_browsing_noise(self, page) -> None:
        """Add random non-DM browsing to make the session look natural.

        Between DM actions, scroll the feed, view explore page,
        look at a few profiles — the way a real person uses Instagram.
        """
        noise_actions = [
            self._scroll_feed,
            self._view_explore,
            self._view_random_story,
            self._idle_pause,
        ]

        action = random.choice(noise_actions)
        asyncio.ensure_future(action(page))
```

### 7.3 Session & Account Management

```python
# Account warmup schedule for new Instagram accounts
WARMUP_SCHEDULE = {
    "week_1": {
        "dms_per_day": 3,
        "story_replies_per_day": 2,
        "likes_per_day": 15,
        "follows_per_day": 3,
        "sessions_per_day": 2,
    },
    "week_2": {
        "dms_per_day": 7,
        "story_replies_per_day": 5,
        "likes_per_day": 30,
        "follows_per_day": 5,
        "sessions_per_day": 3,
    },
    "week_3": {
        "dms_per_day": 12,
        "story_replies_per_day": 10,
        "likes_per_day": 50,
        "follows_per_day": 8,
        "sessions_per_day": 4,
    },
    "week_4_plus": {
        "dms_per_day": 20,
        "story_replies_per_day": 15,
        "likes_per_day": 70,
        "follows_per_day": 10,
        "sessions_per_day": 5,
    },
}
```

### 7.4 Instagram-Specific Detection Triggers

**What gets you banned (from 2025-2026 ban wave analysis):**
1. Sending identical or near-identical messages to multiple people — Instagram's ML detects template messages
2. High volume of DMs to non-followers — cold DM velocity is the #1 trigger
3. Rapid follow/unfollow cycles — classic bot behavior
4. Accessing from datacenter IPs — Instagram blocks AWS/GCP/DigitalOcean ranges
5. Multiple accounts from the same device/IP — Instagram tracks device fingerprints across accounts
6. Sending links in DMs (especially shortened URLs) — treated as spam
7. Using the same device session for API AND browser simultaneously — Instagram detects dual access
8. Logging in from geographically impossible locations — if you're in LA, don't proxy through Singapore

**What does NOT typically get you banned:**
1. Story viewing — even at high volume, this is normal behavior
2. Replying to stories — this is an encouraged platform behavior
3. Liking posts at moderate pace (< 30/hour)
4. Sending unique, conversational DMs to existing contacts
5. Using the app at consistent times from a consistent location

### 7.5 Proxy Configuration

Add Instagram as a new platform family in the proxy manager:

```python
# Addition to proxy/manager.py
PLATFORM_FAMILY["instagram"] = "social_media"

# Instagram requires residential proxies — datacenter IPs are instantly flagged.
# Recommended: use the same residential IP consistently (sticky sessions)
# rather than rotating per request. Instagram tracks IP consistency.
```

### 7.6 Ban Detection for Instagram

```python
# Instagram-specific ban signal keywords
IG_BAN_KEYWORDS = frozenset({
    "action blocked",
    "try again later",
    "we restrict certain activity",
    "suspicious activity",
    "confirm your identity",
    "your account has been disabled",
    "challenge_required",
    "checkpoint_required",
    "login_required",
    "consent_required",
})

# Instagram action block types
IG_ACTION_BLOCKS = {
    "temporary": {
        "duration_hours": 24,
        "response": "pause_platform",
        "resume_after": 48,  # Wait 2x the block duration
    },
    "extended": {
        "duration_hours": 72,
        "response": "pause_platform",
        "resume_after": 168,  # Wait 1 week
    },
    "permanent": {
        "duration_hours": None,
        "response": "hard_ban",
        "resume_after": None,
    },
}
```

---

## 8. Integration with Existing Architecture

### 8.1 Platform Client Interface

Instagram must implement the same interface as Tinder/Hinge/Bumble clients:

```python
class InstagramClient:
    """Main Instagram client — orchestrates API and browser transports."""

    def __init__(
        self,
        username: str,
        password: str,
        transport: str = "api",  # "api" or "browser"
        headless: bool = False,
    ) -> None:
        self.username = username
        self.password = password

        if transport == "api":
            self._transport = InstagrapiTransport(username, password)
        else:
            self._transport = PlaywrightTransport(headless=headless)

        self.session = InstagramSession()

    # Standard platform client interface
    def login(self) -> bool: ...
    def check_new_matches(self) -> list[dict]: ...     # = new DMs / message requests
    def send_message(self, match_id: str, message: str) -> bool: ...
    def get_matches(self, count: int = 20) -> list[dict]: ...  # = DM threads

    # Instagram-specific methods
    def get_stories(self, user_pk: int) -> list[dict]: ...
    def reply_to_story(self, story_pk: int, text: str) -> bool: ...
    def get_profile(self, username: str) -> dict: ...
    def get_message_requests(self) -> list[dict]: ...
    def accept_request(self, thread_id: str) -> bool: ...
```

### 8.2 Configuration

```yaml
# Addition to ~/.clapcheeks/config.yaml

instagram:
  enabled: true
  username: "your_username"
  # Password stored in keychain or 1Password, NOT in config file
  transport: "api"                    # "api" or "browser"
  headless: false                     # For browser transport

  limits:
    cold_dms_per_day: 15
    replies_per_day: 40
    story_replies_per_day: 12
    likes_per_day: 60
    follows_per_day: 8

  behavior:
    warmup_mode: false                # Enable for new accounts
    engagement_before_dm: true        # Like posts before DMing
    engagement_days: 3                # Days of engagement before first DM
    story_reply_priority: true        # Prefer story replies over cold DMs
    auto_accept_requests: true        # Auto-accept incoming message requests

  proxy:
    enabled: false
    type: "residential"               # MUST be residential for Instagram
    sticky_session: true              # Same IP across sessions
```

### 8.3 Event Integration

```python
# Addition to events.py — Instagram-specific events
INSTAGRAM_EVENTS = {
    "ig_dm_received": "New Instagram DM received",
    "ig_dm_sent": "Instagram DM sent",
    "ig_story_replied": "Replied to Instagram story",
    "ig_request_accepted": "Message request accepted",
    "ig_profile_linked": "Instagram profile linked to dating app match",
    "ig_action_blocked": "Instagram action block detected",
    "ig_transition_suggested": "Platform transition to iMessage suggested",
}
```

### 8.4 Dashboard Integration

The web dashboard should show:
- Instagram conversations alongside dating app matches
- Cross-platform identity links (Hinge match = Instagram DM)
- Instagram-specific stats (story reply rate, DM response rate)
- Action block warnings and cooldown timers
- Account warmup progress (if enabled)

---

## 9. Implementation Phases

### Phase 1: Core Instagram DM (2-3 weeks)
- `ig_api.py` — instagrapi transport with login, session persistence, DM read/send
- `instagram.py` — main client with standard platform interface
- Rate limiter updates for Instagram limits
- Ban detector updates for Instagram-specific signals
- Basic CLI commands: `clapcheeks ig inbox`, `clapcheeks ig send`, `clapcheeks ig login`

### Phase 2: Story Integration (1-2 weeks)
- Story viewing and reply functionality
- Story-based re-engagement engine
- AI story reply generation (with story content context)

### Phase 3: Cross-Platform Linking (1-2 weeks)
- Bio extraction for Instagram handles from dating app profiles
- Phone number matching across platforms
- Unified conversation view in dashboard
- Duplicate detection (same person on Hinge + Instagram)

### Phase 4: Browser Fallback (1 week)
- `ig_browser.py` — Playwright transport implementation
- Automatic fallback when API transport fails
- Extended stealth measures for Instagram web

### Phase 5: Engagement Automation (1-2 weeks)
- Pre-DM engagement sequence (likes, story views)
- Account warmup scheduler
- Value-first approach automation
- Platform transition suggestions (Instagram -> iMessage)

---

## Sources

- [Instagram DM Automation Rules: Full Guide (2026)](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)
- [Instagram API Rate Limits: 200 DMs/Hour Explained (2026)](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)
- [Instagram DM Limits (2026): Daily Message Caps, Character Limits](https://flowgent.ai/blog/instagram-dm-limits-how-many-messages-you-can-send-daily)
- [Instagram DM Bot Bans 2026: What Got Accounts Axed](https://sumgenius.ai/blog/instagram-dm-bot-ban-wave-2026/)
- [How to Avoid Instagram Bans with DM Automation](https://creatorflow.so/blog/avoid-instagram-bans-dm-automation/)
- [Instagram Ban Wave 2025: Causes, AI Moderation Errors](https://medium.com/@antiban.pro/instagram-ban-wave-2025-causes-ai-moderation-errors-and-how-to-recover-your-account-9639a063c9c2)
- [Instagram Automated Behaviour: What's Banned vs. Safe](https://www.spurnow.com/en/blogs/instagram-automated-behaviour)
- [How to Fix Instagram Action Block in 2025](https://proxidize.com/blog/instagram-action-block/)
- [instagrapi — Python Library for Instagram Private API](https://subzeroid.github.io/instagrapi/)
- [instagrapi Direct Message Usage Guide](https://subzeroid.github.io/instagrapi/usage-guide/direct.html)
- [aiograpi — Asynchronous Python Library for Instagram Private API](https://subzeroid.github.io/aiograpi/)
- [Instagram API Integration for SaaS (Unipile)](https://www.unipile.com/instagram-api-guide/)
- [Avoid Bot Detection With Playwright Stealth](https://www.scrapeless.com/en/blog/avoid-bot-detection-with-playwright-stealth)
- [How To Make Playwright Undetectable](https://scrapeops.io/playwright-web-scraping-playbook/nodejs-playwright-make-playwright-undetectable/)
- [Instagram Bans, Blocks and Limits: Complete Guide](https://inssist.com/knowledge-base/instagram-bans-blocks-and-limits)
- [Instagram Automation in 2026: Auto-DM Without Action Blocks](https://www.moimobi.com/blog/en/Instagram-Automation-in-2026-How-to-Auto-DM-Grow-Without-Action-Blocks/)
