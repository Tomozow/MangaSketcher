#!/usr/bin/env python3
"""Cleanliness validation for clip-export-template.clip.

- Forbidden string scan (UTF-8 / UTF-16LE / UTF-16BE)
- Decode all CHNKExta bodies to PNG via ClipMerger
- Pixel checks: page-number white-out rect is pure white; inner frame preserved; lineart sample is transparent

Usage: python validate_clean.py <clip> [review_dir]
"""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path

CLIPMERGER = Path("A:/dev/ClipMerger")
if str(CLIPMERGER) not in sys.path:
    sys.path.insert(0, str(CLIPMERGER))

from clip_raster import decode_color_offscreen, parse_attribute_param  # noqa: E402

FORBIDDEN = ["あいうえお", "こんにちは", "さようなら", "てすと", "クローン"]
CANVAS_W = 1518
CANVAS_H = 2150
# Exclusive pixel rect — must match tools/clip-template/helpers.ts PAGE_NUMBER_PIXEL_RECT
PAGE_RECT = {
    "left": 760,
    "top": 1884,
    "right": 792,
    "bottom": 1932,
}
# Inner-frame hairline above the digit; white-out must not erase it.
INNER_FRAME_SAMPLE = (759, 1868)
LINEART_OFFSCREEN_ID = 48
PAGE_OFFSCREEN_ID = 5


def parse_chunks(data: bytes) -> list[dict]:
    _, first_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict] = []
    off = first_off
    n = len(data)
    while off < n:
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        data_off = off + 16
        rec = {"name": name, "data_offset": data_off, "data_length": length}
        if name == "CHNKExta":
            payload = data[data_off : data_off + length]
            idlen = struct.unpack_from(">Q", payload, 0)[0]
            rec["exta_id"] = payload[8 : 8 + idlen].decode("ascii")
            body_len = struct.unpack_from(">Q", payload, 8 + idlen)[0]
            body_off = 16 + idlen
            rec["exta_body"] = payload[body_off : body_off + body_len]
        chunks.append(rec)
        off = data_off + length
    return chunks


def scan_forbidden(data: bytes) -> dict[str, int]:
    counts: dict[str, int] = {s: 0 for s in FORBIDDEN}
    for enc in ("utf-8", "utf-16-le", "utf-16-be"):
        try:
            text = data.decode(enc, errors="ignore")
        except LookupError:
            continue
        for s in FORBIDDEN:
            counts[s] += text.count(s)
    return counts


def chunk_breakdown(data: bytes) -> dict[str, int]:
    _, first_off = struct.unpack_from(">QQ", data, 8)
    out: dict[str, int] = {"header": first_off}
    off = first_off
    while off < len(data):
        name = data[off : off + 8].decode("ascii").rstrip("\0")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        out[name] = out.get(name, 0) + 16 + length
        off += 16 + length
    out["total"] = len(data)
    return out


