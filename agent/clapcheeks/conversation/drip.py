"""Drip engine — rule-based follow-up + re-engagement scheduler.

Replaces the hardcoded reengagement thresholds with a YAML file users can
edit. Each rule is `{when: <trigger>, do: <action>, args: {...}}`. A rule
fires at most once per match per rule (tracked in the conversation state).

Triggers are tiny DSL expressions evaluated against a match's state:

    stage == "replying"
    hours_since_last_ours > 18
    hours_since_theirs > 48
    days_in_stage >= 5
    date_booked is False

Actions:

    send_ai_reply            — generate + send a fresh reply via the AI service
    send_reengagement        — use generate_reengagement (light bump)
    send_date_ask            — compose a date-ask with concrete slots
    send_template <name>     — send a named template from the same YAML
    advance_stage <stage>    — transition the match (uses set_stage, force optional)
    mark_dead                — stage -> DEAD (archive)

State written back per match after each rule firing:
    drip_fired[rule_id] = unix_ts
"""
from __future__ import annotations

import ast
import logging
import operator
import time
from pathlib import Path
from typing import Any, Callable

import yaml

from clapcheeks.conversation.state import (
    Stage,
    get_conversation,
    list_conversations,
    set_stage,
    update_conversation,
)

logger = logging.getLogger("clapcheeks.drip")

_RULES_FILE = Path.home() / ".clapcheeks" / "drip_rules.yaml"

DEFAULT_RULES_YAML = """\
# Clapcheeks drip rules — edit freely; each rule fires at most once per match.
#
# Triggers may reference:
#   stage                     (str, lifecycle stage)
#   message_count             (int)
#   days_in_stage             (float)
#   hours_since_theirs        (float — since their last reply; inf if they never replied)
#   hours_since_last_ours     (float — since we last sent)
#   hours_since_last_ts       (float — since any last message)
#   date_asked                (bool)
#   platform                  (str)
#
# Operators: == != < <= > >= and or not
# Access fields as bare identifiers (no quotes).

templates:
  soft_bump: "hey, how's your week going?"
  confirm_date: "still good for our plan? :)"
  final_attempt: "I know it's been a minute — was hoping to catch up, still around?"

rules:
  # Bump if they haven't replied in 2 days and we're mid-chat
  - id: followup_2d_silent
    when: stage == "replying" and hours_since_theirs > 48 and hours_since_theirs <= 120
    do: send_reengagement

  # Light bump if we sent an opener and got nothing in 3 days
  - id: opener_ghosted_3d
    when: stage == "opened" and hours_since_last_ours > 72 and hours_since_last_ours <= 168
    do: send_template
    args: { name: soft_bump }

  # Confirm a proposed date after 24h silence
  - id: confirm_proposed_date_24h
    when: stage == "date_proposed" and hours_since_theirs > 24
    do: send_template
    args: { name: confirm_date }

  # Final attempt on stale conversation at 7 days
  - id: final_attempt_7d
    when: stage in ("replying", "opened") and hours_since_theirs > 168 and hours_since_theirs <= 240
    do: send_template
    args: { name: final_attempt }

  # Archive after 10 days of silence
  - id: archive_10d_dead
    when: stage in ("replying", "opened", "date_proposed") and hours_since_last_ts > 240
    do: mark_dead
"""


# ---------------------------------------------------------------------------
# Rules file
# ---------------------------------------------------------------------------

def ensure_rules_file() -> Path:
    """Create the default rules file if the user doesn't have one yet."""
    if not _RULES_FILE.exists():
        _RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
        _RULES_FILE.write_text(DEFAULT_RULES_YAML)
        logger.info("Wrote default drip rules to %s", _RULES_FILE)
    return _RULES_FILE


def load_rules() -> dict:
    ensure_rules_file()
    try:
        return yaml.safe_load(_RULES_FILE.read_text()) or {}
    except Exception as exc:
        logger.error("Failed to parse %s: %s", _RULES_FILE, exc)
        return {}


# ---------------------------------------------------------------------------
# Safe trigger evaluator
# ---------------------------------------------------------------------------

_ALLOWED_BINOPS: dict[type, Callable[[Any, Any], Any]] = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne,
    ast.Lt: operator.lt, ast.LtE: operator.le,
    ast.Gt: operator.gt, ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
    ast.Is: operator.is_, ast.IsNot: operator.is_not,
}


