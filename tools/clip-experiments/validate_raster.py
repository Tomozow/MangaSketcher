"""Cross-validate E5 lineart raster replacement using ClipMerger decode.

Checks:
(a) Sample pixel match vs procedural E5 test image
(b) BlockCheckSum Adler-32 consistency
(c) Offscreen.Attribute w/h/grid/BlockSize consistency

Usage: python validate_raster.py [E5 clip path]
"""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import tempfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CLIPMERGER = Path("A:/dev/ClipMerger")
DEFAULT_E5 = ROOT / "sample" / "_experiments" / "E5_lineart_replaced.clip"
OUT_DIR = ROOT / "sample" / "_experiments"

LINEART_OFFSCREEN_ID = 48
LINEART_WIDTH = 1518
LINEART_HEIGHT = 2150
LINEART_GRID_W = 6
LINEART_GRID_H = 9

BEGIN_LABEL = "BlockDataBeginChunk"
END_LABEL = "BlockDataEndChunk"
CHECK_LABEL = "BlockCheckSum"
TILE = 256


def generate_e5_test_image(width: int, height: int) -> list[tuple[int, int, int, int]]:
    """Return list of (x, y, r, g, b, a) for non-transparent pixels — mirrors TS generateE5TestImage."""
    pixels: dict[tuple[int, int], tuple[int, int, int, int]] = {}

    def set_pixel(x: int, y: int, r: int, g: int, b: int, a: int) -> None:
        if 0 <= x < width and 0 <= y < height:
            pixels[(x, y)] = (r, g, b, a)

    def draw_thick_line(x0: int, y0: int, x1: int, y1: int, thickness: int) -> None:
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for s in range(steps + 1):
            t = s / steps
            x = round(x0 + (x1 - x0) * t)
            y = round(y0 + (y1 - y0) * t)
            for dy in range(-thickness, thickness + 1):
                for dx in range(-thickness, thickness + 1):
                    if dx * dx + dy * dy <= thickness * thickness:
                        set_pixel(x + dx, y + dy, 0, 0, 0, 255)

    draw_thick_line(0, 0, width - 1, height - 1, 2)
    draw_thick_line(0, height - 1, width - 1, 0, 2)

    cx = width / 2
    cy = height / 2
    radius = min(width, height) * 0.3
    r2 = radius * radius
    for y in range(height):
        for x in range(width):
            dx = x - cx
            dy = y - cy
            if dx * dx + dy * dy <= r2:
                set_pixel(x, y, 0, 0, 0, 255)

    rect_left = int(width * 0.15)
    rect_top = int(height * 0.55)
    rect_right = int(width * 0.45)
    rect_bottom = int(height * 0.85)
    for y in range(rect_top, rect_bottom + 1):
        for x in range(rect_left, rect_right + 1):
            set_pixel(x, y, 128, 128, 128, 128)

    return [(x, y, *pixels[(x, y)]) for (x, y) in pixels]


def parse_chunks(data: bytes) -> list[dict]:
    _, first_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict] = []
    off = first_off
    n = len(data)
    while off < n:
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        data_off = off + 16
        rec = {"name": name, "header_offset": off, "data_offset": data_off, "data_length": length}
        if name == "CHNKExta":
            payload = data[data_off : data_off + length]
            idlen = struct.unpack_from(">Q", payload, 0)[0]
            eid = payload[8 : 8 + idlen].decode("ascii")
            rec["exta_id"] = eid
        chunks.append(rec)
        off = data_off + length
    return chunks


def load_extas(data: bytes, chunks: list[dict]) -> dict[str, bytes]:
    extas: dict[str, bytes] = {}
    for c in chunks:
        if c["name"] != "CHNKExta":
            continue
        payload = data[c["data_offset"] : c["data_offset"] + c["data_length"]]
        idlen = struct.unpack_from(">Q", payload, 0)[0]
        eid = payload[8 : 8 + idlen].decode("ascii")
        blen = struct.unpack_from(">Q", payload, 8 + idlen)[0]
        body_off = c["data_offset"] + 16 + idlen
        extas[eid] = data[body_off : body_off + blen]
    return extas


