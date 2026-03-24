"""Photo scorer — ranks profile photos by predicted swipe-right rate.

Uses heuristics + AI vision (Kimi multimodal or local) to score each photo.
Scoring criteria:
- Face visibility and clarity (0-30 pts)
- Smile detection (0-20 pts)
- Background quality (indoor clutter vs outdoor/clean) (0-20 pts)
- Lighting quality (0-15 pts)
- Solo vs group (solo preferred for first photo) (0-15 pts)

Total: 0-100 score per photo.
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageStat


@dataclass
class PhotoScore:
    path: str
    score: float          # 0-100
    rank: int             # 1 = best
    face_score: float
    smile_score: float
    background_score: float
    lighting_score: float
    solo_score: float
    tips: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# PIL heuristic scorer
# ---------------------------------------------------------------------------

def _brightness_score(stat: ImageStat.Stat) -> float:
    """Score brightness: penalize too dark or too bright."""
    avg = sum(stat.mean[:3]) / 3
    # Ideal range: 90-170
    if 90 <= avg <= 170:
        return 1.0
    if avg < 90:
        return max(0.0, avg / 90)
    return max(0.0, 1.0 - (avg - 170) / 85)


def _contrast_score(stat: ImageStat.Stat) -> float:
    """Score contrast via stddev of pixel values."""
    avg_std = sum(stat.stddev[:3]) / 3
    # Good contrast: stddev 40-80
    if 40 <= avg_std <= 80:
        return 1.0
    if avg_std < 40:
        return max(0.0, avg_std / 40)
    return max(0.0, 1.0 - (avg_std - 80) / 80)


def _sharpness_score(img: Image.Image) -> float:
    """Score sharpness via Laplacian variance."""
    gray = img.convert("L")
    laplacian = gray.filter(ImageFilter.Kernel(
        size=(3, 3),
        kernel=[-1, -1, -1, -1, 8, -1, -1, -1, -1],
        scale=1, offset=128,
    ))
    arr = np.array(laplacian, dtype=np.float64)
    variance = float(np.var(arr))
    # Normalize: sharp images have variance > 500
    return min(1.0, variance / 500)


def _aspect_ratio_score(img: Image.Image) -> float:
    """Portrait-oriented images score higher."""
    w, h = img.size
    ratio = h / max(w, 1)
    # Ideal: 4:5 (1.25) or 3:4 (1.33)
    if 1.1 <= ratio <= 1.5:
        return 1.0
    if 0.9 <= ratio <= 1.1:
        return 0.7  # square-ish
    if ratio < 0.9:
        return 0.4  # landscape
    return 0.8  # very tall


def _saturation_score(img: Image.Image) -> float:
    """Higher saturation tends to perform better."""
    hsv = img.convert("HSV")
    s_channel = np.array(hsv)[:, :, 1].astype(np.float64)
    avg_sat = float(np.mean(s_channel))
    # Good saturation: 60-180 out of 255
    if 60 <= avg_sat <= 180:
        return 1.0
    if avg_sat < 60:
        return max(0.3, avg_sat / 60)
    return max(0.5, 1.0 - (avg_sat - 180) / 150)


def _heuristic_score(image_path: str | Path) -> PhotoScore:
    """Score a photo using PIL heuristics only."""
    img = Image.open(image_path).convert("RGB")
    stat = ImageStat.Stat(img)

    brightness = _brightness_score(stat)
    contrast = _contrast_score(stat)
    sharpness = _sharpness_score(img)
    aspect = _aspect_ratio_score(img)
    saturation = _saturation_score(img)

    # Map heuristics to scoring categories
    lighting = (brightness * 0.6 + contrast * 0.4) * 15
    face = sharpness * 30  # sharpness as proxy for face clarity
    smile = saturation * 20  # saturation as proxy (colorful = engaging)
    background = contrast * 20
    solo = aspect * 15

    total = face + smile + background + lighting + solo

    tips: list[str] = []
    if brightness < 0.6:
        tips.append("Photo is too dark — try better lighting or shoot during golden hour.")
    if brightness > 0.9 and contrast < 0.5:
        tips.append("Photo looks washed out — increase contrast.")
    if sharpness < 0.5:
        tips.append("Image is blurry — use a tripod or tap to focus before shooting.")
    if aspect < 0.7:
        tips.append("Landscape photos perform worse — crop to portrait (4:5) ratio.")
    if saturation < 0.5:
        tips.append("Colors look dull — shoot in natural light or boost saturation slightly.")
    if not tips:
        tips.append("Solid photo! Consider A/B testing it in different profile positions.")

    return PhotoScore(
        path=str(image_path),
        score=round(total, 1),
        rank=0,
        face_score=round(face, 1),
        smile_score=round(smile, 1),
        background_score=round(background, 1),
        lighting_score=round(lighting, 1),
        solo_score=round(solo, 1),
        tips=tips,
    )


# ---------------------------------------------------------------------------
# Kimi vision scorer
# ---------------------------------------------------------------------------

def _kimi_score(image_path: str | Path) -> PhotoScore | None:
    """Score a photo using Kimi vision API. Returns None if unavailable."""
    api_key = os.environ.get("KIMI_API_KEY", "")
    if not api_key:
        return None

    try:
        from openai import OpenAI
    except ImportError:
        return None

    # Read and encode image
    img_bytes = Path(image_path).read_bytes()
    b64 = base64.b64encode(img_bytes).decode()

    # Detect mime type
    ext = Path(image_path).suffix.lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "webp": "image/webp", "gif": "image/gif"}.get(ext.lstrip("."), "image/jpeg")

    client = OpenAI(api_key=api_key, base_url="https://api.moonshot.cn/v1")

    prompt = (
        "Score this dating profile photo from 0 to the max indicated for each category:\n"
        "- face (0-30): face visibility, clarity, attractiveness framing\n"
        "- smile (0-20): genuine smile or warm expression\n"
        "- background (0-20): clean/interesting background vs cluttered\n"
        "- lighting (0-15): good lighting quality\n"
        "- solo (0-15): solo photo preferred, group photos score lower\n"
        "Also provide 1-3 actionable tips to improve the photo.\n"
        'Reply with JSON only: {"face": N, "smile": N, "background": N, '
        '"lighting": N, "solo": N, "tips": ["..."]}'
    )

    try:
        resp = client.chat.completions.create(
            model=os.environ.get("KIMI_VISION_MODEL", "moonshot-v1-8k-vision"),
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        text = resp.choices[0].message.content.strip()
        clean = text.strip("`").removeprefix("json").strip()
        data = json.loads(clean)
    except Exception:
        return None

    face = float(data.get("face", 0))
    smile = float(data.get("smile", 0))
    background = float(data.get("background", 0))
    lighting = float(data.get("lighting", 0))
    solo = float(data.get("solo", 0))
    tips = data.get("tips", [])
    if isinstance(tips, str):
        tips = [tips]

    total = face + smile + background + lighting + solo

    return PhotoScore(
        path=str(image_path),
        score=round(total, 1),
        rank=0,
        face_score=round(face, 1),
        smile_score=round(smile, 1),
        background_score=round(background, 1),
        lighting_score=round(lighting, 1),
        solo_score=round(solo, 1),
        tips=tips[:3],
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def score_photo(image_path: str | Path) -> PhotoScore:
    """Score a single image. Uses Kimi vision if available, else PIL heuristics."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    # Try Kimi vision first
    result = _kimi_score(image_path)
    if result is not None:
        return result

    # Fall back to heuristics
    return _heuristic_score(image_path)


