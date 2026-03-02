---
phase: 07-imessage
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/outward/imessage/__init__.py
  - agent/outward/imessage/reader.py
  - agent/outward/imessage/voice.py
  - agent/outward/imessage/ai_reply.py
  - agent/outward/imessage/watcher.py
  - agent/outward/imessage/permissions.py
  - agent/outward/cli.py
  - agent/requirements.txt
autonomous: true

must_haves:
  truths:
    - "User can read their iMessage conversations from chat.db"
    - "User can see AI-generated reply suggestions in their own texting style"
    - "Watcher detects new incoming messages and triggers suggestions automatically"
    - "No message content ever leaves the device"
    - "User reviews and approves every reply before it is sent"
    - "CLI command 'outward watch' starts the iMessage watcher"
  artifacts:
    - path: "agent/outward/imessage/reader.py"
      provides: "SQLite chat.db parser for iMessage conversations"
    - path: "agent/outward/imessage/voice.py"
      provides: "User texting style analyzer"
    - path: "agent/outward/imessage/ai_reply.py"
      provides: "Local Ollama reply generator"
    - path: "agent/outward/imessage/watcher.py"
      provides: "File watcher for new messages"
    - path: "agent/outward/imessage/permissions.py"
      provides: "macOS Full Disk Access check"
  key_links:
    - from: "agent/outward/imessage/watcher.py"
      to: "agent/outward/imessage/reader.py"
      via: "polls chat.db for new messages"
    - from: "agent/outward/imessage/ai_reply.py"
      to: "agent/outward/imessage/voice.py"
      via: "uses style profile to prompt Ollama"
    - from: "agent/outward/cli.py"
      to: "agent/outward/imessage/watcher.py"
      via: "outward watch command starts watcher loop"
---

<objective>
Build iMessage integration for the Outward local agent. Read conversations from
the macOS iMessage SQLite database, analyze the user's texting style, and generate
AI reply suggestions using local Ollama -- all without any message data leaving
the device.

Purpose: This is the core differentiator of the product -- an AI dating co-pilot
that works through iMessage while maintaining total privacy.

Output: Six new files in agent/outward/imessage/, updated CLI with `outward watch`
command, updated requirements.txt.
</objective>

<context>
@.planning/ROADMAP.md (Phase 7 definition)
@agent/outward/cli.py (existing CLI -- add `watch` command here)
@agent/outward/config.py (config loading -- reuse CONFIG_DIR, ai_model, ai_provider)
@agent/outward/conversation/manager.py (existing conversation patterns -- similar suggest_reply flow)
@agent/requirements.txt (add watchdog dependency here)
</context>

<tasks>

<task type="auto">
  <name>Task 1: iMessage reader and voice analyzer</name>
  <files>
    agent/outward/imessage/__init__.py
    agent/outward/imessage/reader.py
    agent/outward/imessage/voice.py
    agent/outward/imessage/permissions.py
  </files>
  <action>
Create the `agent/outward/imessage/` package with four files:

**__init__.py** — Empty init, just makes it a package.

**permissions.py** — macOS Full Disk Access checker:
- Function `check_full_disk_access() -> bool` that tries to open
  `~/Library/Messages/chat.db` in read-only mode. If it succeeds, FDA is granted.
  If PermissionError or similar, FDA is not granted.
- Function `prompt_fda_instructions()` that prints Rich-formatted instructions:
  "System Settings > Privacy & Security > Full Disk Access > toggle ON for Terminal
  (or iTerm2 / VS Code / whatever terminal app they use)". Include the exact
  macOS Settings path. Tell user to restart their terminal after granting.
- Do NOT attempt to programmatically grant FDA. Just detect and instruct.

**reader.py** — iMessage chat.db reader:
- `CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"`
- Class `IMMessageReader` with these methods:
  - `__init__(self, db_path=CHAT_DB)` — opens sqlite3 read-only connection
    using `f"file:{db_path}?mode=ro"` URI and `uri=True` flag. This ensures
    we never accidentally write to chat.db.
  - `get_conversations(self, limit=50) -> list[dict]` — query chat table joined
    with chat_handle_join and handle table. Return list of dicts with keys:
    `chat_id` (int), `display_name` (str from chat.display_name or handle.id),
    `handle_id` (str, phone/email), `last_message_date` (datetime).
    Sort by most recent message. The iMessage date column stores CoreData
    timestamps (nanoseconds since 2001-01-01). Convert with:
    `datetime(2001,1,1) + timedelta(seconds=date/1e9)`.
  - `get_messages(self, chat_id: int, limit=100) -> list[dict]` — query message
    table joined with chat_message_join. Return list of dicts with keys:
    `text` (str), `is_from_me` (bool), `date` (datetime), `handle_id` (str).
    Sort chronologically (oldest first).
  - `get_latest_message(self, chat_id: int) -> dict | None` — return the single
    most recent message for a chat. Used by watcher to detect new arrivals.
  - `close(self)` — close the sqlite connection.
  - Support context manager protocol (`__enter__`, `__exit__`).
