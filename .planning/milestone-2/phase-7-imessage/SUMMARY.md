---
phase: 07-imessage
plan: 01
subsystem: imessage-integration
tags: [imessage, ollama, sqlite, privacy, chat-watcher, voice-analysis]
dependency-graph:
  requires: [phase-06-install]
  provides: [imessage-reader, voice-analyzer, ai-reply-generator, message-watcher, watch-cli-command]
  affects: [phase-10-sync]
tech-stack:
  added: [ollama-python-sdk]
  patterns: [read-only-sqlite, polling-over-filesystem-watch, local-only-inference, style-caching]
key-files:
  created:
    - agent/outward/imessage/__init__.py
    - agent/outward/imessage/reader.py
    - agent/outward/imessage/voice.py
    - agent/outward/imessage/ai_reply.py
    - agent/outward/imessage/watcher.py
    - agent/outward/imessage/permissions.py
  modified:
    - agent/outward/cli.py
decisions:
  - id: d-07-01
    title: "Polling over watchdog for chat.db"
    choice: "5-second SQLite polling instead of filesystem watcher"
    reason: "SQLite WAL mode means chat.db-wal is modified, not chat.db — filesystem events are unreliable"
  - id: d-07-02
    title: "Style cache location"
    choice: "~/.clapcheeks/imessage_style.json with 24h TTL"
    reason: "Clapcheeks namespace per project convention, 24h cache avoids repeated analysis"
  - id: d-07-03
    title: "Stats logging without message content"
    choice: "JSONL at ~/.clapcheeks/imessage_stats.jsonl, action type only"
    reason: "Privacy-first: log suggested/picked/skipped/custom actions but never message text"
metrics:
  duration: "~3 minutes"
  completed: "2026-03-02"
---

# Phase 7 Plan 1: iMessage Integration Summary

**Local iMessage reader with AI reply suggestions via Ollama — zero data leaves the device.**

## What Was Built

### Task 1: iMessage Reader and Voice Analyzer (fbc8f13)

- **permissions.py**: Detects macOS Full Disk Access by attempting to open `~/Library/Messages/chat.db`. Prints Rich-formatted instructions if access is denied.
- **reader.py**: `IMMessageReader` class opens chat.db as read-only (`mode=ro` URI). Provides `get_conversations()`, `get_messages()`, `get_latest_message()` with parameterized SQL. Handles CoreData nanosecond timestamps. Supports context manager.
- **voice.py**: `VoiceAnalyzer` computes style profile from outgoing messages — avg length, emoji frequency, lowercase ratio, question ratio, common 2-3 word phrases, average response time. Generates a `tone_description` string and `get_style_prompt()` for the LLM. Caches to `~/.clapcheeks/imessage_style.json` (24h TTL).

### Task 2: AI Reply Generator, Watcher, and CLI (1771db8)

- **ai_reply.py**: `ReplyGenerator` calls local Ollama only (`ollama.chat()` on localhost:11434). Supports `suggest_reply()` with temperature control and `suggest_multiple()` for 3 varied options. Catches `ConnectionError` with helpful "start ollama serve" message.
- **watcher.py**: `IMMessageWatcher` polls chat.db every N seconds, detects new incoming messages, loads conversation context (15 messages), generates 3 reply suggestions via Rich UI. User picks 1-3 (copies to clipboard), (s) to skip, or (c) for custom. Stats logged to `~/.clapcheeks/imessage_stats.jsonl` with action type only — no message content.
- **cli.py**: Added `outward watch` command with `--contacts`, `--interval`, `--style-refresh` flags. Checks FDA first, analyzes style, shows tone panel, starts watcher.

## Privacy Guarantees

- SQLite connection is read-only (`mode=ro`) — cannot modify chat.db
- All AI inference via local Ollama (localhost:11434) — no network calls
- No `requests.post`, `requests.get`, or `urllib` in any imessage/ file
- Stats log records action type only (suggested/picked/skipped/custom), never message text
- Style analysis cached locally, never transmitted

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

- iMessage integration is complete and ready for use
- Phase 10 (sync) can integrate the anonymous stats from `~/.clapcheeks/imessage_stats.jsonl`
- The `outward watch` command is fully wired into the CLI
