"""Auto-Swipe Mode — agent swipes based on learned preferences (AUTO-02)."""
from __future__ import annotations
import logging, time
from dataclasses import dataclass, field
from typing import Any
from clapcheeks.autonomy.config import AutonomyConfig
from clapcheeks.autonomy.preference_model import PreferenceModel, extract_features

logger = logging.getLogger(__name__)

@dataclass
class SwipeDecision:
    profile_id: str; profile_data: dict[str, Any]; decision: str; confidence: float
    was_auto: bool = True; model_version: int = 0

@dataclass
class SwipeSession:
    platform: str; started_at: float = field(default_factory=time.time)
    decisions: list[SwipeDecision] = field(default_factory=list)
    skipped_low_confidence: int = 0; errors: int = 0
    @property
    def likes(self) -> int: return sum(1 for d in self.decisions if d.decision == "like")
    @property
    def passes(self) -> int: return sum(1 for d in self.decisions if d.decision == "pass")
    @property
    def total(self) -> int: return len(self.decisions)
    @property
    def avg_confidence(self) -> float:
        return sum(d.confidence for d in self.decisions)/len(self.decisions) if self.decisions else 0.0

class AutoSwiper:
    def __init__(self, config: AutonomyConfig, model: PreferenceModel, user_age: int = 30):
        self.config = config; self.model = model; self.user_age = user_age
        self._hourly_counts: dict[str, int] = {}; self._hour_start = time.time()

    def create_session(self, platform: str) -> SwipeSession:
        if not self.config.auto_swipe_enabled: raise RuntimeError("Auto-swipe not enabled")
        return SwipeSession(platform=platform)

    def decide(self, session: SwipeSession, profile_data: dict[str, Any]) -> SwipeDecision | None:
        if not self._check_rate(session.platform): return None
        features = extract_features(profile_data, self.user_age)
        decision, confidence = self.model.predict(features)
        if confidence < self.config.auto_swipe_confidence_min:
            session.skipped_low_confidence += 1; return None
        swipe = SwipeDecision(profile_id=str(profile_data.get("id","")), profile_data=profile_data,
                              decision=decision, confidence=round(confidence,1), model_version=self.model.version)
        session.decisions.append(swipe); self._hourly_counts[session.platform] = self._hourly_counts.get(session.platform,0)+1
        return swipe

    def end_session(self, session: SwipeSession) -> dict[str, Any]:
        return {"platform": session.platform, "duration_seconds": round(time.time()-session.started_at,1),
                "total_swiped": session.total, "likes": session.likes, "passes": session.passes,
                "skipped_low_confidence": session.skipped_low_confidence, "avg_confidence": round(session.avg_confidence,1)}

    def _check_rate(self, platform: str) -> bool:
        if time.time()-self._hour_start > 3600: self._hourly_counts.clear(); self._hour_start = time.time()
        return self._hourly_counts.get(platform,0) < self.config.max_auto_swipes_per_hour