def validate(path: Path, review_dir: Path) -> dict:
    data = path.read_bytes()
    result: dict = {
        "path": str(path),
        "file_size": len(data),
        "chunk_breakdown": chunk_breakdown(data),
        "ok": True,
    }

    forbidden_counts = scan_forbidden(data)
    result["forbidden_string_counts"] = forbidden_counts
    if any(v > 0 for v in forbidden_counts.values()):
        result["ok"] = False
        result["errors"] = [f"forbidden strings found: {forbidden_counts}"]

    chunks = parse_chunks(data)
    extas = [(c["exta_id"], c["exta_body"]) for c in chunks if c.get("exta_id")]
    sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
    sqlite_bytes = data[sqli["data_offset"] : sqli["data_offset"] + sqli["data_length"]]

    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp)
        off_attrs: dict[int, tuple[int, int, int, int]] = {}
        for row in conn.execute("SELECT MainId, Attribute FROM Offscreen"):
            mid, attr = row
            try:
                w, h, gw, gh = parse_attribute_param(attr)[:4]
                off_attrs[int(mid)] = (w, h, gw, gh)
            except ValueError:
                pass
        conn.close()
    finally:
        Path(tmp).unlink(missing_ok=True)

    off_by_eid = map_offscreen_ids(sqlite_bytes)

    review_dir.mkdir(parents=True, exist_ok=True)
    decoded: list[dict] = []
    for eid, body in extas:
        off_id = off_by_eid.get(eid)
        dims = off_attrs.get(off_id or -1)
        png_path = review_dir / f"{eid}.png"
        entry = {"external_id": eid, "offscreen_main_id": off_id, "body_bytes": len(body)}
        if dims:
            w, h, gw, gh = dims
            img = decode_color_offscreen(body, w, h, gw, gh)
            img.save(png_path)
            entry["png"] = str(png_path)
            entry["size"] = [w, h]
        else:
            entry["png"] = None
        decoded.append(entry)
    result["decoded_extas"] = decoded

    pixel_checks: dict[str, object] = {}
    page_png = review_dir / next(
        (d["external_id"] + ".png" for d in decoded if d.get("offscreen_main_id") == PAGE_OFFSCREEN_ID),
        "",
    )
    line_png = review_dir / next(
        (d["external_id"] + ".png" for d in decoded if d.get("offscreen_main_id") == LINEART_OFFSCREEN_ID),
        "",
    )

    if page_png.is_file():
        from PIL import Image

        img = Image.open(page_png).convert("RGBA")
        cx = (PAGE_RECT["left"] + PAGE_RECT["right"]) // 2
        cy = (PAGE_RECT["top"] + PAGE_RECT["bottom"]) // 2
        samples = {
            "page_number_center": (cx, cy),
            "page_number_ink": (775, 1907),
        }
        for name, (x, y) in samples.items():
            r, g, b, a = img.getpixel((x, y))
            ok = r == g == b == a == 255
            pixel_checks[name] = {"xy": [x, y], "rgba": [r, g, b, a], "ok": ok}
            if not ok:
                result["ok"] = False

        non_white = 0
        for y in range(PAGE_RECT["top"], PAGE_RECT["bottom"]):
            for x in range(PAGE_RECT["left"], PAGE_RECT["right"]):
                r, g, b, a = img.getpixel((x, y))
                if r != 255 or g != 255 or b != 255 or a != 255:
                    non_white += 1
        pixel_checks["page_number_rect_all_white"] = {
            "rect": PAGE_RECT,
            "non_white": non_white,
            "ok": non_white == 0,
        }
        if non_white:
            result["ok"] = False

        fx, fy = INNER_FRAME_SAMPLE
        r, g, b, a = img.getpixel((fx, fy))
        frame_ok = not (r == g == b == a == 255)
        pixel_checks["inner_frame_preserved"] = {
            "xy": [fx, fy],
            "rgba": [r, g, b, a],
            "ok": frame_ok,
        }
        if not frame_ok:
            result["ok"] = False

    if line_png.is_file():
        from PIL import Image

        img = Image.open(line_png).convert("RGBA")
        sx, sy = CANVAS_W // 2, CANVAS_H // 2
        r, g, b, a = img.getpixel((sx, sy))
        pixel_checks["lineart_center"] = {
            "xy": [sx, sy],
            "rgba": [r, g, b, a],
            "ok": a == 0,
        }
        if a != 0:
            result["ok"] = False

    result["pixel_checks"] = pixel_checks
    return result


def map_offscreen_ids(sqlite_bytes: bytes) -> dict[str, int]:
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp)
        out: dict[str, int] = {}
        for row in conn.execute("SELECT MainId, BlockData FROM Offscreen"):
            mid, block = row
            if not block:
                continue
            bid = block.decode("ascii").replace("\0", "").strip()
            if bid:
                out[bid] = int(mid)
        conn.close()
        return out
    finally:
        Path(tmp).unlink(missing_ok=True)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python validate_clean.py <clip> [review_dir]", file=sys.stderr)
        return 2
    clip = Path(sys.argv[1])
    review = Path(sys.argv[2]) if len(sys.argv) > 2 else clip.parent / "template_review"
    result = validate(clip, review)
    out_json = review.parent / "template_clean_report.json"
    out_json.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    status = "PASS" if result["ok"] else "FAIL"
    print(f"[{status}] {clip.name}")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
