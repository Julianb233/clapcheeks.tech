"""Browser-based CLI authentication flow."""
import secrets
import time
import webbrowser

import requests
from rich.console import Console
from rich.spinner import Spinner

console = Console()


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