def parse_attribute(attr: bytes) -> dict:
    hdr = struct.unpack_from(">4I", attr, 0)
    off = 16
    nlen = struct.unpack_from(">I", attr, off)[0]
    name = attr[off + 4 : off + 4 + nlen * 2].decode("utf-16-be")
    assert name == "Parameter"
    params = struct.unpack_from(">20I", attr, off + 4 + nlen * 2)
    off += hdr[1]
    nlen2 = struct.unpack_from(">I", attr, off)[0]
    name2 = attr[off + 4 : off + 4 + nlen2 * 2].decode("utf-16-be")
    assert name2 == "InitColor"
    off += hdr[2]
    nlen3 = struct.unpack_from(">I", attr, off)[0]
    name3 = attr[off + 4 : off + 4 + nlen3 * 2].decode("utf-16-be")
    assert name3 == "BlockSize"
    boff = off + 4 + nlen3 * 2
    b0, cnt, esz = struct.unpack_from(">3I", attr, boff)
    sizes = list(struct.unpack_from(f">{cnt}I", attr, boff + 12))
    return {
        "w": params[0],
        "h": params[1],
        "grid_w": params[2],
        "grid_h": params[3],
        "block_sizes": sizes,
        "block_meta": (b0, cnt, esz),
    }


def extract_block_checksums(body: bytes) -> list[int]:
    label = CHECK_LABEL.encode("utf-16-be")
    idx = body.find(label)
    if idx < 0:
        raise ValueError("BlockCheckSum not found")
    q = idx + len(label)
    _b0, cnt, esz = struct.unpack_from(">3I", body, q)
    if esz != 4:
        raise ValueError(f"unexpected BlockCheckSum element size {esz}")
    return list(struct.unpack_from(f">{cnt}I", body, q + 12))


def recompute_checksums(body: bytes, grid_w: int, grid_h: int) -> list[int]:
    begin = BEGIN_LABEL.encode("utf-16-be")
    checksums: list[int] = []
    p = 0
    while True:
        i = body.find(begin, p)
        if i < 0:
            break
        q = i + len(begin)
        flag = struct.unpack_from(">5I", body, q)[4]
        if flag:
            inner = struct.unpack_from("<I", body, q + 24)[0]
            z = body[q + 28 : q + 28 + inner]
            chk = zlib.adler32(struct.pack("<I", inner) + z) & 0xFFFFFFFF
            checksums.append(chk)
        p = q
    expected = grid_w * grid_h
    if len(checksums) != expected:
        raise ValueError(f"block count {len(checksums)} != {expected}")
    return checksums


