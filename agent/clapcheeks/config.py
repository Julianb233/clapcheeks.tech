"""Loads and saves local agent config from ~/.clapcheeks/config.yaml"""
import yaml
from pathlib import Path

CONFIG_DIR = Path.home() / ".clapcheeks"
CONFIG_FILE = CONFIG_DIR / "config.yaml"

DEFAULTS = {
    "api_url": "https://api.clapcheeks.tech",
    "agent_token": "",
    "dashboard_url": "https://clapcheeks.tech/dashboard",
}


def load() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULTS, **(yaml.safe_load(f) or {})}
    return DEFAULTS.copy()


def save(config: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        yaml.dump(config, f)


def save_agent_token(token: str) -> None:
    """Save agent token securely (keychain if available, file fallback)."""
    try:
        import keyring
        keyring.set_password("clapcheeks", "agent_token", token)
        return
    except Exception:
        pass
    config = load()
    config["agent_token"] = token
    save(config)


def get_agent_token() -> str | None:
    """Load agent token from keychain or config file."""
    try:
        import keyring
        token = keyring.get_password("clapcheeks", "agent_token")
        if token:
            return token
    except Exception:
        pass
    return load().get("agent_token") or None
