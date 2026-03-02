---
phase: 18-conversation-ai
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - web/app/(main)/conversation/page.tsx
  - web/lib/conversation-ai/generate-replies.ts
  - web/app/api/conversation/suggest/route.ts
  - web/app/(main)/dashboard/page.tsx
  - agent/clapcheeks/conversation/manager.py
  - agent/clapcheeks/ai/reply.py
autonomous: true

must_haves:
  truths:
    - "User can paste a conversation, select a platform, and get 3 AI reply suggestions ranked by style (witty/warm/direct)"
    - "User can copy any suggestion with one click"
    - "Conversation AI page is accessible from dashboard nav"
    - "Python agent can generate replies via Claude API with Ollama fallback"
  artifacts:
    - path: "web/app/(main)/conversation/page.tsx"
      provides: "Reply suggestions UI with platform selector and copy buttons"
    - path: "web/lib/conversation-ai/generate-replies.ts"
      provides: "Claude API call with platform-aware system prompt and 3-style output"
    - path: "web/app/api/conversation/suggest/route.ts"
      provides: "POST endpoint accepting conversation, platform, profile_context"
    - path: "agent/clapcheeks/ai/reply.py"
      provides: "generate_reply() with Claude API + Ollama fallback"
    - path: "web/app/(main)/dashboard/page.tsx"
      provides: "Conversations nav link in dashboard header"
  key_links:
    - from: "web/app/(main)/conversation/page.tsx"
      to: "/api/conversation/suggest"
      via: "fetch POST on Generate button click"
      pattern: "fetch.*api/conversation/suggest"
    - from: "web/app/api/conversation/suggest/route.ts"
      to: "web/lib/conversation-ai/generate-replies.ts"
      via: "generateReplies() import"
      pattern: "generateReplies"
    - from: "agent/clapcheeks/conversation/manager.py"
      to: "agent/clapcheeks/ai/reply.py"
      via: "generate_reply() import"
      pattern: "from clapcheeks\\.ai\\.reply import"
---

<objective>
Update the existing Conversation AI feature to match the Phase 18 spec: rename tone styles from playful/direct/flirty to witty/warm/direct, add research-backed platform tone guidance and dating strategy to the system prompt, enhance the Python agent with a dedicated `generate_reply()` function that uses Claude API with Ollama fallback, and ensure "Conversations" is in the dashboard nav.

Purpose: Complete the Conversation AI feature for Milestone 4 — users get AI reply suggestions tuned per-platform with research-backed dating strategy baked into the prompts.

Output: Updated web UI, API, generation logic, Python agent reply module, and dashboard nav link.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md

