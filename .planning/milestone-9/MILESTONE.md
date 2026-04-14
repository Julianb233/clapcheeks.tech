# Milestone 9: Personal Dating Command Center (v0.9)

**Goal:** Transform ClapCheeks from a SaaS shell into Julian's personal dating command center with intelligence profiling, Instagram scraping, zodiac compatibility, match pipeline management, autonomous conversations, scheduled follow-ups, and date booking.

**Why now:** M1-M7 built the SaaS infrastructure. M8 (GTM) is about launching to users. But Julian wants to dogfood it himself first as a personal power tool — this milestone builds the features that make it actually useful day-to-day.

**Scope:** 7 feature areas across ~7 phases (39-45)

---

## Feature Areas

### 1. Zodiac & Astrology Intelligence
- Calculate zodiac sign from birthday (sun sign + element + modality)
- Compatibility scoring (Julian's sign vs match's sign)
- Astrology-based communication tips per sign
- Display zodiac prominently on match profile cards
- Optional: moon sign, rising sign if birth time known

### 2. Instagram Profile Scraper
- Given IG handle → scrape bio, interests, photos, follower count, post themes
- Browserbase for anti-detection (IG blocks headless browsers)
- Auto-extract: hobbies, travel history, aesthetic, mutual connections
- Feed scraped data into communication profile automatically
- Photo gallery saved locally for reference

### 3. Communication Profiling for Dates
- Adapt existing DISC/VAK/NLP system for dating context
- Analyze conversation patterns: response speed, emoji usage, topic engagement
- Strategy generation: conversation starters, topics to bring up, red flags
- Store full profile per match in Supabase
- Integrate with Obsidian Dating/ templates

### 4. Match Pipeline & Rankings
- Kanban pipeline: New → Talking → Number Got → Date Planned → Dated → Ranked
- Multi-dimension ranking: attraction, conversation quality, compatibility, zodiac match, effort
- Swipe/card interface for quick ranking updates
- Filter/sort by any dimension
- Mobile-first design (Julian uses on phone)

### 5. Scheduled Message Sequences
- Follow-up sequences (e.g., "text again in 2 days if no reply")
- Transition prompts: dating app → iMessage
- Optimal send timing based on response patterns
- god draft integration for scheduled sends
- Approval queue for messages before they go out

### 6. Date Planning & Calendar
- Date idea suggestions based on match interests (IG + conversation analysis)
- Google Calendar integration
- Budget tracking per date
- Post-date rating and notes
- Location suggestions in San Diego area

### 7. Full Autonomy Mode
- Auto-swipe based on learned preferences
- Auto-respond in Julian's voice style
- Auto-follow-up on stale conversations
- Auto-suggest "move to text" when conversation is warm
- Approval gates: pause only for date booking confirmation
- Degraded mode: notify Julian when confidence is low

---

## Phases

| Phase | Name | Focus |
|-------|------|-------|
| 39 | Match Profile Engine | Supabase schema + zodiac calculation + IG scraper + comms profiling |
| 40 | Pipeline Dashboard | Kanban UI + match cards + ranking system + mobile-responsive |
| 41 | Conversation Intelligence | Message analysis + strategy generation + reply drafting |
| 42 | Scheduled Messaging | Follow-up sequences + god draft integration + timing optimization |
| 43 | Date Planner | Calendar integration + date ideas + budget tracking + post-date notes |
| 44 | Autonomy Engine | Auto-swipe + auto-respond + auto-follow-up + approval gates |
| 45 | Polish & Integration | End-to-end flows + mobile UX + Obsidian sync + notification system |

---

## Tech Constraints

- Integrate with existing ClapCheeks codebase (Next.js 15 + Supabase `oouuoepmkeqdyzsxrnjh`)
- Instagram scraping via Browserbase (anti-detection required)
- Zodiac calculation is pure logic — no external API
- Scheduled messages via `god draft` + cron
- Dashboard must be mobile-first (Julian uses on phone)
- Communication profiles extend existing `contact_communication_profiles` pattern from Dashboard Daddy
- All match data stays in Supabase (not just Obsidian)

---

## Success Criteria

1. Julian can open dashboard on phone, see all matches in pipeline view
2. Adding a match with birthday auto-calculates zodiac + compatibility
3. Pasting an IG handle auto-populates profile with scraped interests
4. Each match has a communication strategy with specific talking points
5. Follow-up messages fire on schedule without manual intervention
6. Date ideas are personalized based on match interests
7. System runs hands-off with approval gates only for date booking