def _eval_node(node: ast.AST, ctx: dict) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return ctx.get(node.id)
    if isinstance(node, ast.Tuple):
        return tuple(_eval_node(e, ctx) for e in node.elts)
    if isinstance(node, ast.List):
        return [_eval_node(e, ctx) for e in node.elts]
    if isinstance(node, ast.BoolOp):
        vals = [_eval_node(v, ctx) for v in node.values]
        if isinstance(node.op, ast.And):
            return all(vals)
        if isinstance(node.op, ast.Or):
            return any(vals)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return not _eval_node(node.operand, ctx)
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, ctx)
        for op, right_node in zip(node.ops, node.comparators):
            right = _eval_node(right_node, ctx)
            fn = _ALLOWED_BINOPS.get(type(op))
            if fn is None or not fn(left, right):
                return False
            left = right
        return True
    raise ValueError(f"Disallowed expression: {ast.dump(node)}")


def _eval_trigger(expr: str, ctx: dict) -> bool:
    try:
        tree = ast.parse(expr, mode="eval")
        return bool(_eval_node(tree.body, ctx))
    except Exception as exc:
        logger.warning("Bad trigger %r: %s", expr, exc)
        return False


# ---------------------------------------------------------------------------
# Context builder per conversation
# ---------------------------------------------------------------------------

_INF = float("inf")


def _conv_context(conv: dict) -> dict:
    now = time.time()
    last_ts = conv.get("last_ts") or 0
    stage_entered = conv.get("stage_entered_at") or 0
    last_sender = conv.get("last_sender") or ""

    # hours_since_last_ts: any message (us or them)
    hours_since_last_ts = (
        (now - last_ts) / 3600 if last_ts > 0 else _INF
    )
    # hours_since_theirs: only their replies count. If we don't know,
    # treat = hours_since_last_ts when they were last sender, else infinity.
    if last_sender == "them":
        hours_since_theirs = hours_since_last_ts
    elif last_sender == "us":
        hours_since_theirs = _INF
    else:
        hours_since_theirs = _INF

    # hours_since_last_ours: inverse
    if last_sender == "us":
        hours_since_last_ours = hours_since_last_ts
    elif last_sender == "them":
        hours_since_last_ours = _INF
    else:
        hours_since_last_ours = _INF

    days_in_stage = (
        (now - stage_entered) / 86400 if stage_entered > 0 else 0.0
    )

    return {
        "stage": conv.get("stage") or Stage.MATCHED.value,
        "message_count": conv.get("message_count") or 0,
        "days_in_stage": days_in_stage,
        "hours_since_theirs": hours_since_theirs,
        "hours_since_last_ours": hours_since_last_ours,
        "hours_since_last_ts": hours_since_last_ts,
        "date_asked": bool(conv.get("date_asked")),
        "platform": conv.get("platform") or "",
    }


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def _mark_fired(conv: dict, rule_id: str) -> None:
    fired = dict(conv.get("drip_fired") or {})
    fired[rule_id] = time.time()
    update_conversation(conv["match_id"], drip_fired=fired)


def _already_fired(conv: dict, rule_id: str) -> bool:
    return rule_id in (conv.get("drip_fired") or {})


def _send_via_client(
    conv: dict,
    message: str,
    platform_clients: dict,
    dry_run: bool = False,
    supabase=None,
) -> bool:
    platform = conv.get("platform") or ""
    match_id = conv.get("match_id")
    user_id  = conv.get("user_id") or ""
    # AI-8809: check the AI gate before hitting any platform sender.
    if supabase is not None and user_id and match_id:
        from clapcheeks.autonomy.gate import is_ai_active
        if not is_ai_active(supabase, user_id, match_id):
            return False  # ai_paused — stay silent
    client = platform_clients.get(platform)
    if not client:
        logger.debug("No platform client for %s; skipping send.", platform)
        return False
    if dry_run:
        logger.info("[dry-run drip] %s -> %s: %s", platform, match_id, message)
        return True
    try:
        ok = client.send_message(match_id, message)
        if ok:
            update_conversation(
                match_id,
                last_ts=time.time(),
                last_sender="us",
            )
        return ok
    except Exception as exc:
        logger.warning("drip send failed: %s", exc)
        return False


