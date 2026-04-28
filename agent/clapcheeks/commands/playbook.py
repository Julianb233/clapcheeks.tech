"""Playbook CLI — AI-8815.

Print re-engagement guidance for a ghosted contact without needing
the Clapcheeks platform.

Usage:
    clapcheeks playbook --domain dating --ghost-date 2026-04-01
    clapcheeks playbook --domain sales --ghost-date 2026-03-01 --context "post-demo, mentioned ROI concerns"
    clapcheeks playbook --domain networking --attempts 1 --last-attempt-date 2026-03-15
    clapcheeks playbook --list-domains
    clapcheeks playbook --show-banned --domain sales

Reads guidance from docs/playbooks/reactivation-campaign.md and
docs/playbooks/banned-phrases.json.

Full methodology: docs/playbooks/reactivation-campaign.md
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
from typing import Optional


# ---------------------------------------------------------------------------
# Paths (relative to the repo root)
# ---------------------------------------------------------------------------

_REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_BANNED_PHRASES_PATH = os.path.join(
    _REPO_ROOT, "docs", "playbooks", "banned-phrases.json"
)
_PLAYBOOK_PATH = os.path.join(
    _REPO_ROOT, "docs", "playbooks", "reactivation-campaign.md"
)


# ---------------------------------------------------------------------------
# Timing constants (mirrors DEFAULT_CADENCE in drip.py)
# ---------------------------------------------------------------------------

FIRST_ATTEMPT_DAYS = 14
FOLLOWUP_DAYS = 45
MAX_ATTEMPTS = 2


# ---------------------------------------------------------------------------
# Domain config
# ---------------------------------------------------------------------------

DOMAINS = {
    "dating": {
        "label": "Dating",
        "stages": ["opener", "conversing", "date_proposed"],
        "context_prompt": "What stage did the conversation reach before going quiet?",
    },
    "sales": {
        "label": "Sales",
        "stages": ["discovery", "demo", "proposal"],
        "context_prompt": "What was the last touchpoint? (e.g. discovery call, demo, proposal sent)",
    },
    "networking": {
        "label": "Networking",
        "stages": ["met", "connected", "first_meeting"],
        "context_prompt": "How did you meet and what did you discuss?",
    },
    "friendship": {
        "label": "Friendship",
        "stages": ["casual", "close", "lost_touch"],
        "context_prompt": "What do you remember about your last real conversation?",
    },
    "lapsed_client": {
        "label": "Lapsed Client",
        "stages": ["churned", "proposal_ignored", "paused"],
        "context_prompt": "Why did they churn or go quiet? (e.g. pricing, timing, competitor)",
    },
}


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def _parse_date(date_str: str) -> date:
    """Parse YYYY-MM-DD string. Raises ValueError on bad input."""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"Date must be in YYYY-MM-DD format, got: {date_str!r}")


def _days_since(d: date) -> int:
    return (date.today() - d).days


def _load_banned_phrases(domain: Optional[str] = None) -> list[dict]:
    """Load banned phrases from JSON, optionally filtered by domain."""
    if not os.path.exists(_BANNED_PHRASES_PATH):
        return []
    with open(_BANNED_PHRASES_PATH) as f:
        data = json.load(f)
    phrases = data.get("banned_phrases", [])
    if domain:
        phrases = [p for p in phrases if domain in p.get("domains", [])]
    return phrases


def _recommend_next_action(
    ghost_date: date,
    attempts: int,
    last_attempt_date: Optional[date],
) -> dict:
    """Return the recommended action and target date."""
    today = date.today()
    days_ghosted = _days_since(ghost_date)

    if attempts >= MAX_ATTEMPTS:
        return {
            "action": "STOP",
            "reason": f"You've made {attempts} attempts (max: {MAX_ATTEMPTS}). Mark this contact burned.",
            "target_date": None,
        }

    if attempts == 0:
        target = ghost_date + timedelta(days=FIRST_ATTEMPT_DAYS)
        if today >= target:
            return {
                "action": "SEND_NOW",
                "reason": f"Day {days_ghosted} since ghost. Attempt 1 is due.",
                "target_date": today,
            }
        days_left = (target - today).days
        return {
            "action": "WAIT",
            "reason": f"Wait {days_left} more day(s) before attempt 1 (target: {target}).",
            "target_date": target,
        }

    # attempts == 1
    if last_attempt_date is None:
        return {
            "action": "WAIT",
            "reason": "You made 1 attempt but didn't record the date. Set --last-attempt-date.",
            "target_date": None,
        }

    target = last_attempt_date + timedelta(days=FOLLOWUP_DAYS)
    if today >= target:
        return {
            "action": "SEND_NOW",
            "reason": f"Day {_days_since(last_attempt_date)} since attempt 1. Attempt 2 is due.",
            "target_date": today,
        }
    days_left = (target - today).days
    return {
        "action": "WAIT",
        "reason": f"Wait {days_left} more day(s) before attempt 2 (target: {target}).",
        "target_date": target,
    }


def _build_output(
    domain: str,
    ghost_date: date,
    attempts: int,
    last_attempt_date: Optional[date],
    context: Optional[str],
) -> str:
    """Build the full CLI output string."""
    domain_cfg = DOMAINS.get(domain, {})
    domain_label = domain_cfg.get("label", domain.title())
    rec = _recommend_next_action(ghost_date, attempts, last_attempt_date)

    lines = [
        "",
        f"  REACTIVATION PLAYBOOK — {domain_label.upper()}",
        f"  Methodology: docs/playbooks/reactivation-campaign.md",
        "",
        "  SITUATION",
        f"  Domain:         {domain_label}",
        f"  Ghost date:     {ghost_date} ({_days_since(ghost_date)} days ago)",
        f"  Attempts made:  {attempts} / {MAX_ATTEMPTS}",
    ]

    if last_attempt_date:
        lines.append(f"  Last attempt:   {last_attempt_date} ({_days_since(last_attempt_date)} days ago)")
    if context:
        lines.append(f"  Context:        {context}")

    lines += [
        "",
        "  RECOMMENDATION",
        f"  Action:   {rec['action']}",
        f"  Why:      {rec['reason']}",
    ]

    if rec["target_date"]:
        lines.append(f"  Date:     {rec['target_date']}")

    if rec["action"] in ("SEND_NOW",):
        lines += [
            "",
            "  WHAT TO SAY",
            "  ---------------",
            "  - Under 15 words",
            "  - Reference something specific about them or your last conversation",
            "  - Do NOT acknowledge the gap",
            "  - Do NOT apologize for the silence",
            "  - Treat it like you randomly thought of them",
            "",
            "  FORMULA:",
            "  [Specific reference] + [Something new or light signal] + [Optional: soft invite]",
            "",
            "  See Part 1 of the playbook for 12 example messages across all domains.",
        ]

        if context:
            lines += [
                "",
                "  CONTEXT-SPECIFIC TIPS (based on what you provided):",
                f"  You mentioned: \"{context}\"",
                "  Use that as your anchor. Reference it specifically, not generically.",
            ]

    if rec["action"] == "STOP":
        lines += [
            "",
            "  You've made the maximum number of attempts. Walk away cleanly.",
            "  Optional farewell message (sends no expectation of reply):",
            "  \"going to leave this one here — if the timing ever changes, you know where to find me.\"",
        ]

    lines += [
        "",
        "  BANNED PHRASES (never use these in this domain):",
        "  Run: clapcheeks playbook --show-banned --domain " + domain,
        "",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="clapcheeks playbook",
        description=(
            "Print re-engagement guidance for a ghosted contact. "
            "Full methodology: docs/playbooks/reactivation-campaign.md"
        ),
    )
    parser.add_argument(
        "--domain",
        choices=list(DOMAINS.keys()),
        default="dating",
        help="Context domain (default: dating)",
    )
    parser.add_argument(
        "--ghost-date",
        metavar="YYYY-MM-DD",
        help="Date the contact went quiet",
    )
    parser.add_argument(
        "--attempts",
        type=int,
        default=0,
        help="Number of reactivation attempts already made (default: 0)",
    )
    parser.add_argument(
        "--last-attempt-date",
        metavar="YYYY-MM-DD",
        help="Date of the most recent reactivation attempt (required if --attempts > 0)",
    )
    parser.add_argument(
        "--context",
        metavar="TEXT",
        help="Free-text context about the relationship / last interaction",
    )
    parser.add_argument(
        "--list-domains",
        action="store_true",
        help="List all available domains and exit",
    )
    parser.add_argument(
        "--show-banned",
        action="store_true",
        help="Show banned phrases for the domain and exit",
    )

    args = parser.parse_args(argv)

    if args.list_domains:
        print("\nAvailable domains:\n")
        for key, cfg in DOMAINS.items():
            print(f"  {key:<20} {cfg['label']}")
            print(f"  {'':<20} Context tip: {cfg['context_prompt']}")
            print()
        return 0

    if args.show_banned:
        phrases = _load_banned_phrases(args.domain)
        if not phrases:
            print(f"\nNo banned phrases found for domain '{args.domain}'.")
            print(f"Check: {_BANNED_PHRASES_PATH}")
            return 1
        print(f"\nBanned phrases for domain: {args.domain}\n")
        criticals = [p for p in phrases if p["severity"] == "critical"]
        highs = [p for p in phrases if p["severity"] == "high"]
        print("  CRITICAL (never use):")
        for p in criticals:
            print(f"    - \"{p['phrase']}\"")
            print(f"      Why: {p['rationale']}")
            print(f"      Instead: {p['replacement_pattern']}")
            print()
        if highs:
            print("  HIGH SEVERITY (strongly avoid):")
            for p in highs:
                print(f"    - \"{p['phrase']}\"")
                print(f"      Why: {p['rationale']}")
                print()
        return 0

    if not args.ghost_date:
        print("Error: --ghost-date is required. Use YYYY-MM-DD format.")
        parser.print_help()
        return 1

    try:
        ghost_date = _parse_date(args.ghost_date)
    except ValueError as e:
        print(f"Error: {e}")
        return 1

    last_attempt_date = None
    if args.last_attempt_date:
        try:
            last_attempt_date = _parse_date(args.last_attempt_date)
        except ValueError as e:
            print(f"Error: {e}")
            return 1

    if args.attempts > 0 and last_attempt_date is None:
        print("Warning: --attempts > 0 but --last-attempt-date not set. Timing for attempt 2 will be approximate.")

    output = _build_output(
        domain=args.domain,
        ghost_date=ghost_date,
        attempts=args.attempts,
        last_attempt_date=last_attempt_date,
        context=args.context,
    )
    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
