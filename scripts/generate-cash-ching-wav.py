#!/usr/bin/env python3
"""One-shot: write sounds/cash-ching.wav — short register-style ka-ching (synthesized, no external assets)."""
from __future__ import annotations

import math
import os
import random
import struct
import wave

SR = 44100
DURATION = 0.58
N = int(SR * DURATION)
buf = [0.0] * N


def add_tone(start_sec: float, dur: float, freq: float, amp: float, decay: float = 8.0) -> None:
    i0 = int(start_sec * SR)
    n = int(dur * SR)
    for i in range(n):
        idx = i0 + i
        if idx >= N:
            break
        t = i / SR
        env = math.exp(-decay * t)
        v = amp * env * (
            0.55 * math.sin(2 * math.pi * freq * t)
            + 0.35 * math.sin(2 * math.pi * freq * 1.008 * t)
            + 0.1 * math.sin(2 * math.pi * freq * 2.01 * t)
        )
        buf[idx] += v


def add_click(start_sec: float, dur: float, freq: float, amp: float) -> None:
    i0 = int(start_sec * SR)
    n = int(dur * SR)
    for i in range(n):
        idx = i0 + i
        if idx >= N:
            break
        t = i / SR
        env = math.exp(-55 * t)
        buf[idx] += amp * env * math.sin(2 * math.pi * freq * t)


def add_noise(start_sec: float, dur: float, amp: float) -> None:
    i0 = int(start_sec * SR)
    n = int(dur * SR)
    for i in range(n):
        idx = i0 + i
        if idx >= N:
            break
        t = i / SR
        env = math.exp(-32 * t) * max(0.0, 1.0 - t / max(dur, 1e-6))
        buf[idx] += amp * env * (random.random() * 2 - 1)


random.seed(42)
# Drawer / low "cha"
add_tone(0.0, 0.085, 88, 0.42, 22)
add_noise(0.0, 0.05, 0.14)
add_click(0.038, 0.04, 540, 0.22)
add_click(0.05, 0.035, 720, 0.18)
# Bright "ching" (bell-like partials)
add_tone(0.1, 0.28, 1760, 0.5, 7.5)
add_tone(0.1, 0.22, 2240, 0.32, 9.0)
add_tone(0.115, 0.2, 3020, 0.2, 12.0)
# Coin / till scatter
for k in range(7):
    add_click(
        0.21 + k * 0.026 + random.random() * 0.012,
        0.035,
        2100 + random.randint(0, 650),
        0.055 + random.random() * 0.035,
    )
add_tone(0.34, 0.16, 1580, 0.1, 18.0)

peak = max(abs(x) for x in buf) or 1.0
buf = [x / peak * 0.9 for x in buf]

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root, "sounds")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "cash-ching.wav")

with wave.open(out_path, "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    for x in buf:
        s = int(max(-32767, min(32767, x * 32767)))
        w.writeframes(struct.pack("<h", s))

print("Wrote", out_path)
