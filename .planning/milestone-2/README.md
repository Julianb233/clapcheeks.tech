# Milestone 2: Local Agent (v0.2)

The downloadable CLI that runs on each user's Mac.

## Goal

Build and distribute the Outward local agent — a Python CLI that users install with a single `curl` command. The agent runs entirely on the user's machine, reading iMessage conversations, tracking dating activity, and syncing only anonymized metrics to the cloud.

## Phases

| Phase | Name | Description |
|-------|------|-------------|
| 6 | Install script | One-command setup: `curl -fsSL https://clapcheeks.tech/install.sh \| bash` |
| 7 | iMessage integration | Read conversations, compose AI replies in the user's voice |
| 8 | Dating profile manager | Store user preferences, target preferences, and dealbreakers locally |
| 9 | Spending tracker | Log date costs, categorize spending, calculate ROI over time |
| 10 | Cloud sync | Push anonymized metrics to the Outward API on the user's behalf |

## Key Constraints

- All personal data (messages, matches, names) stays on device — never leaves the Mac
- Only aggregate metrics sync to the cloud (swipe counts, conversion rates, totals)
- Agent must be lightweight and run reliably in the background
- Install must work on macOS 12+ with no prerequisites beyond curl

## Dependencies

Milestone 1 (Foundation) must be complete before beginning Milestone 2.
