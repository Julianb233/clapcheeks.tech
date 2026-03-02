"""Loads and saves local agent config from ~/.outward/config.yaml"""
import os
import yaml
from pathlib import Path

CONFIG_DIR = Path.home() / ".outward"
CONFIG_FILE = CONFIG_DIR / "config.yaml"

DEFAULTS = {
    "api_url": "https://api.clapcheeks.tech",
    "agent_token": "",
    "apps_enabled": [],
    "ai_provider": "ollama",
    "ai_model": "llama3.2",
    "swipe_limit_daily": 200,
    "privacy_mode": True,  # Never sync raw messages
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
