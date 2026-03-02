# Phase 18: Conversation AI Summary

**One-liner:** Claude-powered reply suggestions with voice profile calibration from sample messages, 3 tones (playful/direct/flirty)

## What Was Built

### DB Migration (`web/scripts/007_conversation_ai.sql`)
- `clapcheeks_voice_profiles` table: per-user voice style profile with style_summary, tone, sample_phrases, profile_data (JSONB)
- `clapcheeks_reply_suggestions` table: stores generated suggestions with conversation context
- RLS policies: users can only see/modify their own data

### Reply Generation Engine (`web/lib/conversation-ai/generate-replies.ts`)
- Fetches user's voice profile for style matching
- Calls Claude claude-sonnet-4-6 with conversation context + voice profile
- Generates 3 replies (playful, direct, flirty) max 160 chars each
- Stores suggestions in database for history

### API Routes
- `POST /api/conversation/suggest`: generates 3 reply suggestions, integrated with usage limits
- `GET /api/conversation/voice-profile`: returns current voice profile
- `POST /api/conversation/voice-profile`: analyzes sample messages via Claude, extracts style traits (formality, emoji frequency, humor style, punctuation, capitalization)

### Conversation AI Page (`web/app/(main)/conversation/page.tsx`)
- Voice profile card with setup/retrain flow
- Curated sample message picker (tap messages that sound like you)
- Custom message input for personal samples
- Conversation textarea + match name + platform selector
- 3 reply suggestion cards with copy-to-clipboard, confidence bars, tone badges
- Generate/regenerate functionality

### Navigation
- Added "Conversation AI" link to dashboard header

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed voice-profile-setup.tsx string escaping**
- **Found during:** Build verification
- **Issue:** Apostrophes in sample message strings (e.g., "what's", "I've") broke JSX parsing
- **Fix:** Replaced with unicode right single quotation marks (\u2019) in string literals
- **Files modified:** `web/app/(main)/conversation/components/voice-profile-setup.tsx`

**2. [Rule 3 - Blocking] Created missing report-preferences.tsx**
- **Found during:** Build verification
- **Issue:** Reports page (from another agent) imported a non-existent `report-preferences` component
- **Fix:** Created stub component to unblock build
- **Files modified:** `web/app/(main)/reports/report-preferences.tsx`

## Key Files

| File | Purpose |
|------|---------|
| `web/scripts/007_conversation_ai.sql` | DB migration |
| `web/lib/conversation-ai/generate-replies.ts` | Reply generation logic |
| `web/app/api/conversation/suggest/route.ts` | Suggest API route |
| `web/app/api/conversation/voice-profile/route.ts` | Voice profile API route |
| `web/app/(main)/conversation/page.tsx` | Conversation AI page |
| `web/app/(main)/conversation/components/voice-profile-setup.tsx` | Voice calibration UI |

## Commit
- `b44cf7a`: feat(conversation): phase 18 conversation AI