- All queries use parameterized SQL (no f-strings in queries).
- Key SQL joins for reference:
  ```
  chat -> chat_message_join (chat_id) -> message (ROWID)
  chat -> chat_handle_join (chat_id) -> handle (ROWID)
  message -> handle (handle_id)
  ```

**voice.py** — User texting style analyzer:
- Class `VoiceAnalyzer` with:
  - `__init__(self, reader: IMMessageReader)` — takes a reader instance.
  - `analyze_style(self, chat_ids: list[int] | None = None, sample_size=200) -> dict` —
    Analyzes the user's outgoing messages (is_from_me=1) across specified chats
    (or all chats if None). Returns a style profile dict with:
    - `avg_length`: average message length in characters
    - `emoji_frequency`: ratio of messages containing emoji (use regex `[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]`)
    - `lowercase_ratio`: ratio of messages that are all-lowercase
    - `question_ratio`: ratio of messages ending with ?
    - `common_phrases`: top 10 most-used 2-3 word phrases (Counter on split text)
    - `avg_response_time_minutes`: average time between their message and user's reply
    - `tone_description`: a one-sentence summary string built from the metrics,
      e.g. "Short, casual messages (avg 34 chars), heavy emoji use (45%), mostly
      lowercase, rarely asks questions"
  - `get_style_prompt(self, style: dict | None = None) -> str` — converts the
    style profile into a prompt instruction string for the LLM, e.g.:
    "Write in the user's style: short messages averaging 34 characters, use emoji
    frequently, keep everything lowercase, match their phrases like 'for sure',
    'nah lol', 'bet'"
  - Save computed style to `~/.outward/imessage_style.json` for caching.
    Load from cache if less than 24 hours old (check file mtime).

Add `watchdog>=4.0` to agent/requirements.txt (will be used in Task 2).
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from outward.imessage.reader import IMMessageReader; from outward.imessage.voice import VoiceAnalyzer; from outward.imessage.permissions import check_full_disk_access; print('imports OK')"`

Verify all three modules import without error. The actual chat.db read will fail
on non-macOS (expected) but the classes must be importable.
  </verify>
  <done>
    - IMMessageReader can open chat.db read-only and query conversations/messages
    - VoiceAnalyzer produces a style profile dict from outgoing messages
    - permissions.py detects Full Disk Access status and prints instructions
    - watchdog added to requirements.txt
  </done>
</task>

<task type="auto">
  <name>Task 2: AI reply generator, file watcher, and CLI integration</name>
  <files>
    agent/outward/imessage/ai_reply.py
    agent/outward/imessage/watcher.py
    agent/outward/cli.py
  </files>
  <action>
**ai_reply.py** — Local Ollama reply generator:
- Class `ReplyGenerator` with:
  - `__init__(self, model="llama3.2", style_prompt="")` — store model name and
    style prompt string. Read model from config via `outward.config.load()` key
    `ai_model` (default "llama3.2").
  - `suggest_reply(self, conversation: list[dict], contact_name: str = "") -> str` —
    Call Ollama Python SDK (`import ollama`) with `ollama.chat()`. Build messages:
    1. System prompt: "You are a dating conversation assistant. Generate a reply
       that the user would send. {self.style_prompt}. Reply with ONLY the message
       text, no quotes, no explanation. Keep it natural and conversational.
       The user is texting {contact_name}."
    2. Convert conversation history (last 10 messages) into alternating
       user/assistant messages where is_from_me=True maps to "assistant" role
       and is_from_me=False maps to "user" role.
    3. Return the response content string, stripped.
  - `suggest_multiple(self, conversation, contact_name="", count=3) -> list[str]` —
    Generate `count` different reply options by calling suggest_reply multiple
    times with temperature variation (add a `temperature` param to the ollama.chat
    call: 0.7, 0.9, 1.1 for 3 options).
  - All inference is local via Ollama. No network calls. If ollama.chat() raises
    ConnectionError, catch it and return a helpful error message:
    "Ollama not running. Start it with: ollama serve"
  - NEVER send message content to any remote API. The ollama import talks to
    localhost:11434 only.

