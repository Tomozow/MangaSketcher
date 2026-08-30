"""Step 6: Version-specific info + extras.

- Scan the whole .clip binary for version-looking ASCII strings.
- Dump SQLite PRAGMAs (user_version, application_id, page size).
- Export CanvasPreview PNG to canvas_preview.png.
- Confirm TextLayerAddAttributesV01 header ([total u32 LE][TLV...]).
- Decode the floating text-cache Offscreen sizes vs TextLayerAttributes id=63.

Output: 06_output.txt (UTF-8), canvas_preview.png

Usage: python 06_version_scan.py
"""
from __future__ import annotations

import re
import sqlite3
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"
CLIP = HERE.parent / "export_sample.clip"
OUT = HERE / "06_output.txt"
PNG_OUT = HERE / "canvas_preview.png"

lines: list[str] = []


def w(s: str = "") -> None:
    lines.append(s)


def main() -> None:
    data = CLIP.read_bytes()

    w("=== version-like ASCII strings in whole .clip ===")
    seen = set()
    for m in re.finditer(rb"[\x20-\x7e]{4,}", data):
        s = m.group().decode("ascii")
        if re.search(r"\d+\.\d+(\.\d+)?", s) and s not in seen:
            seen.add(s)
            w(f"  @{m.start():7d}: {s!r}")
    w()

    w("=== SQLite header PRAGMAs ===")
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    for pragma in ("user_version", "application_id", "page_size", "encoding", "schema_version"):
        v = conn.execute(f"PRAGMA {pragma}").fetchone()[0]
        w(f"  {pragma} = {v}")
    w()

    # sqlite file header bytes 96..100 hold SQLITE_VERSION_NUMBER of writer
    sq = DB.read_bytes()
    write_ver = struct.unpack_from(">I", sq, 96)[0]
    w(f"  sqlite writer version number (hdr offset 96): {write_ver} "
      f"-> {write_ver//1000000}.{write_ver//1000%1000}.{write_ver%1000}")
    w()

    w("=== CanvasPreview -> PNG export ===")
    row = conn.execute("SELECT ImageType, ImageWidth, ImageHeight, ImageData FROM CanvasPreview").fetchone()
    blob = row["ImageData"]
    w(f"  ImageType={row['ImageType']} {row['ImageWidth']}x{row['ImageHeight']} blob={len(blob)}B magic={blob[:8].hex()}")
    PNG_OUT.write_bytes(blob)
    w(f"  written: {PNG_OUT.name}")
    w()

    w("=== TextLayerAddAttributesV01 header check ===")
    for r in conn.execute("SELECT MainId, TextLayerAddAttributesV01 AS b FROM Layer WHERE b IS NOT NULL"):
        blob = r["b"]
        total = struct.unpack_from("<I", blob, 0)[0]
        w(f"  Layer {r['MainId']}: blob {len(blob)}B, u32[0]={total} (== len-4: {total == len(blob) - 4})")
    w()

    w("=== text cache offscreens vs TextLayerAttributes id=63 ===")
    for r in conn.execute(
        "SELECT o.MainId AS oid, o.LayerId AS lid, o.Attribute AS attr, l.LayerName AS name "
        "FROM Offscreen o JOIN Layer l ON l.MainId=o.LayerId "
        "WHERE o.MainId NOT IN (SELECT Offscreen FROM MipmapInfo) "
        "AND o.MainId NOT IN (SELECT ThumbnailOffscreen FROM LayerThumbnail)"
    ):
        attr = r["attr"]
        nlen = struct.unpack_from(">I", attr, 16)[0]
        poff = 20 + nlen * 2
        wdt, hgt = struct.unpack_from(">2I", attr, poff)
        w(f"  floating Offscreen {r['oid']} (layer {r['lid']} {r['name']!r}): {wdt}x{hgt}")

    conn.close()
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
