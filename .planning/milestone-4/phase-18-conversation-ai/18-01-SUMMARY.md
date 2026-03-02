# Phase 18 Plan 01: Conversation AI Update Summary

**One-liner:** Witty/warm/direct reply styles with research-backed dating strategy prompts, platform tone guidance, and Python reply module with Ollama->Claude->Kimi fallback chain

## What Was Done

### Updated Reply Generation (`web/lib/conversation-ai/generate-replies.ts`)
- Changed tone styles from playful/direct/flirty to witty/warm/direct
- Added research-backed dating strategy to system prompt:
  - Ask for date after ~7 messages, skip phone number (60% failure rate)
  - Reference specific details from messages
  - 160 char limit for 2x more responses
- Added per-platform tone guidance (Tinder=playful, Bumble=direct, Hinge=casual, iMessage=mirror)
- Added `reasoning` field to ReplySuggestion interface
- Added optional `profileContext` parameter threaded through to Claude prompt
- Increased max_tokens to 768 for reasoning content

### Updated API Route (`web/app/api/conversation/suggest/route.ts`)
- Accepts optional `profile_context` field in POST body
- Passes through to generateReplies as profileContext parameter

### Updated Conversation UI (`web/app/(main)/conversation/page.tsx`)
- Suggestion interface: tone now `'witty' | 'warm' | 'direct'`, added `reasoning: string`
- toneColors map: witty=blue, warm=amber, direct=green
- Displays reasoning text below each suggestion in muted text

### Created Python Reply Module (`agent/clapcheeks/ai/reply.py`)
- `generate_reply(conversation_history, platform, style)` function
- Fallback chain: Ollama (local) -> Claude API (claude-sonnet-4-6) -> Kimi API -> safe string
- System prompt with same research-backed strategy as web version
- Platform tone guidance for Tinder/Bumble/Hinge/iMessage

### Updated ConversationManager (`agent/clapcheeks/conversation/manager.py`)
- Added import of `generate_reply` from `clapcheeks.ai.reply`
- New `generate_reply_for_conversation()` public method
- `suggest_reply()` now falls back to `generate_reply()` when web AI service is unreachable

### Dashboard Navigation
- Verified "Conversation AI" link already exists at `/conversation` — no change needed

## Deviations from Plan

None — plan executed exactly as written.

## Key Files

| File | Purpose |
|------|---------|
| `web/lib/conversation-ai/generate-replies.ts` | Updated reply generation with research-backed prompts |
| `web/app/api/conversation/suggest/route.ts` | Updated API route with profile_context |
| `web/app/(main)/conversation/page.tsx` | Updated UI with witty/warm/direct + reasoning |
| `agent/clapcheeks/ai/reply.py` | New Python reply module with fallback chain |
| `agent/clapcheeks/conversation/manager.py` | Updated manager with local reply fallback |

## Commits

| Hash | Message |
|------|---------|
| `a7fa084` | feat(18-conversation-ai): update reply styles to witty/warm/direct with research-backed prompts |
| `6e55286` | feat(18-conversation-ai): add Python reply module with Claude API + Ollama fallback |

## Duration

~3 minutes

## Completed

2026-03-02