Existing files to modify (all already exist):
@web/app/(main)/conversation/page.tsx
@web/app/api/conversation/suggest/route.ts
@web/lib/conversation-ai/generate-replies.ts
@web/app/(main)/dashboard/page.tsx
@agent/clapcheeks/conversation/manager.py
@agent/clapcheeks/ai/date_ask.py (reference for _call_llm pattern and _PLATFORM_TONE)
@agent/clapcheeks/ai/opener.py (reference for Ollama-first, Claude-fallback pattern)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update web reply generation and API with research-backed prompts and witty/warm/direct styles</name>
  <files>
    web/lib/conversation-ai/generate-replies.ts
    web/app/api/conversation/suggest/route.ts
    web/app/(main)/conversation/page.tsx
    web/app/(main)/dashboard/page.tsx
  </files>
  <action>
    **1. Update `web/lib/conversation-ai/generate-replies.ts`:**

    Change the system prompt to include research-backed dating strategy and platform-specific tone guidance. Update tone types from `playful | direct | flirty` to `witty | warm | direct`.

    New system prompt content:
    - Research-backed rules: "Ask for a date after ~7 messages, skip asking for phone number first (60% chance date never happens). Reference something specific from their messages. Keep messages short — dating app messages under 160 chars get 2x more responses."
    - Platform tone map:
      - Tinder: "Keep it playful and fun — Tinder conversations are lighter, humor works best"
      - Bumble: "Be slightly more direct and confident — Bumble users appreciate straightforwardness"
      - Hinge: "Keep it casual and warm — Hinge conversations tend to be more relaxed and genuine"
      - iMessage: "Match their energy — iMessage is personal, mirror their texting style closely"
    - Generate 3 replies with styles: witty (clever/humorous), warm (genuine/caring), direct (confident/straightforward)
    - Add `reasoning` field to each suggestion explaining why that reply works
    - Update the ReplySuggestion interface: `tone: 'witty' | 'warm' | 'direct'` and add `reasoning: string`
    - Accept optional `profile_context` parameter and include it in the user prompt if provided

    Update the function signature to accept `profileContext?: string` and thread it through.

    **2. Update `web/app/api/conversation/suggest/route.ts`:**

    Accept optional `profile_context` field in the POST body. Pass it through to `generateReplies()` as the new `profileContext` parameter.

    **3. Update `web/app/(main)/conversation/page.tsx`:**

    - Update the `Suggestion` interface: change `tone` to `'witty' | 'warm' | 'direct'`, add `reasoning: string`
    - Update `toneColors` map to use `witty` (blue), `warm` (amber/orange), `direct` (green) keys
    - Display the `reasoning` text below each suggestion in small muted text
    - The page already has platform selector (Tinder/Bumble/Hinge/iMessage), conversation textarea, match name input, generate button, copy buttons — keep all of that

    **4. Update `web/app/(main)/dashboard/page.tsx`:**

    The dashboard already has a "Conversation AI" link at line 203. Verify it links to `/conversation`. No change needed if it already does.
  </action>
  <verify>
    - `cd /opt/agency-workspace/clapcheeks.tech/web && npx tsc --noEmit` passes (no type errors)
    - `generate-replies.ts` contains "witty" and "warm" and "direct" (not "playful" or "flirty")
    - `generate-replies.ts` system prompt contains "7 messages" and "phone number" (research-backed rules)
    - `generate-replies.ts` system prompt contains platform tone guidance for Tinder/Bumble/Hinge/iMessage
    - `page.tsx` Suggestion interface has `reasoning: string`
    - `route.ts` accepts `profile_context` in POST body
  </verify>
  <done>
    Web API generates 3 reply suggestions with witty/warm/direct styles, includes research-backed dating strategy and per-platform tone guidance in the Claude prompt, and displays reasoning for each suggestion. Dashboard links to Conversation AI.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create Python agent reply module with Claude API + Ollama fallback</name>
  <files>
    agent/clapcheeks/ai/reply.py
    agent/clapcheeks/conversation/manager.py
  </files>
  <action>
    **1. Create `agent/clapcheeks/ai/reply.py`:**

    New module following the same pattern as `agent/clapcheeks/ai/date_ask.py` (Ollama first, API fallback).

    ```python
    def generate_reply(conversation_history: list[dict], platform: str, style: str = "casual") -> str:
    ```

    - Takes conversation_history as list of `{"role": "user"|"assistant", "content": "..."}` dicts
    - Takes platform name for tone guidance
    - System prompt includes same research-backed strategy as the web version:
      - Date ask after ~7 messages, skip phone number
      - Platform tone guidance (same map as date_ask.py `_PLATFORM_TONE`, extended with iMessage)
      - Never be creepy, desperate, or aggressive
      - Keep messages short (1-2 sentences max)
      - Reply with ONLY the message text
    - Attempt 1: Ollama (local) using `_call_llm` pattern from `date_ask.py`
    - Attempt 2: Claude API via `anthropic` package if `ANTHROPIC_API_KEY` is set
      - Use `claude-sonnet-4-6` model
      - This is different from opener.py which uses Kimi as fallback — for replies, prefer Claude
    - Attempt 3: Kimi API fallback (same as date_ask.py)
    - Attempt 4: Safe fallback string (e.g., "haha that's awesome")

    **2. Update `agent/clapcheeks/conversation/manager.py`:**

    - Add import: `from clapcheeks.ai.reply import generate_reply`
    - Add a new public method `generate_reply_for_conversation()` that:
      - Accepts `conversation_history: list[dict]` and `platform: str`
      - Calls `generate_reply(conversation_history, platform)`
      - Returns the string reply
    - In `suggest_reply()` method (line 80-106): add a fallback path — if the AI service URL call fails, try `generate_reply()` directly before returning None. This gives the manager a local fallback when the web API service is unreachable.
  </action>
  <verify>
    - `python -c "from clapcheeks.ai.reply import generate_reply; print('import ok')"` succeeds (run from project root with PYTHONPATH set)
    - `agent/clapcheeks/ai/reply.py` exists and contains `def generate_reply(`
    - `agent/clapcheeks/ai/reply.py` contains `claude-sonnet-4-6` and `ANTHROPIC_API_KEY`
    - `agent/clapcheeks/ai/reply.py` contains platform tone guidance for at least Tinder, Bumble, Hinge
    - `agent/clapcheeks/conversation/manager.py` imports from `clapcheeks.ai.reply`
    - `grep -c "generate_reply" agent/clapcheeks/conversation/manager.py` returns 2+ (import + usage)
  </verify>
  <done>
    Python agent has `generate_reply()` in `ai/reply.py` with Ollama-first, Claude API fallback, Kimi tertiary fallback. ConversationManager uses it as a local fallback when the web AI service is unreachable.
  </done>
