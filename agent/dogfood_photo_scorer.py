#!/usr/bin/env python3
"""Dogfood: Test photo scorer with simulated dating photos — PERS-212.

Runs the photo scoring system against programmatically generated images
that simulate real dating photo scenarios and prints a detailed report.

Usage:
    python3 dogfood_photo_scorer.py
"""
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))

from clapcheeks.photos.scorer import (
    PhotoScore,
    score_photo,
    rank_photos,
    get_recommendations,
)


# ---------------------------------------------------------------------------
# Image generators
# ---------------------------------------------------------------------------

def make_image(
    width: int = 800,
    height: int = 1000,
    brightness: int = 140,
    saturation: float = 1.0,
    blur_radius: float = 0,
    noise_std: float = 20,
) -> Image.Image:
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    for c in range(3):
        base = brightness + (c - 1) * 15
        gradient = np.linspace(base - 30, base + 30, height).reshape(-1, 1)
        gradient = np.tile(gradient, (1, width))
        noise = np.random.normal(0, noise_std, (height, width))
        channel = np.clip(gradient + noise, 0, 255)
        arr[:, :, c] = channel.astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    if saturation != 1.0:
        pixels = np.array(img, dtype=np.float64) / 255.0
        gray = np.mean(pixels, axis=2, keepdims=True)
        pixels = gray + saturation * (pixels - gray)
        pixels = np.clip(pixels * 255, 0, 255).astype(np.uint8)
        img = Image.fromarray(pixels, "RGB")
    if blur_radius > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    return img


def save_temp(img: Image.Image, suffix: str = ".jpg") -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    img.save(path)
    return path


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

passed = 0
failed = 0
errors = []


def run(name: str, fn):
    global passed, failed
    try:
        start = time.time()
        fn()
        elapsed = time.time() - start
        print(f"  PASS  {name} ({elapsed:.2f}s)")
        passed += 1
    except Exception as e:
        elapsed = time.time() - start
        print(f"  FAIL  {name} ({elapsed:.2f}s): {e}")
        failed += 1
        errors.append((name, str(e)))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_well_lit_portrait():
    img = make_image(width=800, height=1066, brightness=130, saturation=1.2, noise_std=30)
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert isinstance(r, PhotoScore), "Should return PhotoScore"
        assert r.score > 0, f"Score should be positive, got {r.score}"
        assert r.lighting_score > 0, f"Lighting should score, got {r.lighting_score}"
        assert r.solo_score > 0, f"Solo should score for portrait, got {r.solo_score}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_dark_photo():
    img = make_image(brightness=40, noise_std=10)
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert r.lighting_score < 10, f"Dark photo lighting too high: {r.lighting_score}"
        tip_text = " ".join(r.tips).lower()
        assert any(w in tip_text for w in ["dark", "lighting", "light"]), f"No lighting tip: {r.tips}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_blurry_photo():
    img = make_image(blur_radius=10, noise_std=5)
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert r.face_score < 20, f"Blurry face_score too high: {r.face_score}"
        tip_text = " ".join(r.tips).lower()
        assert any(w in tip_text for w in ["blur", "sharp", "focus"]), f"No blur tip: {r.tips}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_landscape_photo():
    img = make_image(width=1200, height=800)
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert r.solo_score < 10, f"Landscape solo_score too high: {r.solo_score}"
        tip_text = " ".join(r.tips).lower()
        assert any(w in tip_text for w in ["landscape", "portrait", "crop"]), f"No landscape tip: {r.tips}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_desaturated_photo():
    img = make_image(saturation=0.1, noise_std=15)
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert r.smile_score < 15, f"Desaturated smile_score too high: {r.smile_score}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_vibrant_beats_dull():
    vibrant = make_image(saturation=1.3, brightness=130, noise_std=25)
    dull = make_image(saturation=0.2, brightness=130, noise_std=25)
    v_path = save_temp(vibrant)
    d_path = save_temp(dull)
    try:
        v = score_photo(v_path)
        d = score_photo(d_path)
        assert v.smile_score >= d.smile_score, \
            f"Vibrant ({v.smile_score}) should beat dull ({d.smile_score})"
    finally:
        Path(v_path).unlink(missing_ok=True)
        Path(d_path).unlink(missing_ok=True)


def test_washed_out_photo():
    img = make_image(brightness=230, noise_std=5)
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert r.lighting_score < 15, f"Washed out lighting too high: {r.lighting_score}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_score_ranges():
    img = make_image()
    path = save_temp(img)
    try:
        r = score_photo(path)
        assert 0 <= r.score <= 100, f"Total out of range: {r.score}"
        assert 0 <= r.face_score <= 30, f"Face out of range: {r.face_score}"
        assert 0 <= r.smile_score <= 20, f"Smile out of range: {r.smile_score}"
        assert 0 <= r.background_score <= 20, f"Background out of range: {r.background_score}"
        assert 0 <= r.lighting_score <= 15, f"Lighting out of range: {r.lighting_score}"
        assert 0 <= r.solo_score <= 15, f"Solo out of range: {r.solo_score}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_nonexistent_file():
    try:
        score_photo("/tmp/does_not_exist_12345.jpg")
        assert False, "Should have raised FileNotFoundError"
    except FileNotFoundError:
        pass