def rank_photos(image_paths: list[str | Path]) -> list[PhotoScore]:
    """Score and rank a list of photos. Returns sorted best-first."""
    scores = [score_photo(p) for p in image_paths]
    scores.sort(key=lambda s: s.score, reverse=True)
    for i, s in enumerate(scores, 1):
        s.rank = i
    return scores


def get_recommendations(scores: list[PhotoScore]) -> list[str]:
    """Generate natural language tips from a list of scored photos."""
    if not scores:
        return ["Upload some photos to get started!"]

    recs: list[str] = []
    best = scores[0]
    worst = scores[-1] if len(scores) > 1 else None

    recs.append(
        f"Your best photo is {Path(best.path).name} (score: {best.score}/100) "
        f"— use it as your first profile photo."
    )

    if worst and worst.score < 50:
        recs.append(
            f"Consider replacing {Path(worst.path).name} (score: {worst.score}/100). "
            f"Tips: {'; '.join(worst.tips[:2])}"
        )

    avg = sum(s.score for s in scores) / len(scores)
    if avg < 60:
        recs.append(
            "Your overall photo quality is below average. Focus on good lighting, "
            "sharp focus, and portrait orientation."
        )
    elif avg >= 80:
        recs.append("Your photo set looks strong! Try A/B testing the order.")

    # Collect unique tips
    all_tips = []
    for s in scores:
        for t in s.tips:
            if t not in all_tips:
                all_tips.append(t)
    recs.extend(all_tips[:3])

    return recs
