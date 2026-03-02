"""CLI authentication flows: browser-based and device-code."""
from __future__ import annotations

import json
import secrets
import time
import webbrowser

import requests
from rich.console import Console

console = Console()

DEVICE_AUTH_ENDPOINT = "/auth/device"
ACTIVATE_URL = "https://clapcheeks.tech/activate"
DEFAULT_API_URL = "https://api.clapcheeks.tech"


# --- Browser-based auth (legacy, used by setup wizard) ---

def generate_cli_session_id() -> str:
    """Generate a random 32-character hex session ID."""
    return secrets.token_hex(16)


def open_browser_auth(session_id: str) -> None:
    """Open the browser to the CLI auth page."""
    url = f"https://clapcheeks.tech/auth/cli?session={session_id}"
    webbrowser.open(url)


def poll_for_token(session_id: str, api_url: str, timeout: int = 300) -> str | None:
    """Poll the API for an authenticated token.

    Returns the token string on success, None on timeout.
    """
    endpoint = f"{api_url}/auth/cli/poll?session={session_id}"
    deadline = time.time() + timeout

    with console.status("[bold magenta]Waiting for browser login...[/bold magenta]"):
        while time.time() < deadline:
            try:
                resp = requests.get(endpoint, timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("status") == "authenticated" and data.get("token"):
                        return data["token"]
            except requests.RequestException:
                pass
            time.sleep(2)

    return None


# --- Device-code auth (new onboarding flow) ---

def request_device_code(api_url: str = DEFAULT_API_URL) -> dict | None:
    """Request a device code from the API.

    Returns dict with 'device_code', 'user_code', 'interval', 'expires_in'
    or None on failure.
    """
    try:
        resp = requests.post(f"{api_url}{DEVICE_AUTH_ENDPOINT}", timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except requests.RequestException:
        pass
    return None


def poll_device_auth(device_code: str, api_url: str = DEFAULT_API_URL,
                     interval: int = 2, timeout: int = 300) -> str | None:
    """Poll for device authorization completion.

    Returns the access token on success, None on timeout.
    """
    endpoint = f"{api_url}{DEVICE_AUTH_ENDPOINT}/{device_code}"
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            resp = requests.get(endpoint, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "authenticated" and data.get("token"):
                    return data["token"]
        except requests.RequestException:
            pass
        time.sleep(interval)

    return None


def device_login(api_url: str = DEFAULT_API_URL) -> str | None:
    """Run the full device-code login flow.

    Returns the access token on success, None on failure/timeout.
    """
    code_data = request_device_code(api_url)
    if not code_data:
        console.print("[red]Could not reach the Outward API.[/red]")
        console.print(f"[dim]Tried: {api_url}{DEVICE_AUTH_ENDPOINT}[/dim]")
        return None

    user_code = code_data["user_code"]
    device_code = code_data["device_code"]
    interval = code_data.get("interval", 2)
    expires_in = code_data.get("expires_in", 300)

    console.print()
    console.print(f"  Visit [bold cyan]{ACTIVATE_URL}[/bold cyan] and enter code:")
    console.print(f"  [bold white on magenta] {user_code} [/bold white on magenta]")
    console.print()

    # Open activation page in default browser
    webbrowser.open(ACTIVATE_URL)

    with console.status("[bold magenta]Waiting for you to log in...[/bold magenta]"):
        token = poll_device_auth(
            device_code, api_url=api_url, interval=interval, timeout=expires_in,
        )

    return token
