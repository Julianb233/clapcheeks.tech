#!/bin/bash
# AI-9606 — Block writes that put dating-engine data into Supabase.
# Convex is the single source of truth for matches/conversations/messages/
# outbound queue/agent_jobs/autonomy_config/people/photos/touches/drips/
# digest. Supabase auth is fine. clapcheeks_user_settings is the ONE
# permitted legacy table (until full settings migration ships).
#
# This hook runs on PreToolUse for Edit/Write. If the staged file content
# contains a forbidden pattern, exit 1 with a message that includes the
# offending lines so the agent can immediately self-correct.

# Parse Claude Code hook input (JSON on stdin per docs)
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only Edit/Write
case "$TOOL" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

# Only files in clapcheeks.tech repo
case "$FILE" in
  *clapcheeks.tech/*|*clapcheeks-local/*) ;;
  *) exit 0 ;;
esac

# Only TS/JS source
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs) ;;
  *) exit 0 ;;
esac

# Capture proposed content from the tool input
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')
[ -z "$NEW_CONTENT" ] && exit 0

# Forbidden patterns: supabase.from("clapcheeks_<engine table>")
FORBIDDEN='supabase[[:space:]]*\.[[:space:]]*from\([[:space:]]*["'\''`]clapcheeks_(matches|conversations|messages|outbound_scheduled_messages|outbound_queue|agent_jobs|autonomy_config|people|photos|touches|drips|digest|scheduled_messages|queued_replies|messages_inbound|message_threads|spending|conversation_stats|coaching_sessions|telemetry)['\''`"]'

if echo "$NEW_CONTENT" | grep -qE "$FORBIDDEN"; then
  echo "BLOCKED: Clapcheeks dating-engine data must use Convex, not Supabase." >&2
  echo "" >&2
  echo "Offending pattern in proposed edit to: $FILE" >&2
  echo "$NEW_CONTENT" | grep -nE "$FORBIDDEN" | head -5 | sed 's/^/  /' >&2
  echo "" >&2
  echo "Use Convex instead:" >&2
  echo "  - Server route: import { ConvexHttpClient } + api.<module>.<fn>" >&2
  echo "  - Client component: useQuery(api.<module>.<fn>, { user_id: getFleetUserId() })" >&2
  echo "  - user_id namespace = 'fleet-julian' (always, via getFleetUserId())" >&2
  echo "" >&2
  echo "See clapcheeks.tech/CLAUDE.md § CRITICAL DATA RULE for the full table mapping." >&2
  echo "Allowed legacy table: clapcheeks_user_settings (auth-Supabase reads only)." >&2
  exit 1
fi

exit 0
