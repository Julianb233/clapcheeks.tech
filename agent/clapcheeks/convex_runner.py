"""Convex job runner — AI-9500-C (AI-9502).

Polls the Convex agent_jobs queue for jobs destined for the Mac Mini agent,
executes the registered handler, and reports completion / failure back to
Convex.

Supported job_types
-------------------
- "sync_hinge"  : polls Hinge matches for new messages via poll_hinge()

Adding a new handler
--------------------
1. Import the function.
2. Add an entry to HANDLERS dict below.
3. The runner calls handler(payload) and expects a dict back.

Usage
-----
    python -m clapcheeks.convex_runner

Runs a single poll-claim-execute cycle and exits. Suitable for launchd
``StartInterval`` or systemd timer invocation.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable

import requests

logger = logging.getLogger("clapcheeks.convex_runner")

_HTTP_TIMEOUT = 15
_USER_ID = "fleet-julian"
_AGENT_INSTANCE_ID = f"mac-mini-convex-runner-{os.getpid()}"
_LOCK_SECONDS = 120


# ---------------------------------------------------------------------------
# Handler registry
# ---------------------------------------------------------------------------

def _handle_sync_hinge(payload: dict) -> dict:
    """Execute a Hinge message sync and return the result dict."""
    from clapcheeks.intel.hinge_poller import run_once
    return run_once()


HANDLERS: dict[str, Callable[[dict], dict]] = {
    "sync_hinge": _handle_sync_hinge,
}


# ---------------------------------------------------------------------------
# Convex HTTP helpers
# ---------------------------------------------------------------------------

def _convex_url() -> str:
    url = os.environ.get("CONVEX_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("CONVEX_URL not set")
    return url


def _call(endpoint: str, path: str, args: dict) -> Any:
    url = f"{_convex_url()}/api/{endpoint}"
    payload = {"path": path, "args": args, "format": "json"}
    resp = requests.post(url, json=payload, timeout=_HTTP_TIMEOUT)
    if resp.status_code >= 400:
        raise RuntimeError(f"Convex {endpoint} {path} -> {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if isinstance(data, dict) and data.get("status") == "error":
        raise RuntimeError(
            f"Convex error ({path}): {data.get('errorMessage', data)}"
        )
    return data.get("value") if isinstance(data, dict) else data


def _mutation(path: str, args: dict) -> Any:
    return _call("mutation", path, args)


def _claim_job() -> dict | None:
    """Claim the next queued job for this user. Returns the job row or None."""
    return _mutation(
        "agent_jobs:claim",
        {
            "user_id": _USER_ID,
            "agent_instance_id": _AGENT_INSTANCE_ID,
            "lock_seconds": _LOCK_SECONDS,
        },
    )


def _complete_job(job_id: str, result: dict) -> None:
    _mutation("agent_jobs:complete", {"id": job_id, "result": result})


def _fail_job(job_id: str, error: str) -> None:
    _mutation("agent_jobs:fail", {"id": job_id, "error": error[:500]})


# ---------------------------------------------------------------------------
# Main runner loop (single cycle)
# ---------------------------------------------------------------------------

def run_once() -> dict:
    """Claim and execute one job from the Convex queue.

    Returns:
        {
            "ran": bool,        # True if a job was found and executed
            "job_type": str,    # job_type if ran=True
            "result": dict,     # handler result if ran=True
            "error": str | None # error message on failure
        }
    """
    try:
        job = _claim_job()
    except Exception as exc:
        logger.error("Failed to claim job: %s", exc)
        return {"ran": False, "job_type": None, "result": None, "error": str(exc)}

    if job is None:
        logger.debug("No queued jobs for %s", _USER_ID)
        return {"ran": False, "job_type": None, "result": None, "error": None}

    job_id = job.get("_id") or job.get("id", "")
    job_type = job.get("job_type", "unknown")
    payload = job.get("payload") or {}

    logger.info("Claimed job %s (type=%s)", job_id, job_type)

    handler = HANDLERS.get(job_type)
    if handler is None:
        msg = f"Unknown job_type: {job_type}"
        logger.warning(msg)
        try:
            _fail_job(job_id, msg)
        except Exception:
            pass
        return {"ran": True, "job_type": job_type, "result": None, "error": msg}

    try:
        result = handler(payload)
        logger.info("Job %s completed: %s", job_id, result)
        _complete_job(job_id, result)
        return {"ran": True, "job_type": job_type, "result": result, "error": None}
    except Exception as exc:
        error_msg = str(exc)
        logger.error("Job %s failed: %s", job_id, error_msg)
        try:
            _fail_job(job_id, error_msg)
        except Exception:
            pass
        return {"ran": True, "job_type": job_type, "result": None, "error": error_msg}


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Load ~/.clapcheeks/.env if present
    try:
        from dotenv import load_dotenv
        env_file = Path.home() / ".clapcheeks" / ".env"
        if env_file.exists():
            load_dotenv(env_file, override=False)
    except ImportError:
        pass

    result = run_once()
    print(json.dumps(result, indent=2))
    sys.exit(0 if not result.get("error") else 1)
