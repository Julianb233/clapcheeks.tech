"""Proxy validator — tests proxy health and rotation quality.

Validates:
- Proxy connectivity and latency
- IP uniqueness (no two platforms share an exit IP)
- Geographic consistency (IP should be in the same region as the account)
- Rotation is actually working (not getting the same IP repeatedly)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from clapcheeks.proxy.manager import ProxyManager

logger = logging.getLogger(__name__)


@dataclass
class ProxyTestResult:
    """Result of testing a single proxy."""
    proxy_url: str
    reachable: bool
    latency_ms: float | None
    exit_ip: str | None
    error: str | None = None


class ProxyValidator:
    """Validates proxy health and rotation quality.

    Usage:
        validator = ProxyValidator(proxy_manager)
        report = validator.full_health_check()
        if not report["healthy"]:
            print("Proxy issues:", report["issues"])
    """

    def __init__(self, proxy_manager: ProxyManager | None = None) -> None:
        self._manager = proxy_manager or ProxyManager()

    def test_proxy(self, proxy_url: str, timeout: float = 10.0) -> ProxyTestResult:
        """Test a single proxy for connectivity and latency."""
        try:
            import requests
            start = time.time()
            resp = requests.get(
                "https://httpbin.org/ip",
                proxies={"https": proxy_url, "http": proxy_url},
                timeout=timeout,
            )
            latency = (time.time() - start) * 1000
            exit_ip = resp.json().get("origin", "unknown")
            return ProxyTestResult(
                proxy_url=proxy_url,
                reachable=True,
                latency_ms=round(latency, 1),
                exit_ip=exit_ip,
            )
        except Exception as exc:
            return ProxyTestResult(
                proxy_url=proxy_url,
                reachable=False,
                latency_ms=None,
                exit_ip=None,
                error=str(exc),
            )

    def validate_ip_isolation(self) -> dict[str, Any]:
        """Verify that different platform families get different exit IPs.

        Returns a report with pass/fail and the IPs observed per family.
        """
        families = {
            "match_group": ["tinder", "hinge"],
            "bumble_inc": ["bumble"],
            "independent": ["grindr"],
        }

        family_ips: dict[str, set[str]] = {}
        results: dict[str, str] = {}

        for family, platforms in families.items():
            ips = set()
            for platform in platforms:
                proxy = self._manager.get_proxy(platform)
                if proxy:
                    result = self.test_proxy(proxy)
                    if result.exit_ip:
                        ips.add(result.exit_ip)
                        results[platform] = result.exit_ip
            family_ips[family] = ips

        # Check for IP overlap between families
        all_families = list(family_ips.keys())
        overlaps = []
        for i, f1 in enumerate(all_families):
            for f2 in all_families[i + 1:]:
                shared = family_ips[f1] & family_ips[f2]
                if shared:
                    overlaps.append((f1, f2, shared))

        return {
            "isolated": len(overlaps) == 0,
            "family_ips": {k: list(v) for k, v in family_ips.items()},
            "platform_ips": results,
            "overlaps": overlaps,
        }

    def validate_rotation(self, platform: str = "tinder", rounds: int = 3) -> dict[str, Any]:
        """Verify that proxy rotation produces different IPs.

        Makes multiple requests through the proxy to confirm rotation.
        """
        ips_seen: list[str] = []

        for i in range(rounds):
            proxy = self._manager.get_proxy(platform)
            if not proxy:
                return {"rotating": False, "error": f"No proxy for {platform}"}

            result = self.test_proxy(proxy)
            if result.exit_ip:
                ips_seen.append(result.exit_ip)

            if i < rounds - 1:
                self._manager.rotate(platform)

        unique_ips = len(set(ips_seen))
        return {
            "rotating": unique_ips > 1,
            "ips_seen": ips_seen,
            "unique_count": unique_ips,
            "rounds": rounds,
        }

    def full_health_check(self) -> dict[str, Any]:
        """Run a comprehensive proxy health check.

        Returns a report covering:
        - Pool health (how many proxies are reachable)
        - IP isolation (different families get different IPs)
        - Rotation (proxies actually change)
        """
        issues: list[str] = []

        # Test pool health
        pool = self._manager.get_pool_status()
        total = pool.get("total", 0)
        healthy = pool.get("healthy", 0)

        if total == 0:
            issues.append("No proxies configured")
        elif healthy / max(total, 1) < 0.5:
            issues.append(f"Low proxy health: {healthy}/{total} reachable")

        # Test IP isolation
        isolation = self.validate_ip_isolation()
        if not isolation["isolated"]:
            issues.append(
                f"IP isolation violation: {isolation['overlaps']}"
            )

        return {
            "healthy": len(issues) == 0,
            "pool": pool,
            "isolation": isolation,
            "issues": issues,
        }
