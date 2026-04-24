"""Google Contacts sync for Elite roster matches.

Drains the queue of elite matches that don't yet have a google_contact_id
and creates them in Google Contacts for julian@aiacrobatics.com via the
fleet `gws workspace` profile. Writes the returned resource name back to
clapcheeks_matches.google_contact_id so we never duplicate.

Invocation:
    clapcheeks elite-sync-google-contacts            # one pass
    /loop 5m clapcheeks elite-sync-google-contacts   # continuous

The web-side pipeline (web/lib/elite-intake.ts) deliberately does NOT
call Google — Vercel has no gws CLI and the OAuth scopes aren't
provisioned there. Keeping the sync VPS-side means one credential to
manage and one Google-auth surface for the whole fleet.

Env required:
    CLAPCHEEKS_SUPABASE_URL  (or SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)
    CLAPCHEEKS_SUPABASE_KEY  (service role; or SUPABASE_SERVICE_KEY)
    CLAPCHEEKS_USER_ID       (Julian's auth.user id — we only sync his rows)

The gws profile is hardcoded to `workspace` (julian@aiacrobatics.com) per
.claude/rules/email-send-via-gws.md profile table — same account that
sends email on the agency's behalf, so contacts land where Julian expects.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path

logger = logging.getLogger("clapcheeks.imessage.elite_google_sync")

GWS_PROFILE_DIR = Path(
    "/opt/agency-workspace/.fleet-config/google-cloud/gws/profiles/workspace"
)


def _supabase_env() -> tuple[str, str]:
    url = (
        os.environ.get("CLAPCHEEKS_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    key = (
        os.environ.get("CLAPCHEEKS_SUPABASE_KEY")
        or os.environ.get("SUPABASE_SERVICE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        raise RuntimeError(
            "Supabase URL/key missing. Set CLAPCHEEKS_SUPABASE_URL + "
            "CLAPCHEEKS_SUPABASE_KEY (or SUPABASE_URL/SUPABASE_SERVICE_KEY)."
        )
    return url.rstrip("/"), key


def _fetch_pending(limit: int = 50) -> list[dict]:
    """Query Supabase PostgREST for elite matches missing google_contact_id."""
    import urllib.request
    import urllib.parse

    url, key = _supabase_env()
    user_id = os.environ.get("CLAPCHEEKS_USER_ID")

    params = {
        "select": "id,name,contact_phone,contact_email,instagram_handle,match_intel",
        "elite": "is.true",
        "google_contact_id": "is.null",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if user_id:
        params["user_id"] = f"eq.{user_id}"

    full_url = f"{url}/rest/v1/clapcheeks_matches?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        full_url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8")) or []


def _write_resource_id(match_id: str, resource_name: str) -> None:
    import urllib.request

    url, key = _supabase_env()
    body = json.dumps({"google_contact_id": resource_name}).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/clapcheeks_matches?id=eq.{match_id}",
        data=body,
        method="PATCH",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def _build_contact_body(match: dict) -> dict:
    """Build a People API `Person` resource for createContact."""
    name = match.get("name") or "Clapcheeks Elite"
    given, _, family = name.partition(" ")

    body: dict = {
        "names": [{"givenName": given or name, "familyName": family or ""}],
        "memberships": [],  # leave to default "myContacts" group
    }
    phone = match.get("contact_phone")
    if phone:
        body["phoneNumbers"] = [{"value": phone, "type": "mobile"}]
    email = match.get("contact_email")
    if email:
        body["emailAddresses"] = [{"value": email}]

    # Instagram URL + notes/bio into the user-defined / biographies fields.
    urls = []
    ig = match.get("instagram_handle")
    if ig:
        urls.append({"value": f"https://instagram.com/{ig}", "type": "profile"})
    if urls:
        body["urls"] = urls

    notes_parts: list[str] = ["Source: Clapcheeks Elite roster"]
    intel = match.get("match_intel") or {}
    if isinstance(intel, dict):
        if intel.get("summary"):
            notes_parts.append(str(intel["summary"]))
        if intel.get("vibe"):
            notes_parts.append(f"City: {intel['vibe']}")
        if intel.get("source_handle"):
            notes_parts.append(f"Via: {intel['source_handle']}")
    body["biographies"] = [{"value": " | ".join(notes_parts), "contentType": "TEXT_PLAIN"}]
    return body


def _gws_create_contact(person_body: dict) -> str | None:
    """Call `gws people createContact` with the workspace profile.
    Returns the resource name (e.g. 'people/c1234567890') or None on failure.
    """
    env = os.environ.copy()
    env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = str(GWS_PROFILE_DIR)
    # gws top-level pattern is `gws <service> <resource> <method>` —
    # for the People API's createContact the full path is
    # `gws people people createContact` (people service, people resource).
    try:
        proc = subprocess.run(
            ["gws", "people", "people", "createContact", "--json", json.dumps(person_body)],
            capture_output=True, text=True, timeout=30, check=False, env=env,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.error("gws createContact error: %s", exc)
        return None
    if proc.returncode != 0:
        logger.error("gws createContact rc=%s stderr=%s", proc.returncode, proc.stderr[:300])
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        logger.error("gws createContact returned non-JSON: %s", proc.stdout[:200])
        return None
    return data.get("resourceName")


def sync_once(limit: int = 50) -> dict[str, int]:
    """One pass over the queue. Returns {'processed', 'created', 'failed'}."""
    stats = {"processed": 0, "created": 0, "failed": 0}
    pending = _fetch_pending(limit=limit)
    logger.info("elite-google-sync: %d pending match(es)", len(pending))
    for match in pending:
        stats["processed"] += 1
        body = _build_contact_body(match)
        resource = _gws_create_contact(body)
        if not resource:
            stats["failed"] += 1
            continue
        try:
            _write_resource_id(match["id"], resource)
        except Exception as exc:  # noqa: BLE001
            logger.error("failed to persist resource_id for %s: %s", match["id"], exc)
            stats["failed"] += 1
            continue
        stats["created"] += 1
        logger.info(
            "synced %s -> Google Contacts %s (%s)",
            match.get("name"), resource, match.get("contact_phone") or match.get("contact_email"),
        )
    return stats
