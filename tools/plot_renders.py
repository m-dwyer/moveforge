#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
import wave
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Missing plotting dependency. Run: make dev-deps"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
PRESETS = ROOT / "src" / "modules" / "westfold" / "presets.json"
RENDER_DIR = ROOT / "renders" / "westfold-suite"
OUT_DIR = ROOT / "renders" / "plots"

W = 1400
H = 720
MARGIN_L = 72
MARGIN_R = 32
TOP = 70
WAVE_H = 260
SPEC_TOP = 410
SPEC_H = 230

BG = (18, 18, 16)
PANEL = (28, 29, 25)
GRID = (66, 68, 60)
TEXT = (238, 238, 229)
MUTED = (166, 166, 150)
ACCENT = (158, 228, 147)
WARN = (244, 191, 117)


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
    draw.text((box[0] + 14, box[1] + 10), title, fill=TEXT, font=font(18))


def map_x(i: np.ndarray, count: int, x0: int, x1: int) -> np.ndarray:
    return x0 + (i / max(1, count - 1)) * (x1 - x0)


def draw_waveform(draw: ImageDraw.ImageDraw, audio: np.ndarray, sample_rate: int) -> None:
    box = (34, TOP, W - 34, TOP + WAVE_H)
    draw_panel(draw, box, "Waveform")
    x0, y0, x1, y1 = MARGIN_L, TOP + 52, W - MARGIN_R, TOP + WAVE_H - 28
    mid = (y0 + y1) / 2
    amp = (y1 - y0) / 2

    for frac in (0.25, 0.5, 0.75):
        y = int(y0 + frac * (y1 - y0))
        draw.line((x0, y, x1, y), fill=GRID)
    draw.line((x0, int(mid), x1, int(mid)), fill=(94, 96, 84))

    bins = min(2200, len(audio))
    edges = np.linspace(0, len(audio), bins + 1).astype(int)
    points: list[tuple[float, float]] = []
    for b in range(bins):
        chunk = audio[edges[b]:edges[b + 1]]
        if len(chunk) == 0:
            continue
        x = x0 + (b / max(1, bins - 1)) * (x1 - x0)
        points.append((x, mid - float(np.max(chunk)) * amp))
        points.append((x, mid - float(np.min(chunk)) * amp))
    if len(points) > 1:
        draw.line(points, fill=ACCENT, width=1)

    duration = len(audio) / sample_rate
    draw.text((x0, y1 + 8), "0.0s", fill=MUTED, font=font(13))
    draw.text((x1 - 58, y1 + 8), f"{duration:.1f}s", fill=MUTED, font=font(13))
    draw.text((x0, y0 - 20), f"peak {np.max(np.abs(audio)):.3f}", fill=WARN, font=font(13))


def draw_spectrum(draw: ImageDraw.ImageDraw, audio: np.ndarray, sample_rate: int) -> None:
    box = (34, SPEC_TOP, W - 34, SPEC_TOP + SPEC_H)
    draw_panel(draw, box, "Spectrum")
    x0, y0, x1, y1 = MARGIN_L, SPEC_TOP + 52, W - MARGIN_R, SPEC_TOP + SPEC_H - 28
    segment = audio[: min(len(audio), sample_rate * 4)]
    if len(segment) < 64:
        return
    window = np.hanning(len(segment))
    spectrum = np.fft.rfft(segment * window)
    freqs = np.fft.rfftfreq(len(segment), 1.0 / sample_rate)
    mag = 20.0 * np.log10(np.maximum(np.abs(spectrum), 1e-9))

    f_min = 20.0
    f_max = sample_rate / 2.0
    db_min = float(max(-100.0, np.percentile(mag, 10) - 8))
    db_max = float(np.max(mag) + 3)

    for hz in (50, 100, 200, 500, 1000, 2000, 5000, 10000):
        if hz < f_max:
            x = x0 + (math.log10(hz) - math.log10(f_min)) / (math.log10(f_max) - math.log10(f_min)) * (x1 - x0)
            draw.line((x, y0, x, y1), fill=GRID)
            draw.text((x - 12, y1 + 8), f"{hz//1000}k" if hz >= 1000 else str(hz), fill=MUTED, font=font(11))

    for frac in (0.25, 0.5, 0.75):
        y = y0 + frac * (y1 - y0)
        draw.line((x0, y, x1, y), fill=GRID)

    valid = freqs >= f_min
    xs = x0 + (np.log10(freqs[valid]) - math.log10(f_min)) / (math.log10(f_max) - math.log10(f_min)) * (x1 - x0)
    ys = y1 - (mag[valid] - db_min) / max(1e-6, db_max - db_min) * (y1 - y0)
    points = list(zip(xs.astype(float), ys.astype(float)))
    if len(points) > 1:
        draw.line(points, fill=ACCENT, width=1)

    draw.text((x0, y0 - 20), f"{db_min:.0f} to {db_max:.0f} dB", fill=WARN, font=font(13))


def plot_file(path: Path, label: str, out_path: Path) -> None:
    sample_rate, audio = read_wav(path)
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    draw.text((34, 22), label, fill=TEXT, font=font(28))
    draw.text((W - 320, 30), path.name, fill=MUTED, font=font(14))
    draw_waveform(draw, audio, sample_rate)
    draw_spectrum(draw, audio, sample_rate)
    image.save(out_path)


def main() -> int:
    data = json.loads(PRESETS.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    wrote = 0
    for preset in data["presets"]:
        render = preset.get("render")
        if not render:
            continue
        wav_path = RENDER_DIR / render["file"]
        if not wav_path.exists():
            print(f"missing render: {wav_path}", file=sys.stderr)
            return 1
        out_path = OUT_DIR / f"{wav_path.stem}.png"
        plot_file(wav_path, preset["name"], out_path)
        print(f"Wrote {out_path}")
        wrote += 1

    if wrote == 0:
        print("no render entries found", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