def sample_points(width: int, height: int) -> list[tuple[int, int, str]]:
    """Strategic sample locations for E5 image."""
    cx = int(width / 2)
    cy = int(height / 2)
    radius = int(min(width, height) * 0.3)
    points: list[tuple[int, int, str]] = [
        (0, 0, "corner_tl"),
        (width - 1, height - 1, "corner_br"),
        (width // 4, height // 4, "diag1_mid"),
        (width // 4, height - 1 - height // 4, "diag2_mid"),
        (cx, cy, "circle_center"),
        (cx + radius - 1, cy, "circle_edge_e"),
        (int(width * 0.3), int(height * 0.7), "gray_rect_inside"),
        (80, 80, "transparent_area"),
    ]
    return points


def validate_e5(path: Path) -> dict:
    sys.path.insert(0, str(CLIPMERGER))
    from clip_raster import decode_color_offscreen  # noqa: E402

    data = path.read_bytes()
    chunks = parse_chunks(data)
    extas = load_extas(data, chunks)

    fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
        sqlite_bytes = data[sqli["data_offset"] : sqli["data_offset"] + sqli["data_length"]]
        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp_path)

        row = conn.execute(
            "SELECT BlockData FROM Offscreen WHERE MainId=?", (LINEART_OFFSCREEN_ID,)
        ).fetchone()
        if not row or not row[0]:
            return {"ok": False, "error": "Offscreen BlockData missing"}
        block_data = row[0]
        eid = block_data.decode("ascii").replace("\x00", "")

        attr_row = conn.execute(
            "SELECT Attribute FROM Offscreen WHERE MainId=?", (LINEART_OFFSCREEN_ID,)
        ).fetchone()
        attr = parse_attribute(attr_row[0])
        conn.close()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if eid not in extas:
        return {"ok": False, "error": f"external id {eid} not in CHNKExta"}

    body = extas[eid]
    result: dict = {"path": str(path), "ok": True, "checks": {}}

    # (c) Attribute consistency
    attr_ok = (
        attr["w"] == LINEART_WIDTH
        and attr["h"] == LINEART_HEIGHT
        and attr["grid_w"] == LINEART_GRID_W
        and attr["grid_h"] == LINEART_GRID_H
        and len(attr["block_sizes"]) == LINEART_GRID_W * LINEART_GRID_H
    )
    result["checks"]["attribute"] = attr if attr_ok else {"expected_mismatch": True, "actual": attr}
    if not attr_ok:
        result["ok"] = False

    # (b) BlockCheckSum Adler
    stored = extract_block_checksums(body)
    recomputed = recompute_checksums(body, LINEART_GRID_W, LINEART_GRID_H)
    adler_ok = stored == recomputed
    result["checks"]["block_checksum"] = "ok" if adler_ok else {
        "stored_count": len(stored),
        "recomputed_count": len(recomputed),
        "mismatches": [
            {"index": i, "stored": stored[i], "recomputed": recomputed[i]}
            for i in range(min(len(stored), len(recomputed)))
            if stored[i] != recomputed[i]
        ][:10],
    }
    if not adler_ok:
        result["ok"] = False

    # (a) Pixel samples via ClipMerger decode
    img = decode_color_offscreen(
        body, LINEART_WIDTH, LINEART_HEIGHT, LINEART_GRID_W, LINEART_GRID_H
    )
    expected_map = {
        (x, y): (r, g, b, a)
        for x, y, r, g, b, a in generate_e5_test_image(LINEART_WIDTH, LINEART_HEIGHT)
    }

    pixel_checks: list[dict] = []
    for x, y, label in sample_points(LINEART_WIDTH, LINEART_HEIGHT):
        actual = img.getpixel((x, y))
        if (x, y) in expected_map:
            exp = expected_map[(x, y)]
        else:
            exp = (0, 0, 0, 0)
        match = actual == exp
        pixel_checks.append({
            "label": label,
            "xy": (x, y),
            "expected": exp,
            "actual": actual,
            "match": match,
        })
        if not match:
            result["ok"] = False

    result["checks"]["pixel_samples"] = pixel_checks

    # Optional PNG preview
    png_path = OUT_DIR / "E5_decoded_preview.png"
    try:
        from PIL import Image

        img.save(png_path)
        result["checks"]["preview_png"] = str(png_path)
    except ImportError:
        result["checks"]["preview_png"] = "skipped (Pillow not installed)"

    return result


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_E5
    if not path.is_file():
        print(f"E5 clip not found: {path}")
        sys.exit(1)

    result = validate_e5(path)
    out_path = OUT_DIR / "validate_raster_report.json"
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    status = "PASS" if result["ok"] else "FAIL"
    print(f"[{status}] E5 raster validation: {path.name}")
    if not result["ok"]:
        for k, v in result.get("checks", {}).items():
            if k == "pixel_samples":
                for p in v:
                    if not p["match"]:
                        print(f"  pixel {p['label']}: expected {p['expected']} got {p['actual']}")
            elif v != "ok" and not str(v).startswith("skipped"):
                print(f"  {k}: {v}")

    if not result["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
