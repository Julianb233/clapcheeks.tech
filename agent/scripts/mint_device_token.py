#!/usr/bin/env python3
"""Mint a new device token for the clapcheeks Chrome extension.

Inserts a row into clapcheeks_agent_tokens (the table the extension
authenticates against via X-Device-Token) and prints the raw token so
you can paste it into the extension's popup settings.

Usage:
    python3 agent/scripts/mint_device_token.py --device-name julian-mbp-chrome
    python3 agent/scripts/mint_device_token.py --device-name foo --email julian@aiacrobatics.com
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path


def _load_env() -> None:
    candidates = [
        Path.cwd() / ".env.local",
        Path(__file__).resolve().parent.parent.parent / ".env.local",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if k == "NEXT_PUBLIC_SUPABASE_URL":
                os.environ["SUPABASE_URL"] = v
            elif k == "SUPABASE_SERVICE_ROLE_KEY":
                os.environ["SUPABASE_SERVICE_KEY"] = v
        break


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device-name", required=True,
                    help="Friendly label shown in dashboards, e.g. 'julian-mbp-chrome'")
    ap.add_argument("--email", help="Auth user email (default: first settings row).")
    args = ap.parse_args()

    _load_env()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing. "
              "Run from the clapcheeks.tech/ root so .env.local is picked up.",
              file=sys.stderr)
        return 2

    from supabase import create_client
    c = create_client(url, key)

    # Resolve user
    if args.email:
        auth = c.auth.admin.list_users()
        users = getattr(auth, "users", None) or auth
        uid = None
        for u in users:
            email = getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None)
            if email and email.lower() == args.email.lower():
                uid = getattr(u, "id", None) or u.get("id")
                break
        if not uid:
            print(f"ERROR: no auth user for {args.email}", file=sys.stderr)
            return 2
    else:
        resp = c.table("clapcheeks_user_settings").select("user_id").limit(1).execute()
        rows = resp.data or []
        if not rows:
            print("ERROR: no clapcheeks_user_settings row. Pass --email.", file=sys.stderr)
            return 2
        uid = rows[0]["user_id"]

    token = secrets.token_urlsafe(48)
    try:
        c.table("clapcheeks_agent_tokens").insert({
            "user_id": uid,
            "device_name": args.device_name,
            "token": token,
        }).execute()
    except Exception as exc:
        print(f"ERROR: insert failed: {exc}", file=sys.stderr)
        return 1

    print("=" * 60)
    print(f"MINTED device token for user {uid}")
    print(f"  device_name: {args.device_name}")
    print(f"  token:       {token}")
    print("=" * 60)
    print("\nNext: open the extension popup (chrome://extensions -> Details ->")
    print("Extension options, or click the toolbar icon) and paste the token")
    print("above into 'Device token', then click Save.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
