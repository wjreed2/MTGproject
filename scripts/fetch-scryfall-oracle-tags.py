#!/usr/bin/env python3
"""Download Scryfall oracle_tags bulk JSON into data/scryfall/oracle-tags.json."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

BULK_INDEX = "https://api.scryfall.com/bulk-data"
UA = "MTGArchive/1.0 (archetype-tag-map)"


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/scryfall/oracle-tags.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(BULK_INDEX, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        index = json.load(resp)
    item = next(x for x in index["data"] if x["type"] == "oracle_tags")
    print(f"Downloading {item['download_uri']} ({item.get('size')} bytes, updated {item.get('updated_at')})")
    req2 = urllib.request.Request(item["download_uri"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req2, timeout=300) as resp:
        data = resp.read()
    out.write_bytes(data)
    tags = json.loads(data)
    print(f"Wrote {len(tags)} tags → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