</task>

<task type="auto">
  <name>Task 3: Atomic git commits</name>
  <files></files>
  <action>
    Create atomic commits for the changes:

    1. `feat(18-conversation-ai): update reply styles to witty/warm/direct with research-backed prompts` — for the web changes (generate-replies.ts, route.ts, page.tsx, dashboard page.tsx)
    2. `feat(18-conversation-ai): add Python reply module with Claude API + Ollama fallback` — for reply.py and manager.py changes

    Use conventional commit format. Include relevant file paths in commit body if helpful.
  </action>
  <verify>
    - `git log --oneline -2` shows both commits
    - `git status` is clean (no uncommitted changes)
  </verify>
  <done>
    All Phase 18 changes committed atomically.
  </done>
</task>

</tasks>

<verification>
- TypeScript compiles without errors: `cd web && npx tsc --noEmit`
- Python import works: `cd /opt/agency-workspace/clapcheeks.tech && PYTHONPATH=agent python -c "from clapcheeks.ai.reply import generate_reply"`
- Reply styles are witty/warm/direct (not playful/flirty): `grep -r "witty\|warm\|direct" web/lib/conversation-ai/generate-replies.ts`
- Research-backed strategy in prompts: `grep "7 messages\|phone number" web/lib/conversation-ai/generate-replies.ts`
- Platform tone guidance present: `grep -c "Tinder\|Bumble\|Hinge\|iMessage" web/lib/conversation-ai/generate-replies.ts` returns 4+
- Dashboard nav links to conversation: `grep "conversation" web/app/\(main\)/dashboard/page.tsx`
- Git log shows 2 atomic commits for phase 18
</verification>

<success_criteria>
- Conversation AI page shows 3 reply suggestions styled as witty/warm/direct with reasoning text
- Claude system prompt includes research-backed dating strategy (date ask after 7 msgs, skip phone number)
- Claude system prompt includes per-platform tone guidance (Tinder playful, Bumble direct, Hinge casual, iMessage mirror)
- Python `generate_reply()` exists with Ollama -> Claude -> Kimi -> fallback chain
- ConversationManager has local fallback to `generate_reply()` when web API unreachable
- Dashboard has "Conversation AI" nav link
- All changes committed atomically
</success_criteria>

<output>
After completion, create `.planning/milestone-4/phase-18-conversation-ai/18-01-SUMMARY.md`
</output>
