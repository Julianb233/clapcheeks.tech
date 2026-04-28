#!/usr/bin/env python3
"""AI-8766 — One-shot backfill: encrypt every plaintext platform token.

For each row in ``clapcheeks_user_settings`` that has a non-null plaintext
value in any of (``tinder_auth_token``, ``hinge_auth_token``,
``instagram_auth_token``, ``bumble_session``) but a NULL value in the
corresponding ``*_enc`` column, encrypts the plaintext and writes the
ciphertext to ``*_enc``.

Idempotent — rows where ``*_enc`` is already populated are skipped.

Usage::

    SUPABASE_URL=https://...supabase.co \\
    SUPABASE_SERVICE_KEY=eyJ... \\
    CLAPCHEEKS_TOKEN_MASTER_KEY=$(openssl rand -base64 32) \\
        python3 scripts/backfill_encrypt_tokens.py [--dry-run] [--clear-plaintext]

Flags:
    --dry-run         : Don't write anything; just print what would change.
    --clear-plaintext : After writing the encrypted column, NULL out the
                        plaintext column. ONLY pass this once every reader
                        has been confirmed to use the encrypted column.

Run after the migration ``20260427193300_encrypt_platform_tokens.sql`` has
been applied. Re-run safely after any new row appears in plaintext (e.g.
during the cutover window).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Allow running this script from anywhere by adding agent/ to sys.path.
REPO_ROOT = Path(__file__).resolve().parent.parent
AGENT_DIR = REPO_ROOT / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

PLATFORMS = (
    # (plaintext column, encrypted column)
    ("tinder_auth_token", "tinder_auth_token_enc"),
    ("hinge_auth_token", "hinge_auth_token_enc"),
    ("instagram_auth_token", "instagram_auth_token_enc"),
    ("bumble_session", "bumble_session_enc"),
)


def _load_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not url or not key:
        raise SystemExit(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the environment"
        )
    try:
        from supabase import create_client
    except ImportError as exc:
        raise SystemExit(f"supabase-py not installed: {exc}")
    return create_client(url, key)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would change but don't write to Supabase.",
    )
    parser.add_argument(
        "--clear-plaintext", action="store_true",
        help="After writing ciphertext, NULL out the plaintext column.",
    )
    args = parser.parse_args()

    if not os.environ.get("CLAPCHEEKS_TOKEN_MASTER_KEY"):
        raise SystemExit(
            "CLAPCHEEKS_TOKEN_MASTER_KEY not set. Generate with: "
            "openssl rand -base64 32"
        )

    # Import after env check so the helpful error fires first.
    from clapcheeks.auth.token_vault import encrypt_token

    client = _load_supabase()

    select_cols = "user_id," + ",".join(p for p, _ in PLATFORMS) + "," + ",".join(e for _, e in PLATFORMS)

    print(f"[backfill] querying clapcheeks_user_settings ({select_cols})")
    resp = client.table("clapcheeks_user_settings").select(select_cols).execute()
    rows = resp.data or []
    print(f"[backfill] {len(rows)} rows total")

    stats = {"considered": 0, "encrypted": 0, "skipped_already_enc": 0,
             "skipped_no_plain": 0, "errors": 0, "plaintext_cleared": 0}

    for row in rows:
        user_id = row.get("user_id")
        if not user_id:
            continue
        update: dict = {}
        for plain_col, enc_col in PLATFORMS:
            stats["considered"] += 1
            plain = row.get(plain_col)
            enc = row.get(enc_col)
            if enc:
                stats["skipped_already_enc"] += 1
                # Optionally clear plaintext if user passed --clear-plaintext.
                if args.clear_plaintext and plain:
                    update[plain_col] = None
                    stats["plaintext_cleared"] += 1
                continue
            if not plain:
                stats["skipped_no_plain"] += 1
                continue
            try:
                ct = encrypt_token(plain, user_id)
            except Exception as exc:  # noqa: BLE001
                print(f"  ERROR user={user_id} col={plain_col}: {exc}")
                stats["errors"] += 1
                continue
            # supabase-py serialises bytes -> base64 in JSON, but PostgREST
            # expects bytea hex `\x...`. Use the explicit hex form.
            update[enc_col] = "\\x" + ct.hex()
            update["token_enc_version"] = 1
            stats["encrypted"] += 1
            if args.clear_plaintext:
                update[plain_col] = None
                stats["plaintext_cleared"] += 1
        if not update:
            continue
        if args.dry_run:
            keys = ",".join(sorted(update.keys()))
            print(f"  [dry-run] user={user_id} would update: {keys}")
            continue
        try:
            client.table("clapcheeks_user_settings").update(update).eq(
                "user_id", user_id
            ).execute()
            print(f"  user={user_id} updated cols={sorted(update.keys())}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ERROR writing user={user_id}: {exc}")
            stats["errors"] += 1

    print()
    print("[backfill] DONE")
    for k in ("considered", "encrypted", "skipped_already_enc",
              "skipped_no_plain", "plaintext_cleared", "errors"):
        print(f"  {k:24s}: {stats[k]}")
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
