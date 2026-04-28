# AI-8807: Unified Cross-Channel Conversation Thread

## Schema Investigation

**Single table confirmed:** `clapcheeks_conversations` has:
- `messages` JSONB array OR individual body/direction/sent_at columns
- `channel` TEXT: 'platform' | 'imessage' (added by Phase F migration)
- `match_id` TEXT linking to `clapcheeks_matches.external_id`

**Match platform** stored in `clapcheeks_matches.platform`: 'tinder' | 'hinge' | 'bumble' | 'offline'

**No separate Instagram message table** — all messages go through clapcheeks_conversations

**No migration needed** — single unified table with channel column already exists.

## Implementation Plan

### 1. web/lib/matches/conversation.ts (NEW)
- `getMatchConversationUnified(supabase, matchId, userId, platform?)` 
- Queries clapcheeks_conversations for all rows matching user+match
- Normalizes both message shapes (JSONB array vs row-per-message)
- Enriches with per-message `channel` (derived from conversation row channel + match platform)
- Dedupes by message id, sorts by sent_at, caps at 500

### 2. web/lib/matches/types.ts (UPDATE)
- Extend `ConversationChannel` to include specific platform channels
- New type `UnifiedConversationMessage` with channel, platform, direction fields

### 3. web/components/matches/ConversationThread.tsx (REWRITE)
- Channel badges per message (Tinder=pink/flame, Hinge=purple, Bumble=yellow, IG=gradient, iMessage=blue)
- Handoff markers: horizontal divider when channel changes between consecutive messages
- Filter chips: All / Tinder / Hinge / Bumble / Instagram / iMessage
- Day separators: midnight crossing
- 60s direction grouping (no avatar repeat within same direction within 60s)

### 4. web/app/(main)/matches/[id]/page.tsx (UPDATE)
- Import and use `getMatchConversationUnified` 
- Pass enriched messages to MatchProfileView
- Also pass match platform for channel enrichment

### 5. web/app/(main)/matches/[id]/conversation-thread.tsx (UPDATE)
- Update ChatMessage type to include channel fields
- The outer file owns the data type contract

## Key Decisions
- No migration needed (single unified table already)
- ConversationThread.tsx (components/) is the shared component — update it
- conversation-thread.tsx (app/) is the page-local "rich" version — update it  
- The page.tsx loads data server-side and passes to client
