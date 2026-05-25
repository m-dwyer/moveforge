#!/usr/bin/env python3
"""
Render a 3-panel diff image for a single suite WAV that drifted vs its golden.

Top panel:    golden waveform + current waveform overlaid (different colors)
Middle panel: diff waveform (current - golden), normalized for visibility
Bottom panel: spectrum overlay (golden vs current) so you can see which
              frequency bands moved

Usage:
    render_diff.py --golden goldens/<id>/<file>.wav \\
                   --current renders/<id>-suite/<file>.wav \\
                   --out renders/plots/<id>/<file>.diff.png

Exit non-zero on any failure. Caller (scripts/check-renders.ts) ignores the
exit code so a missing PIL/numpy install doesn't break the check itself.
"""
from __future__ import annotations

import argparse
import math
import sys
import wave
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ModuleNotFoundError as exc:
    raise SystemExit(f"missing plotting dependency: {exc}. Run: mise run setup")


W = 1400
H = 900
TOP = 70
PANEL_H = 240

BG = (18, 18, 16)
PANEL = (28, 29, 25)
GRID = (66, 68, 60)
TEXT = (238, 238, 229)
MUTED = (166, 166, 150)
GOLDEN = (158, 228, 147)
CURRENT = (244, 191, 117)
DIFF = (227, 134, 167)


def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("Menlo.ttc", size)
    except OSError:
        return ImageFont.load_default()


def read_wav(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM")
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels)[:, 0]
    return sample_rate, audio


def draw_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str) -> None:
    draw.rounded_rectangle(box, radius=8, fill=PANEL, outline=GRID)
    draw.text((box[0] + 14, box[1] + 10), title, fill=TEXT, font=font(16))


def downsample_envelope(audio: np.ndarray, target: int) -> tuple[np.ndarray, np.ndarray]:
    bins = min(target, len(audio))
    edges = np.linspace(0, len(audio), bins + 1).astype(int)
    mins = np.zeros(bins, dtype=np.float32)
    maxs = np.zeros(bins, dtype=np.float32)
    for b in range(bins):
        chunk = audio[edges[b]:edges[b + 1]]
        if len(chunk) == 0:
            continue
        mins[b] = float(np.min(chunk))
        maxs[b] = float(np.max(chunk))
    return mins, maxs


def draw_waveform_overlay(draw: ImageDraw.ImageDraw, top: int, golden: np.ndarray, current: np.ndarray) -> None:
    box = (34, top, W - 34, top + PANEL_H)
    draw_panel(draw, box, "Waveform — golden (green) vs current (orange)")
    x0, y0, x1, y1 = 72, top + 42, W - 34, top + PANEL_H - 28
    mid = (y0 + y1) / 2
    amp = (y1 - y0) / 2
    draw.line((x0, mid, x1, mid), fill=(94, 96, 84))

    bins = 1200
    g_mins, g_maxs = downsample_envelope(golden, bins)
    c_mins, c_maxs = downsample_envelope(current, bins)
    for i in range(bins):
        x = x0 + (i / max(1, bins - 1)) * (x1 - x0)
        ya0 = mid - g_maxs[i] * amp
        ya1 = mid - g_mins[i] * amp
        draw.line((x, ya0, x, ya1), fill=GOLDEN, width=1)
        yb0 = mid - c_maxs[i] * amp
        yb1 = mid - c_mins[i] * amp
        draw.line((x + 0.6, yb0, x + 0.6, yb1), fill=CURRENT, width=1)

    g_peak = float(np.max(np.abs(golden)))
    c_peak = float(np.max(np.abs(current)))
    draw.text((x0, y0 - 18), f"golden peak {g_peak:.3f} | current peak {c_peak:.3f}", fill=MUTED, font=font(12))


