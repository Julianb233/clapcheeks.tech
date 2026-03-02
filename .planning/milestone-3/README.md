# Milestone 3: Dating App Automation (v0.3)

Browser automation for Tinder, Bumble, and Hinge using local Playwright.

## Goal

Give Outward the ability to automatically swipe, match, and open conversations on dating apps — all running locally via Playwright on the user's Mac. No cloud session data, no remote browsers. The user's dating app sessions run on their own machine.

## Phases

| Phase | Name | Description |
|-------|------|-------------|
| 11 | Playwright setup | Local browser automation framework with anti-detection measures |
| 12 | Tinder automation | Login, swipe logic, match detection, AI-generated opener messages |
| 13 | Bumble automation | Swipe, first-move message generation, conversation starters |
| 14 | Hinge automation | Like/comment on prompts, manage conversation flow |
| 15 | Automation controller | Unified interface, rate limiting, human-like delays, session management |

## Key Constraints

- All browser automation runs locally on the user's Mac — no remote browsers
- Anti-detection measures to avoid platform bans (delays, human-like patterns)
- Rate limits per app to stay within safe usage thresholds
- Users must authenticate manually on first run; automation maintains the session

## Dependencies

Milestone 2 (Local Agent) must be complete before beginning Milestone 3.