def _action_send_template(
    conv: dict,
    templates: dict,
    args: dict,
    platform_clients: dict,
    dry_run: bool,
) -> bool:
    name = (args or {}).get("name")
    if not name:
        logger.warning("send_template missing args.name")
        return False
    body = templates.get(name)
    if not body:
        logger.warning("Template %r not in rules file.", name)
        return False
    return _send_via_client(conv, body, platform_clients, dry_run)


def _action_send_reengagement(
    conv: dict,
    platform_clients: dict,
    dry_run: bool,
) -> bool:
    from clapcheeks.ai.date_ask import generate_reengagement

    days = max(1, int(conv.get("hours_since_last_ts_cached", 48) / 24)) if False else 2
    # Keep simple: let the AI figure it out from the match name
    name = conv.get("name") or "them"
    last = conv.get("last_ts") or 0
    if last > 0:
        days = max(1, int((time.time() - last) / 86400))
    else:
        days = 2
    msg = generate_reengagement(match_name=name, days_silent=days)
    return _send_via_client(conv, msg, platform_clients, dry_run)


def _action_send_date_ask(
    conv: dict,
    platform_clients: dict,
    dry_run: bool,
) -> bool:
    from clapcheeks.ai.date_ask import generate_date_ask

    try:
        from clapcheeks.calendar.slots import propose_slots_for_ai
        slot_ctx = propose_slots_for_ai(n=3)
    except Exception:
        slot_ctx = None

    name = conv.get("name") or "them"
    msg = generate_date_ask(
        match_name=name,
        platform=conv.get("platform") or "tinder",
        slot_context=slot_ctx,
    )
    sent = _send_via_client(conv, msg, platform_clients, dry_run)
    if sent and not dry_run:
        update_conversation(conv["match_id"], date_asked=True)
        try:
            set_stage(conv["match_id"], Stage.DATE_PROPOSED)
        except ValueError:
            pass
    return sent


def _action_advance_stage(conv: dict, args: dict, force: bool = False) -> bool:
    target = (args or {}).get("stage") or (args or {}).get("to")
    if not target:
        return False
    try:
        set_stage(conv["match_id"], target, force=force)
        return True
    except Exception as exc:
        logger.warning("advance_stage failed: %s", exc)
        return False


def _action_mark_dead(conv: dict) -> bool:
    try:
        set_stage(conv["match_id"], Stage.DEAD, force=True)
        return True
    except Exception as exc:
        logger.warning("mark_dead failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Tick — evaluate all rules for all conversations
# ---------------------------------------------------------------------------

def tick(
    platform_clients: dict | None = None,
    *,
    dry_run: bool = False,
) -> dict:
    """Evaluate every rule against every conversation once.

    Returns a stats dict: {fired, errors, skipped_dupe}.
    """
    rules_doc = load_rules()
    templates = rules_doc.get("templates") or {}
    rules = rules_doc.get("rules") or []
    platform_clients = platform_clients or {}

    stats = {"fired": 0, "errors": 0, "skipped_dupe": 0, "rules_evaluated": 0}

    for conv in list_conversations():
        ctx = _conv_context(conv)
        for rule in rules:
            stats["rules_evaluated"] += 1
            rid = rule.get("id")
            trig = rule.get("when")
            action = rule.get("do")
            args = rule.get("args") or {}
            if not (rid and trig and action):
                continue

            if _already_fired(conv, rid):
                stats["skipped_dupe"] += 1
                continue
            if not _eval_trigger(trig, ctx):
                continue

            ok = False
            try:
                if action == "send_template":
                    ok = _action_send_template(conv, templates, args, platform_clients, dry_run)
                elif action == "send_reengagement":
                    ok = _action_send_reengagement(conv, platform_clients, dry_run)
                elif action == "send_date_ask":
                    ok = _action_send_date_ask(conv, platform_clients, dry_run)
                elif action == "send_ai_reply":
                    # Delegated — the caller's ConversationManager does the
                    # full reply flow; the drip engine just records intent.
                    logger.info("drip requests AI reply for %s", conv.get("match_id"))
                    ok = True
                elif action == "advance_stage":
                    ok = _action_advance_stage(conv, args, force=bool(args.get("force")))
                elif action == "mark_dead":
                    ok = _action_mark_dead(conv)
                else:
                    logger.warning("Unknown drip action: %s", action)
            except Exception as exc:
                logger.exception("Drip rule %s blew up: %s", rid, exc)
                stats["errors"] += 1
                continue

            if ok:
                _mark_fired(conv, rid)
                stats["fired"] += 1

    return stats