def draw_diff_waveform(draw: ImageDraw.ImageDraw, top: int, diff: np.ndarray) -> None:
    box = (34, top, W - 34, top + PANEL_H)
    diff_peak = float(np.max(np.abs(diff)) or 1e-9)
    norm = float(min(1.0, diff_peak))
    title = f"Diff (current − golden) | peak {diff_peak:.5f} (norm × {1.0 / max(norm, 1e-9):.1f})"
    draw_panel(draw, box, title)
    x0, y0, x1, y1 = 72, top + 42, W - 34, top + PANEL_H - 28
    mid = (y0 + y1) / 2
    amp = (y1 - y0) / 2
    draw.line((x0, mid, x1, mid), fill=(94, 96, 84))
    bins = 1200
    scaled = diff / max(diff_peak, 1e-9)
    mins, maxs = downsample_envelope(scaled, bins)
    for i in range(bins):
        x = x0 + (i / max(1, bins - 1)) * (x1 - x0)
        ya0 = mid - maxs[i] * amp
        ya1 = mid - mins[i] * amp
        draw.line((x, ya0, x, ya1), fill=DIFF, width=1)


def draw_spectrum_overlay(draw: ImageDraw.ImageDraw, top: int, golden: np.ndarray, current: np.ndarray, sample_rate: int) -> None:
    box = (34, top, W - 34, top + PANEL_H)
    draw_panel(draw, box, "Spectrum overlay — golden (green) vs current (orange)")
    x0, y0, x1, y1 = 72, top + 42, W - 34, top + PANEL_H - 28

    segment_len = min(len(golden), len(current), sample_rate * 4)
    if segment_len < 64:
        return
    g_seg = golden[:segment_len]
    c_seg = current[:segment_len]
    window = np.hanning(segment_len)
    g_spec = 20.0 * np.log10(np.maximum(np.abs(np.fft.rfft(g_seg * window)), 1e-9))
    c_spec = 20.0 * np.log10(np.maximum(np.abs(np.fft.rfft(c_seg * window)), 1e-9))
    freqs = np.fft.rfftfreq(segment_len, 1.0 / sample_rate)

    f_min, f_max = 20.0, sample_rate / 2.0
    db_min = float(max(-100.0, np.percentile(np.minimum(g_spec, c_spec), 10) - 8))
    db_max = float(max(np.max(g_spec), np.max(c_spec)) + 3)

    for hz in (50, 100, 200, 500, 1000, 2000, 5000, 10000):
        if hz < f_max:
            x = x0 + (math.log10(hz) - math.log10(f_min)) / (math.log10(f_max) - math.log10(f_min)) * (x1 - x0)
            draw.line((x, y0, x, y1), fill=GRID)
            draw.text((x - 12, y1 + 8), f"{hz//1000}k" if hz >= 1000 else str(hz), fill=MUTED, font=font(10))

    valid = freqs >= f_min
    xs = x0 + (np.log10(freqs[valid]) - math.log10(f_min)) / (math.log10(f_max) - math.log10(f_min)) * (x1 - x0)
    g_ys = y1 - (g_spec[valid] - db_min) / max(1e-6, db_max - db_min) * (y1 - y0)
    c_ys = y1 - (c_spec[valid] - db_min) / max(1e-6, db_max - db_min) * (y1 - y0)
    draw.line(list(zip(xs.astype(float), g_ys.astype(float))), fill=GOLDEN, width=1)
    draw.line(list(zip(xs.astype(float), c_ys.astype(float))), fill=CURRENT, width=1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", required=True, type=Path)
    parser.add_argument("--current", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    if not args.golden.exists():
        print(f"golden missing: {args.golden}", file=sys.stderr)
        return 1
    if not args.current.exists():
        print(f"current missing: {args.current}", file=sys.stderr)
        return 1

    g_sr, g_audio = read_wav(args.golden)
    c_sr, c_audio = read_wav(args.current)
    if g_sr != c_sr:
        print(f"sample-rate mismatch: golden={g_sr} current={c_sr}", file=sys.stderr)
        return 1
    n = min(len(g_audio), len(c_audio))
    g_audio = g_audio[:n]
    c_audio = c_audio[:n]
    diff = c_audio - g_audio

    args.out.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    label = args.label or args.current.name
    draw.text((34, 22), label, fill=TEXT, font=font(24))
    draw.text((W - 360, 30), f"{args.golden.name} vs {args.current.name}", fill=MUTED, font=font(12))

    draw_waveform_overlay(draw, TOP, g_audio, c_audio)
    draw_diff_waveform(draw, TOP + PANEL_H + 18, diff)
    draw_spectrum_overlay(draw, TOP + 2 * (PANEL_H + 18), g_audio, c_audio, g_sr)
    image.save(args.out)
    print(f"Wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
