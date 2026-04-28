"""Scoped Supabase client factory for the Mac-side agent (AI-8767).

Security model
--------------
* ``get_user_client()`` — authenticates as the operator's own Supabase user
  and returns a client bound to their JWT.  All Mac-side writes go through
  this path so that Row-Level Security is enforced and the service-role key
  is never needed on consumer hardware.

* ``get_service_client()`` — returns a service-role client.  This MUST only
  be called from server-side / VPS code paths (``job_queue.py``,
  ``match_sync.py`` for multi-user sweeps).  Calling it from a single-user
  Mac process raises ``RuntimeError`` unless ``_ALLOW_SERVICE_ROLE`` is set
  in the environment (used only in CI/server contexts).

Token refresh
-------------
The user JWT expires after ~1 hour.  ``get_user_client()`` caches the
client in a module-level singleton protected by a lock.  When a request
fails with a 401, callers should call ``refresh_user_client()`` which
re-authenticates via the stored refresh token and replaces the singleton.

Environment variables (Mac side, ``~/.clapcheeks/.env``)
---------------------------------------------------------
  SUPABASE_URL               — project URL (required)
  SUPABASE_ANON_KEY          — public anon key, safe to embed in client apps
  SUPABASE_USER_ACCESS_TOKEN — short-lived JWT obtained during setup (refreshed automatically)
  SUPABASE_USER_REFRESH_TOKEN — long-lived refresh token for ``auth.refresh_session()``

The old ``SUPABASE_SERVICE_KEY`` must NOT appear in ``~/.clapcheeks/.env``
after upgrade.  The setup wizard removes it automatically.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

try:
    from supabase import create_client
    from supabase.lib.client_options import ClientOptions
except ImportError:  # supabase not installed (e.g. lightweight CI)
    create_client = None  # type: ignore[assignment]
    ClientOptions = None  # type: ignore[assignment,misc]

logger = logging.getLogger("clapcheeks.supabase_client")

_lock = threading.Lock()
_user_client: Any = None  # cached supabase-py Client

# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------

def _load_env_file() -> dict[str, str]:
    """Read ``~/.clapcheeks/.env`` into a dict (no side-effects on os.environ)."""
    env_file = Path.home() / ".clapcheeks" / ".env"
    env: dict[str, str] = {}
    if not env_file.exists():
        return env
    try:
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    except Exception as exc:
        logger.warning("Could not read ~/.clapcheeks/.env: %s", exc)
    return env


def _resolve(key: str, env_file_cache: dict[str, str] | None = None) -> str | None:
    """Resolve a variable from os.environ first, then the .env file cache."""
    val = os.environ.get(key)
    if val:
        return val
    if env_file_cache is None:
        env_file_cache = _load_env_file()
    return env_file_cache.get(key)


def _get_user_creds() -> tuple[str, str, str, str]:
    """Return ``(url, anon_key, access_token, refresh_token)`` or raise.

    Raises ``RuntimeError`` with a helpful message if any value is missing.
    """
    env = _load_env_file()
    url = _resolve("SUPABASE_URL", env)
    anon_key = _resolve("SUPABASE_ANON_KEY", env)
    access_token = _resolve("SUPABASE_USER_ACCESS_TOKEN", env)
    refresh_token = _resolve("SUPABASE_USER_REFRESH_TOKEN", env)

    missing = [
        name for name, val in [
            ("SUPABASE_URL", url),
            ("SUPABASE_ANON_KEY", anon_key),
            ("SUPABASE_USER_ACCESS_TOKEN", access_token),
            ("SUPABASE_USER_REFRESH_TOKEN", refresh_token),
        ] if not val
    ]
    if missing:
        raise RuntimeError(
            f"Missing environment variables for user-scoped Supabase access: "
            f"{', '.join(missing)}. "
            "Run `clapcheeks setup` to re-authenticate and update ~/.clapcheeks/.env."
        )

    return url, anon_key, access_token, refresh_token  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_user_client(*, force_refresh: bool = False) -> Any:
    """Return a Supabase client authenticated as the operator's user.

    The client respects Row-Level Security — writes are scoped to the
    operator's own ``user_id``.

    Pass ``force_refresh=True`` after a 401 to re-authenticate via the
    stored refresh token.
    """
    global _user_client

    with _lock:
        if _user_client is not None and not force_refresh:
            return _user_client

        if create_client is None:
            raise RuntimeError(
                "supabase-py is not installed. Run: pip install 'clapcheeks[supabase]'"
            )

        url, anon_key, access_token, refresh_token = _get_user_creds()

        options = ClientOptions(auto_refresh_token=False) if ClientOptions is not None else None
        client = create_client(
            url,
            anon_key,
            options=options,
        )

        # Inject the existing session so we skip re-authentication overhead.
        # supabase-py will call the API only when we explicitly refresh.
        try:
            client.auth.set_session(access_token, refresh_token)
        except Exception as exc:
            logger.warning(
                "set_session failed (%s); attempting refresh via refresh_token", exc
            )
            _do_refresh(client, refresh_token, url, anon_key)

        _user_client = client
        logger.debug("User-scoped Supabase client initialised")
        return _user_client


def refresh_user_client() -> Any:
    """Force a token refresh and return the new client.

    Call this when a Supabase call returns 401 / JWT expired.
    """
    return get_user_client(force_refresh=True)


def _do_refresh(client: Any, refresh_token: str, url: str, anon_key: str) -> None:
    """Refresh the session in-place and persist the new tokens to .env."""
    try:
        resp = client.auth.refresh_session(refresh_token)
        new_access = resp.session.access_token
        new_refresh = resp.session.refresh_token
        _persist_tokens(new_access, new_refresh)
        logger.info("Supabase session refreshed successfully")
    except Exception as exc:
        raise RuntimeError(
            "Could not refresh Supabase session. "
            "Run `clapcheeks setup` to re-authenticate."
        ) from exc


def _persist_tokens(access_token: str, refresh_token: str) -> None:
    """Write updated tokens back to ``~/.clapcheeks/.env``."""
    env_file = Path.home() / ".clapcheeks" / ".env"
    try:
        lines = env_file.read_text().splitlines() if env_file.exists() else []
        updated: list[str] = []
        seen = set()
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("SUPABASE_USER_ACCESS_TOKEN="):
                updated.append(f"SUPABASE_USER_ACCESS_TOKEN={access_token}")
                seen.add("SUPABASE_USER_ACCESS_TOKEN")
            elif stripped.startswith("SUPABASE_USER_REFRESH_TOKEN="):
                updated.append(f"SUPABASE_USER_REFRESH_TOKEN={refresh_token}")
                seen.add("SUPABASE_USER_REFRESH_TOKEN")
            else:
                updated.append(line)
        # Append any that weren't present
        if "SUPABASE_USER_ACCESS_TOKEN" not in seen:
            updated.append(f"SUPABASE_USER_ACCESS_TOKEN={access_token}")
        if "SUPABASE_USER_REFRESH_TOKEN" not in seen:
            updated.append(f"SUPABASE_USER_REFRESH_TOKEN={refresh_token}")
        env_file.write_text("\n".join(updated) + "\n")
    except Exception as exc:
        logger.warning("Could not persist refreshed tokens to .env: %s", exc)


def get_service_client() -> Any:
    """Return a service-role Supabase client.

    MUST only be called from server-side / VPS code paths.  Raises
    ``RuntimeError`` when called from a single-user Mac process unless
    the ``CLAPCHEEKS_ALLOW_SERVICE_ROLE`` env var is explicitly set.

    Server-side callers that legitimately need service-role:
    - ``job_queue._client()`` — cross-user job queue management
    - ``match_sync.sync_matches()`` — multi-user match sweep (VPS daemon)

    These are annotated with ``# NOQA: service-role-ok`` in their source.
    """
    # Guard: refuse to hand out service-role on single-user Mac contexts
    if not os.environ.get("CLAPCHEEKS_ALLOW_SERVICE_ROLE"):
        raise RuntimeError(
            "get_service_client() called without CLAPCHEEKS_ALLOW_SERVICE_ROLE. "
            "This key must not be used from a consumer Mac. "
            "Use get_user_client() instead, or set CLAPCHEEKS_ALLOW_SERVICE_ROLE=1 "
            "only in VPS/server environments."
        )

    if create_client is None:
        raise RuntimeError(
            "supabase-py is not installed. Run: pip install 'clapcheeks[supabase]'"
        )

    env = _load_env_file()
    url = _resolve("SUPABASE_URL", env)
    # Service-role key lives ONLY in server-side env (api/.env, VPS), never in ~/.clapcheeks/.env
    service_key = _resolve("SUPABASE_SERVICE_KEY", env) or _resolve("SUPABASE_SERVICE_ROLE_KEY", env)

    if not url or not service_key:
        raise RuntimeError(
            "SUPABASE_URL or SUPABASE_SERVICE_KEY not set in server environment. "
            "This key must only be configured on the VPS / API server, not on operator Macs."
        )

    return create_client(url, service_key)