**watcher.py** — File watcher for new iMessage arrivals:
- Class `IMMessageWatcher` with:
  - `__init__(self, reader: IMMessageReader, reply_gen: ReplyGenerator, contacts: list[str] | None = None)` —
    `contacts` is an optional allowlist of handle_ids (phone numbers/emails) to
    watch. If None, watch all conversations.
  - `_snapshot(self) -> dict[int, dict]` — for each watched conversation, record
    the latest message ROWID or date. Returns {chat_id: {rowid, date, handle_id}}.
  - `start(self, poll_interval=5.0)` — main loop:
    1. Take initial snapshot.
    2. Every `poll_interval` seconds, re-query latest messages.
    3. For each chat where latest message changed AND is_from_me=False (incoming):
       - Load last 15 messages for context
       - Call reply_gen.suggest_multiple() to get 3 options
       - Display to user via Rich: show contact name, their message, then numbered
         reply options (1, 2, 3) plus option (s) to skip and (c) for custom reply
       - Wait for user input (input() call)
       - If user picks 1-3: print "Reply copied to clipboard" (use
         `subprocess.run(["pbcopy"], input=reply.encode(), check=True)` on macOS)
       - If user picks 's': skip, log as skipped
       - If user picks 'c': prompt for custom text, copy to clipboard
       - Log the suggestion event (not content) to ~/.outward/imessage_stats.jsonl:
         `{"ts": iso_timestamp, "chat_id": chat_id, "action": "suggested|picked|skipped|custom", "contact": contact_name}`
         Note: NO message content in the log. Only the action type.
    4. Use a try/except KeyboardInterrupt to handle Ctrl+C gracefully.
  - Do NOT use watchdog for this (chat.db is an SQLite WAL file, filesystem events
    are unreliable for it). Use simple polling instead. Remove watchdog from
    requirements.txt since we are not using it.
  - Why polling over watchdog: SQLite WAL mode means chat.db-wal gets modified,
    not chat.db itself. Filesystem watchers trigger inconsistently. A 5-second
    poll on a read-only SELECT is negligible overhead.

**cli.py** — Add `outward watch` command:
- Add a new `@main.command()` called `watch` with these options:
  - `--contacts` (str, optional): comma-separated phone numbers/emails to watch.
    If omitted, watch all conversations.
  - `--interval` (float, default=5.0): polling interval in seconds.
  - `--style-refresh` (flag): force re-analyze texting style (ignore cache).
- Implementation:
  1. Check `permissions.check_full_disk_access()`. If False, call
     `prompt_fda_instructions()` and exit with code 1.
  2. Create IMMessageReader.
  3. Create VoiceAnalyzer, call analyze_style(). Print a Rich panel showing
     the tone_description so user sees how the AI perceives their style.
  4. Get style_prompt from analyzer.
  5. Create ReplyGenerator with style_prompt.
  6. Parse --contacts into list if provided.
  7. Create IMMessageWatcher and call start().
  8. Wrap in try/except for KeyboardInterrupt to print clean exit message.
- Add Rich output: "Watching N conversations for new messages... (Ctrl+C to stop)"
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from outward.imessage.ai_reply import ReplyGenerator; from outward.imessage.watcher import IMMessageWatcher; print('imports OK')"`

Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from outward.cli import main; print('CLI OK')"`

Verify the `watch` command is registered: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -m outward.cli watch --help` should show help text with --contacts, --interval, --style-refresh options.
  </verify>
  <done>
    - ReplyGenerator calls local Ollama only, never sends content to remote APIs
    - IMMessageWatcher polls chat.db, detects new incoming messages, shows reply options
    - User selects a reply option interactively (1/2/3/s/c), selected reply copied to clipboard
    - Stats logged to ~/.outward/imessage_stats.jsonl with NO message content
    - `outward watch` command works with --contacts, --interval, --style-refresh flags
    - Full Disk Access check runs before anything touches chat.db
  </done>
</task>

</tasks>

<verification>
1. All imports succeed: `python -c "from outward.imessage import reader, voice, ai_reply, watcher, permissions"`
2. CLI shows watch command: `outward watch --help` outputs usage with all three flags
3. No remote API calls in any imessage/ file (grep for "requests.post", "requests.get",
   "urllib" -- should find NONE in imessage/ directory)
4. Stats log contains no message text: `grep -v '"action"' ~/.outward/imessage_stats.jsonl`
   should return nothing (every line has action field, no text/content field)
5. reader.py uses read-only SQLite connection (grep for `mode=ro`)
</verification>

<success_criteria>
- `outward watch` starts, checks FDA, analyzes style, begins polling chat.db
- New incoming iMessage triggers 3 AI reply suggestions via local Ollama
- User picks a reply and it is copied to clipboard
- Zero message content transmitted to any remote service
- Style analysis cached to ~/.outward/imessage_style.json
- Anonymous stats (action type only) logged to ~/.outward/imessage_stats.jsonl
</success_criteria>

<output>
After completion, create `.planning/milestone-2/phase-7-imessage/SUMMARY.md`
</output>
