"""Preference Learning — track swipe patterns, build preference model (AUTO-01)."""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Any

FEATURE_ORDER = [
    "bio_length", "bio_has_emoji", "bio_has_humor", "photo_count",
    "has_group_photos", "has_travel_photos", "has_pet_photos",
    "age", "age_delta_from_pref", "distance_miles",
    "has_job_title", "has_education", "prompt_count",
    "shared_interests_count", "instagram_connected", "verified",
]

HUMOR_KEYWORDS = frozenset(["sarcasm","joke","laugh","funny","humor","meme","comedy","roast","banter","wit","pun"])
INTEREST_KEYWORDS = frozenset(["travel","hiking","coffee","wine","fitness","yoga","tech","startup","music","concerts","beach","cooking","foodie","adventure","photography"])

@dataclass
class ProfileFeatures:
    bio_length: float = 0.0; bio_has_emoji: float = 0.0; bio_has_humor: float = 0.0
    photo_count: float = 0.0; has_group_photos: float = 0.0; has_travel_photos: float = 0.0; has_pet_photos: float = 0.0
    age: float = 0.0; age_delta_from_pref: float = 0.0; distance_miles: float = 0.0
    has_job_title: float = 0.0; has_education: float = 0.0; prompt_count: float = 0.0
    shared_interests_count: float = 0.0; instagram_connected: float = 0.0; verified: float = 0.0
    def to_dict(self) -> dict[str, float]: return {k: v for k, v in self.__dict__.items()}
    def to_vector(self, order: list[str]) -> list[float]: d = self.to_dict(); return [d.get(f, 0.0) for f in order]

def extract_features(profile_data: dict[str, Any], user_age: int = 30) -> ProfileFeatures:
    bio = str(profile_data.get("bio", "") or "")
    photos = profile_data.get("photos", []) or []
    prompts = profile_data.get("prompts", []) or []
    age = profile_data.get("age", 0) or 0
    interests = [i.lower() for i in (profile_data.get("interests", []) or [])]
    bio_lower = bio.lower()
    return ProfileFeatures(
        bio_length=min(len(bio)/500.0, 1.0), bio_has_emoji=1.0 if any(ord(c)>0x1F600 for c in bio) else 0.0,
        bio_has_humor=1.0 if any(kw in bio_lower for kw in HUMOR_KEYWORDS) else 0.0,
        photo_count=min(len(photos)/6.0, 1.0), has_group_photos=1.0 if profile_data.get("has_group_photos") else 0.0,
        has_travel_photos=1.0 if any("travel" in str(p).lower() for p in photos) else 0.0,
        has_pet_photos=1.0 if profile_data.get("has_pet_photos") else 0.0,
        age=age/100.0 if age else 0.0, age_delta_from_pref=abs(age-user_age)/20.0 if age else 0.5,
        distance_miles=min((profile_data.get("distance_miles", 50) or 50)/100.0, 1.0),
        has_job_title=1.0 if profile_data.get("job_title") else 0.0,
        has_education=1.0 if profile_data.get("education") else 0.0,
        prompt_count=min(len(prompts)/3.0, 1.0),
        shared_interests_count=sum(1 for i in interests if i in INTEREST_KEYWORDS)/max(len(INTEREST_KEYWORDS),1),
        instagram_connected=1.0 if profile_data.get("instagram") else 0.0,
        verified=1.0 if profile_data.get("verified") else 0.0,
    )

def _sigmoid(z: float) -> float:
    if z >= 0: return 1.0/(1.0+math.exp(-z))
    ez = math.exp(z); return ez/(1.0+ez)

@dataclass
class PreferenceModel:
    version: int = 1; training_size: int = 0; accuracy: float | None = None
    weights: dict[str, float] = field(default_factory=dict); bias: float = 0.0
    threshold: float = 0.5; learning_rate: float = 0.01

    def predict_score(self, features: ProfileFeatures) -> float:
        if not self.weights: return 0.5
        vec = features.to_vector(FEATURE_ORDER)
        z = self.bias + sum(w*x for w, x in zip([self.weights.get(f, 0.0) for f in FEATURE_ORDER], vec))
        return _sigmoid(z)

    def predict(self, features: ProfileFeatures) -> tuple[str, float]:
        score = self.predict_score(features)
        if score >= self.threshold: return "like", min(score*100, 100.0)
        return "pass", min((1-score)*100, 100.0)

    def train_batch(self, samples: list[tuple[ProfileFeatures, bool]], epochs: int = 5) -> float:
        if not samples: return 0.0
        if not self.weights: self.weights = {f: 0.0 for f in FEATURE_ORDER}
        correct = 0
        for _ in range(epochs):
            correct = 0
            for features, liked in samples:
                vec = features.to_vector(FEATURE_ORDER)
                score = self.predict_score(features)
                error = (1.0 if liked else 0.0) - score
                for i, fn in enumerate(FEATURE_ORDER): self.weights[fn] += self.learning_rate * error * vec[i]
                self.bias += self.learning_rate * error
                if (score >= self.threshold) == liked: correct += 1
        acc = correct/len(samples)*100 if samples else 0
        self.training_size += len(samples); self.accuracy = round(acc, 1); self.version += 1
        return acc

    def to_db_row(self, user_id: str) -> dict[str, Any]:
        return {"user_id": user_id, "version": self.version, "training_size": self.training_size,
                "accuracy": self.accuracy, "weights": self.weights, "features": FEATURE_ORDER,
                "threshold": self.threshold, "is_active": True}

    @classmethod
    def from_db_row(cls, row: dict[str, Any]) -> PreferenceModel:
        w = row.get("weights", {}) or {}
        return cls(version=row.get("version",1), training_size=row.get("training_size",0),
                   accuracy=row.get("accuracy"), weights=w, bias=w.get("_bias",0.0),
                   threshold=float(row.get("threshold",0.5)))
