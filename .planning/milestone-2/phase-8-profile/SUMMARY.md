---
phase: 08-profile
plan: 01
subsystem: agent-cli
tags: [profile, dataclass, json, rich, click, cli]
dependency-graph:
  requires: []
  provides: [profile-dataclass, profile-persistence, profile-cli-commands]
  affects: [swiping-logic, messaging-ai, ai-preferences]
tech-stack:
  added: []
  patterns: [dataclass-json-persistence, click-command-groups, rich-interactive-prompts]
key-files:
  created:
    - agent/outward/profile.py
    - agent/outward/commands/__init__.py
    - agent/outward/commands/profile.py
    - agent/tests/__init__.py
    - agent/tests/test_profile.py
  modified:
    - agent/outward/cli.py
decisions:
  - id: d-08-01
    title: "Dataclass with asdict for JSON serialization"
    rationale: "Simple, stdlib-only approach — no ORM or schema library needed for flat profile data"
  - id: d-08-02
    title: "Rich Prompt/IntPrompt for wizard instead of questionary"
    rationale: "Rich already in use across CLI; avoids mixing two prompt libraries"
metrics:
  duration: ~3 minutes
  completed: 2026-03-01
---

# Phase 8 Plan 1: Dating Profile Manager Summary

**Profile dataclass with JSON persistence at ~/.clapcheeks/profile.json, interactive setup wizard, show/edit CLI commands using rich UI**

## What Was Built

### Profile Dataclass (`agent/outward/profile.py`)
- `Profile` dataclass with 13 fields: personal info (name, age, location, bio), relationship type, attraction preferences (age range, distance, traits), dealbreakers, conversation style, and topics to avoid
- `load_profile()` — reads from `~/.clapcheeks/profile.json`, returns defaults on missing/corrupt file
- `save_profile()` — writes JSON with `indent=2`, auto-sets `updated_at` ISO timestamp
- `profile_exists()` — validates file exists and contains parseable JSON

### CLI Commands (`agent/outward/commands/profile.py`)
- `outward profile setup` — four-section interactive wizard (About You, Attraction Preferences, Dealbreakers, Conversation Style) with rich panels, typed prompts, and summary table before save confirmation
- `outward profile show` — renders saved profile in a rich Panel with sections
- `outward profile edit <field> <value>` — updates a single field with proper type coercion (int for age fields, comma-split for list fields)
- Overwrite protection: warns if profile exists before setup

### Tests (`agent/tests/test_profile.py`)
- 6 unit tests: roundtrip save/load, defaults on missing file, defaults on corrupt JSON, updated_at timestamp, profile_exists false/true

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `8ede787` | Profile dataclass and JSON persistence |
| 2 | `7e871cd` | CLI commands and interactive wizard |
| 2b | `be52dc8` | Wire profile command group into main CLI |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- All 6 pytest tests pass
- `outward profile --help` shows setup, show, edit subcommands
- Profile group registered in main CLI command list
- Profile data stored at `~/.clapcheeks/profile.json` (local only, never synced)
