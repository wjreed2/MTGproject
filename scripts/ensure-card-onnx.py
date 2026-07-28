#!/usr/bin/env python3
"""Download playing-cards YOLOv8 weights (Hugging Face) and export ONNX if missing."""
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "vendor")
ONNX_PATH = os.path.join(VENDOR, "playing_cards_yolov8.onnx")
PT_URL = "https://huggingface.co/mustafakemal0146/playing-cards-yolov8/resolve/main/playing_cards_model_0_playing-cards-colab.pt"
PT_PATH = os.path.join(VENDOR, "playing_cards_yolov8.pt")


def main():
    os.makedirs(VENDOR, exist_ok=True)
    if os.path.isfile(ONNX_PATH) and os.path.getsize(ONNX_PATH) > 1_000_000:
        print("Card ONNX already present:", ONNX_PATH)
        return 0
    try:
        from ultralytics import YOLO
    except ImportError:
        print(
            "Install the pinned build deps to generate the card detector ONNX:\n"
            "  pip install -r scripts/requirements.txt\n"
            "  python3 scripts/ensure-card-onnx.py",
            file=sys.stderr,
        )
        return 1
    if not os.path.isfile(PT_PATH) or os.path.getsize(PT_PATH) < 1_000_000:
        print("Downloading weights…")
        urllib.request.urlretrieve(PT_URL, PT_PATH)
    print("Exporting ONNX (one-time)…")
    m = YOLO(PT_PATH)
    out = m.export(format="onnx", imgsz=640, simplify=True, opset=12)
    print("Wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
