"""Hinge SMS auth flow — programmatic token refresh without manual capture.

Flow:
    1. POST phone number -> Hinge's auth endpoint, get `sms_id`
    2. Hinge texts a numeric code to the phone
    3. Wait for the code to appear in the Mac's Messages.db
    4. POST sms_id + code -> get a fresh JWT + install/session IDs
    5. Write the new values into ~/.clapcheeks/.env, return them

Notes:
    - Requires CLAPCHEEKS_HINGE_PHONE in E.164 format (+14155551234) or
      pass it explicitly.
    - Requires SMS forwarding from at least one of your iPhones to the
      Mac running this, AND Full Disk Access for the Python binary.
    - Endpoints reverse-engineered from the HingeSDK (Reed Graff). Keep
      HINGE_API_BASE env var as the escape hatch if they move.
"""
from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

import requests

from clapcheeks.inputs.sms import wait_for_code, MessagesDBUnavailable

logger = logging.getLogger("clapcheeks.hinge_auth")

DEFAULT_BASE = "https://prod-api.hingeaws.net"
REQUEST_TIMEOUT = 15

_ENV_FILE = Path.home() / ".clapcheeks" / ".env"


class HingeSMSAuthFailed(RuntimeError):
    """Raised when the end-to-end SMS refresh cannot complete."""


def _base_url() -> str:
    return os.environ.get("HINGE_API_BASE", DEFAULT_BASE).rstrip("/")


def _default_headers() -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Hinge/9.68.0 (iPhone; iOS 17.4; Scale/3.00)",
        "X-App-Version": "9.68.0",
        "X-Build-Number": "9680",
        "X-OS-Version": "17.4",
        "X-Device-Platform": "ios",
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def request_sms(phone_number: str) -> str:
    """Ask Hinge to send an SMS to `phone_number`. Returns the sms_id."""
    url = f"{_base_url()}/auth/sms"
    body = {"phoneNumber": phone_number}
    resp = requests.post(url, json=body, headers=_default_headers(), timeout=REQUEST_TIMEOUT)
    if resp.status_code >= 400:
        raise HingeSMSAuthFailed(
            f"SMS request failed: {resp.status_code} {resp.text[:200]}"
        )
    data = resp.json() if resp.content else {}
    sms_id = data.get("smsId") or data.get("sms_id") or data.get("id")
    if not sms_id:
        raise HingeSMSAuthFailed(f"SMS request returned no sms_id: {data}")
    logger.info("Hinge SMS requested for %s... sms_id=%s", phone_number[:5], sms_id[:8])
    return sms_id


def submit_code(sms_id: str, code: str, phone_number: str) -> dict:
    """Exchange (sms_id, code) for a fresh JWT + device IDs."""
    url = f"{_base_url()}/auth/sms/authenticate"
    body = {
        "smsId": sms_id,
        "otp": code,
        "phoneNumber": phone_number,
    }
    resp = requests.post(url, json=body, headers=_default_headers(), timeout=REQUEST_TIMEOUT)
    if resp.status_code >= 400:
        raise HingeSMSAuthFailed(
            f"Code submit failed: {resp.status_code} {resp.text[:200]}"
        )
    data = resp.json() if resp.content else {}
    token = data.get("token") or data.get("accessToken") or data.get("jwt")
    if not token:
        raise HingeSMSAuthFailed(f"Authenticate returned no token: {data}")
    return {
        "token": token,
        "install_id": data.get("installId") or data.get("install_id"),
        "session_id": data.get("sessionId") or data.get("session_id"),
        "device_id": data.get("deviceId") or data.get("device_id"),
        "refresh_token": data.get("refreshToken"),
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def refresh_token(
    phone_number: str | None = None,
    *,
    timeout_seconds: int = 90,
) -> dict:
    """End-to-end SMS refresh. Returns the same dict as submit_code().

    Also writes the token + ID headers into ~/.clapcheeks/.env so the daemon
    picks them up on its next tick.
    """
    phone = phone_number or os.environ.get("CLAPCHEEKS_HINGE_PHONE", "").strip()
    if not phone:
        raise HingeSMSAuthFailed(
            "No phone number available. Set CLAPCHEEKS_HINGE_PHONE=+14155551234 "
            "in ~/.clapcheeks/.env or pass phone_number explicitly."
        )

    started_at = time.time()
    sms_id = request_sms(phone)

    try:
        code_msg = wait_for_code(
            "hinge",
            timeout_seconds=timeout_seconds,
            received_after=started_at - 2,
        )
    except MessagesDBUnavailable as exc:
        raise HingeSMSAuthFailed(str(exc)) from exc

    if not code_msg:
        raise HingeSMSAuthFailed(
            f"No Hinge SMS received in {timeout_seconds}s. "
            "Check SMS forwarding is on for the phone that received it."
        )

    logger.info("Submitting Hinge code %s for sms_id=%s", code_msg.code, sms_id[:8])
    result = submit_code(sms_id, code_msg.code, phone)

    # Persist to ~/.clapcheeks/.env
    updates: dict[str, str] = {"HINGE_AUTH_TOKEN": result["token"]}
    if result.get("install_id"):
        updates["HINGE_INSTALL_ID"] = result["install_id"]
    if result.get("session_id"):
        updates["HINGE_SESSION_ID"] = result["session_id"]
    if result.get("device_id"):
        updates["HINGE_DEVICE_ID"] = result["device_id"]
    _merge_env_file(updates)

    # Mirror into os.environ so the caller can reuse without restart
    for k, v in updates.items():
        os.environ[k] = v

    logger.info("Hinge token refreshed via SMS (total elapsed %.1fs)", time.time() - started_at)
    return result


# ---------------------------------------------------------------------------
# .env merge helper
# ---------------------------------------------------------------------------

def _merge_env_file(updates: dict[str, str]) -> None:
    """Merge `updates` into ~/.clapcheeks/.env, preserving other lines."""
    _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, str] = {}
    order: list[str] = []
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                # Preserve comments + blanks as order markers w/ empty value
                order.append(line)
                continue
            k, v = stripped.split("=", 1)
            k = k.strip()
            existing[k] = v.strip().strip('"').strip("'")
            if k not in order:
                order.append(k)

    existing.update({k: v for k, v in updates.items() if v})
    for k in updates:
        if k not in order:
            order.append(k)

    lines: list[str] = []
    seen: set[str] = set()
    for marker in order:
        if marker in existing:
            lines.append(f"{marker}={existing[marker]}")
            seen.add(marker)
        elif marker.strip() and not marker.strip().startswith("#") and "=" not in marker:
            # orphan key (shouldn't happen after the logic above)
            continue
        else:
            lines.append(marker)
    # Append any keys we never saw in `order`
    for k, v in existing.items():
        if k not in seen:
            lines.append(f"{k}={v}")

    _ENV_FILE.write_text("\n".join(lines) + "\n")
    try:
        _ENV_FILE.chmod(0o600)
    except Exception:
        pass