def test_png_format():
    img = make_image()
    path = save_temp(img, suffix=".png")
    try:
        r = score_photo(path)
        assert r.score > 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_webp_format():
    img = make_image()
    path = save_temp(img, suffix=".webp")
    try:
        r = score_photo(path)
        assert r.score > 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_ranking_order():
    good = make_image(brightness=130, saturation=1.2, noise_std=30, width=800, height=1066)
    bad = make_image(brightness=40, saturation=0.2, blur_radius=8, width=1200, height=800)
    g = save_temp(good)
    b = save_temp(bad)
    try:
        results = rank_photos([g, b])
        assert len(results) == 2
        assert results[0].rank == 1
        assert results[1].rank == 2
        assert results[0].score >= results[1].score
    finally:
        Path(g).unlink(missing_ok=True)
        Path(b).unlink(missing_ok=True)


def test_five_photos_ranking():
    paths = []
    try:
        for br in [40, 80, 120, 160, 200]:
            img = make_image(brightness=br, noise_std=20)
            paths.append(save_temp(img))
        results = rank_photos(paths)
        assert len(results) == 5
        ranks = sorted(r.rank for r in results)
        assert ranks == [1, 2, 3, 4, 5], f"Bad ranks: {ranks}"
        for i in range(len(results) - 1):
            assert results[i].score >= results[i + 1].score
    finally:
        for p in paths:
            Path(p).unlink(missing_ok=True)


def test_recommendations_empty():
    recs = get_recommendations([])
    assert any("upload" in r.lower() for r in recs)


def test_recommendations_low_score():
    bad = make_image(brightness=40, saturation=0.2, blur_radius=5)
    path = save_temp(bad)
    try:
        results = rank_photos([path])
        recs = get_recommendations(results)
        assert len(recs) > 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_contract():
    img = make_image()
    path = save_temp(img)
    try:
        r = score_photo(path)
        for attr in ["score", "face_score", "smile_score", "background_score",
                      "lighting_score", "solo_score", "tips"]:
            assert hasattr(r, attr), f"Missing attribute: {attr}"
        assert isinstance(r.tips, list)
        assert isinstance(r.score, (int, float))
    finally:
        Path(path).unlink(missing_ok=True)


def test_tips_are_strings():
    img = make_image(brightness=40)
    path = save_temp(img)
    try:
        r = score_photo(path)
        for tip in r.tips:
            assert isinstance(tip, str) and len(tip) > 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_scoring_speed():
    """Each photo should score in under 10 seconds (acceptance criteria)."""
    img = make_image(width=1600, height=2000)  # larger image
    path = save_temp(img)
    try:
        start = time.time()
        score_photo(path)
        elapsed = time.time() - start
        assert elapsed < 10, f"Scoring took {elapsed:.1f}s, exceeds 10s limit"
    finally:
        Path(path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("DOGFOOD: Photo Scorer — PERS-212")
    print("=" * 60)
    print()

    tests = [
        ("Well-lit portrait scores high", test_well_lit_portrait),
        ("Dark photo gets lighting tip", test_dark_photo),
        ("Blurry photo gets sharpness tip", test_blurry_photo),
        ("Landscape photo penalized", test_landscape_photo),
        ("Desaturated photo penalized", test_desaturated_photo),
        ("Vibrant beats dull", test_vibrant_beats_dull),
        ("Washed out photo penalized", test_washed_out_photo),
        ("Score ranges valid (0-100)", test_score_ranges),
        ("Non-existent file raises error", test_nonexistent_file),
        ("PNG format works", test_png_format),
        ("WebP format works", test_webp_format),
        ("Ranking order correct", test_ranking_order),
        ("5 photos get unique ranks", test_five_photos_ranking),
        ("Empty recommendations", test_recommendations_empty),
        ("Low score recommendations", test_recommendations_low_score),
        ("API contract fulfilled", test_api_contract),
        ("Tips are non-empty strings", test_tips_are_strings),
        ("Scoring speed < 10s", test_scoring_speed),
    ]

    start_all = time.time()
    for name, fn in tests:
        run(name, fn)

    total_time = time.time() - start_all
    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed ({total_time:.1f}s)")
    print("=" * 60)

    if errors:
        print("\nFailures:")
        for name, err in errors:
            print(f"  - {name}: {err}")

    # Print detailed score report for a "good" vs "bad" photo comparison
    print("\n" + "=" * 60)
    print("DETAILED SCORE COMPARISON")
    print("=" * 60)

    good_img = make_image(width=800, height=1066, brightness=130, saturation=1.2, noise_std=30)
    bad_img = make_image(width=1200, height=800, brightness=40, saturation=0.2, blur_radius=8, noise_std=5)
    ok_img = make_image(width=900, height=900, brightness=160, saturation=0.8, noise_std=15)

    g = save_temp(good_img)
    b = save_temp(bad_img)
    o = save_temp(ok_img)

    try:
        results = rank_photos([g, b, o])
        for r in results:
            label = {g: "GOOD (portrait, vibrant, sharp)", b: "BAD (landscape, dark, blurry)",
                     o: "OK (square, slightly bright)"}
            print(f"\n  {label.get(r.path, r.path)}")
            print(f"    Rank: #{r.rank}  |  Total: {r.score}/100")
            print(f"    Face: {r.face_score}/30  Smile: {r.smile_score}/20  "
                  f"BG: {r.background_score}/20  Light: {r.lighting_score}/15  Solo: {r.solo_score}/15")
            print(f"    Tips: {'; '.join(r.tips)}")

        print("\n  Recommendations:")
        for rec in get_recommendations(results):
            print(f"    - {rec}")
    finally:
        Path(g).unlink(missing_ok=True)
        Path(b).unlink(missing_ok=True)
        Path(o).unlink(missing_ok=True)

    sys.exit(1 if failed else 0)
