#!/usr/bin/env python3
"""Verify that every Exact Tagger Tag in a CSV resolves to a real Scryfall oracle tag.

Exit 0 if all tags resolve (exact slug or normalized alias). Exit 1 otherwise.

Usage:
  python3 scripts/verify-archetype-scryfall-tags.py \\
    --oracle-tags data/scryfall/oracle-tags.json \\
    --csv data/archetype-scryfall-tags/archetype-scryfall-tags.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--oracle-tags", type=Path, required=True)
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument("--tag-column", default="Exact Tagger Tag")
    args = ap.parse_args()

    tags = json.loads(args.oracle_tags.read_text())
    by_slug = {t["slug"] for t in tags}
    by_norm: dict[str, str] = {}
    for t in tags:
        by_norm.setdefault(norm(t["slug"]), t["slug"])
        for a in t.get("aliases") or []:
            by_norm.setdefault(norm(a), t["slug"])

    misses = []
    total = 0
    with args.csv.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tag = (row.get(args.tag_column) or "").strip()
            if not tag:
                continue
            total += 1
            if tag in by_slug:
                continue
            if norm(tag) in by_norm:
                continue
            misses.append(tag)

    if misses:
        uniq = sorted(set(misses))
        print(f"FAIL: {len(misses)}/{total} tags unresolved ({len(uniq)} unique)", file=sys.stderr)
        for t in uniq[:50]:
            print(f"  MISS {t}", file=sys.stderr)
        if len(uniq) > 50:
            print(f"  ... and {len(uniq) - 50} more", file=sys.stderr)
        return 1

    print(f"OK: {total} tags resolve against {len(by_slug)} oracle tags")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
