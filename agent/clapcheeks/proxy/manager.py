"""Proxy manager -- per-platform-family residential proxy rotation.

Platform families (share ban signals, need isolated IPs):
  match_group:  tinder, hinge, okcupid, pof
  bumble_inc:   bumble, badoo
  independents: grindr, happn, feeld, cmb

Each family gets its own proxy pool. Proxies rotate on each session.
Supports: Bright Data, Smartproxy, or custom proxy list from config.
"""
from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, field
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

PLATFORM_FAMILY = {
    "tinder": "match_group",
    "hinge": "match_group",
    "okcupid": "match_group",
    "pof": "match_group",
    "bumble": "bumble_inc",
    "badoo": "bumble_inc",
    "grindr": "independents",
    "happn": "independents",
    "feeld": "independents",
    "cmb": "independents",
}

ALL_FAMILIES = sorted(set(PLATFORM_FAMILY.values()))

CONFIG_FILE = Path.home() / ".clapcheeks" / "config.yaml"

MAX_FAILURES = 5


@dataclass
class Proxy:
    host: str
    port: int
    username: str = ""
    password: str = ""
    family: str = ""
    last_used: float = 0.0
    failures: int = 0

    @property
    def url(self) -> str:
        if self.username:
            return f"http://{self.username}:{self.password}@{self.host}:{self.port}"
        return f"http://{self.host}:{self.port}"

    @property
    def requests_dict(self) -> dict:
        return {"http": self.url, "https": self.url}


class ProxyManager:
    """Manages per-platform-family proxy pools with LRU rotation."""

    def __init__(self, config: dict | None = None) -> None:
        if config is None:
            config = self._load_config()
        proxy_cfg = config.get("proxy", {})
        self._provider = proxy_cfg.get("provider", "none")
        self._pools: dict[str, list[Proxy]] = {}
        self._session_counters: dict[str, int] = {}
        self._build_pools(proxy_cfg)

    @staticmethod
    def _load_config() -> dict:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE) as f:
                return yaml.safe_load(f) or {}
        return {}

    def _build_pools(self, proxy_cfg: dict) -> None:
        """Build proxy pools from config based on provider type."""
        if self._provider == "none" or not self._provider:
            return

        if self._provider == "bright_data":
            bd = proxy_cfg.get("bright_data", {})
            host = bd.get("host", "brd.superproxy.io")
            port = int(bd.get("port", 22225))
            username = bd.get("username", "")
            password = bd.get("password", "")
            if not username:
                logger.warning("Bright Data configured but no username set.")
                return
            for fam in ALL_FAMILIES:
                self._pools[fam] = [
                    Proxy(
                        host=host,
                        port=port,
                        username=f"{username}-session-{fam}_{i:03d}",
                        password=password,
                        family=fam,
                    )
                    for i in range(3)
                ]

        elif self._provider == "smartproxy":
            sp = proxy_cfg.get("smartproxy", {})
            host = sp.get("host", "gate.smartproxy.com")
            port = int(sp.get("port", 7000))
            username = sp.get("username", "")
            password = sp.get("password", "")
            if not username:
                logger.warning("Smartproxy configured but no username set.")
                return
            for fam in ALL_FAMILIES:
                self._pools[fam] = [
                    Proxy(
                        host=host,
                        port=port,
                        username=f"{username}-session-{fam}_{i:03d}",
                        password=password,
                        family=fam,
                    )
                    for i in range(3)
                ]

        elif self._provider == "custom":
            custom = proxy_cfg.get("custom", {})
            for fam in ALL_FAMILIES:
                entries = custom.get(fam, [])
                self._pools[fam] = [
                    Proxy(
                        host=e.get("host", ""),
                        port=int(e.get("port", 0)),
                        username=e.get("username", ""),
                        password=e.get("password", ""),
                        family=fam,
                    )
                    for e in entries
                    if e.get("host")
                ]

        else:
            logger.warning("Unknown proxy provider: %s", self._provider)

    def get_proxy(self, platform: str) -> Proxy | None:
        """Return the least-recently-used healthy proxy for a platform's family.

        Returns None if no proxy is configured or all proxies are failed.
        """
        family = PLATFORM_FAMILY.get(platform)
        if not family:
            logger.debug("Unknown platform %s — no proxy assigned.", platform)
            return None

        pool = self._pools.get(family)
        if not pool:
            return None

        # Filter out proxies that have exceeded failure threshold
        healthy = [p for p in pool if p.failures < MAX_FAILURES]
        if not healthy:
            logger.warning("All proxies for family %s have exceeded failure threshold.", family)
            return None

        # Select least-recently-used
        healthy.sort(key=lambda p: p.last_used)
        proxy = healthy[0]
        proxy.last_used = time.time()
        return proxy

    def mark_failed(self, proxy: Proxy) -> None:
        """Increment failure count for a proxy."""
        proxy.failures += 1
        logger.debug(
            "Proxy %s:%d failures=%d", proxy.host, proxy.port, proxy.failures
        )

    def mark_success(self, proxy: Proxy) -> None:
        """Reset failure count on successful use."""
        proxy.failures = 0

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def pools(self) -> dict[str, list[Proxy]]:
        return self._pools

    def status_summary(self) -> dict[str, list[dict]]:
        """Return a summary dict of all pools for CLI display."""
        summary: dict[str, list[dict]] = {}
        for fam, pool in self._pools.items():
            summary[fam] = [
                {
                    "host": p.host,
                    "port": p.port,
                    "username": p.username,
                    "failures": p.failures,
                    "healthy": p.failures < MAX_FAILURES,
                }
                for p in pool
            ]
        return summary
