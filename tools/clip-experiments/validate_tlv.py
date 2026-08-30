"""TLV validation for E2 experiment .clip files.

Verifies TextLayerAttributes / TextLayerAddAttributesV01 parse with zero trailing bytes
and checks expected field values for MainId=5 patches.

Usage: python validate_tlv.py [clip files...]
Default: E2*.clip in sample/_experiments/
"""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_DIR = ROOT / "sample" / "_experiments"

RUN_ARRAY_IDS = {11, 12, 13, 18, 26, 29, 30, 65}
CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"
HEADER_SIZE = 24

E2_EXPECTATIONS: dict[str, dict] = {
    "E2a_len_change_synced.clip": {
        "text": "かきくけこさしすせそ",
        "char_count": 10,
        "bbox": (918, 509, 951, 1309),
        "id50": 31,
    },
    "E2a_v2.clip": {
        "text": "かきくけこさしすせそ",
        "char_count": 10,
        "bbox": (918, 509, 951, 839),
        "id50": 31,
    },
    "E2b_moved.clip": {
        "text": "あいうえお",
        "char_count": 5,
        "bbox": (618, 909, 651, 1074),
        "id50": 31,
    },
    "E2c_fontsize.clip": {
        "text": "あいうえお",
        "char_count": 5,
        "font_size_value": 794,
        "bbox": (885, 509, 951, 839),
        "id50": 31,
    },
    "E2c_v2.clip": {
        "text": "あいうえお",
        "char_count": 5,
        "font_size_value": 794,
        "bbox": (885, 509, 951, 839),
        "id50": 31,
    },
    "E2d_no_cache.clip": {
        "text": "かきくけこ",
        "char_count": 5,
        "id50": 0,
        "offscreen_gone": 31,
    },
    "E2d_v2.clip": {
        "text": "かきくけこ",
        "char_count": 5,
        "bbox": (918, 509, 951, 674),
        "id50": 31,
    },
}


def parse_chunks(data: bytes) -> list[dict]:
    if data[0:8] != CSFCHUNK_MAGIC:
        raise ValueError("bad magic")
    _, first_chunk_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict] = []
    off = first_chunk_off
    n = len(data)
    while off < n:
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        data_off = off + 16
        chunks.append(
            {
                "name": name,
                "header_offset": off,
                "data_offset": data_off,
                "data_length": length,
                "end_offset": data_off + length,
            }
        )
        off = data_off + length
    return chunks


def extract_sqlite(data: bytes, chunks: list[dict]) -> bytes:
    sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
    body = data[sqli["data_offset"] : sqli["end_offset"]]
    if body[:16] != SQLITE_MAGIC:
        raise ValueError("not sqlite")
    return body


def parse_tlv_stream(data: bytes, start: int = 0) -> tuple[list[tuple[int, bytes]], bytes]:
    entries: list[tuple[int, bytes]] = []
    off = start
    n = len(data)
    while off + 8 <= n:
        pid, plen = struct.unpack_from("<II", data, off)
        if plen > n - off - 8:
            return entries, data[off:]
        payload = data[off + 8 : off + 8 + plen]
        entries.append((pid, payload))
        off += 8 + plen
    return entries, data[off:]


def analyze_blob(name: str, data: bytes, *, is_add: bool) -> tuple[dict[int, bytes], list[str]]:
    errors: list[str] = []
    start = 0
    if is_add:
        if len(data) < 4:
            errors.append(f"{name}: too short")
            return {}, errors
        hdr = struct.unpack_from("<I", data, 0)[0]
        if hdr != len(data) - 4:
            errors.append(f"{name}: header {hdr} != len-4 ({len(data)-4})")
        start = 4
    tlvs, trail = parse_tlv_stream(data, start)
    if trail:
        errors.append(f"{name}: {len(trail)} trailing bytes")
    return dict(tlvs), errors


def run_vtype_checks(attr: dict[int, bytes], char_count: int) -> list[str]:
    errors: list[str] = []
    for pid in RUN_ARRAY_IDS:
        payload = attr.get(pid)
        if not payload or len(payload) < 12:
            continue
        vtype = struct.unpack_from("<I", payload, 8)[0]
        if vtype != char_count:
            errors.append(f"Attr id={pid} vtype={vtype} expected {char_count}")
    id39 = attr.get(39)
    if id39 and len(id39) >= 4:
        lo = struct.unpack_from("<I", id39, 0)[0]
        if lo != char_count:
            errors.append(f"Attr id=39 char_count={lo} expected {char_count}")
    return errors


def validate_clip_tlv(path: Path) -> dict:
    result: dict = {"path": str(path), "ok": True, "checks": {}}
    name = path.name
    expect = E2_EXPECTATIONS.get(name)
    if not expect:
        result["checks"]["skipped"] = "no E2 expectations"
        return result

    data = path.read_bytes()
    try:
        chunks = parse_chunks(data)
        sqlite_bytes = extract_sqlite(data, chunks)
    except ValueError as e:
        result["ok"] = False
        result["checks"]["parse"] = str(e)
        return result

    fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp_path)
        row = conn.execute(
            "SELECT TextLayerString, TextLayerAttributes, TextLayerAddAttributesV01 "
            "FROM Layer WHERE MainId=5"
        ).fetchone()
        if not row:
            result["ok"] = False
            result["checks"]["layer5"] = "missing"
            conn.close()
            return result

        text = row[0].decode("utf-8")
        result["checks"]["text"] = text
        if text != expect["text"]:
            result["ok"] = False
            result["checks"]["text_match"] = False

        attr, attr_err = analyze_blob("Attributes", row[1], is_add=False)
        add, add_err = analyze_blob("AddAttributes", row[2], is_add=True)
        all_errors = attr_err + add_err
        result["checks"]["trailing_errors"] = all_errors
        if all_errors:
            result["ok"] = False

        char_count = expect.get("char_count")
        if char_count is not None:
            vtype_errors = run_vtype_checks(attr, char_count)
            result["checks"]["vtype_errors"] = vtype_errors
            if vtype_errors:
                result["ok"] = False

        if "bbox_size" in expect:
            l, t, r, b = struct.unpack("<4I", attr[42][:16])
            size = (r - l, b - t)
            result["checks"]["bbox_size"] = size
            if size != expect["bbox_size"]:
                result["ok"] = False

        if "bbox" in expect:
            bbox = struct.unpack("<4I", attr[42][:16])
            result["checks"]["bbox"] = bbox
            if bbox != expect["bbox"]:
                result["ok"] = False
                result["checks"]["bbox_match"] = False

        if "bbox_right" in expect:
            l, t, r, b = struct.unpack("<4I", attr[42][:16])
            result["checks"]["bbox"] = (l, t, r, b)
            if r != expect["bbox_right"] or t != expect["bbox_top"]:
                result["ok"] = False
            if b - t < expect.get("bbox_height_min", 0):
                result["ok"] = False
                result["checks"]["bbox_height"] = b - t

        if "font_size_value" in expect:
            fs = struct.unpack("<I", attr[32][:4])[0]
            result["checks"]["font_size_value"] = fs
            if fs != expect["font_size_value"]:
                result["ok"] = False

        if "id50" in expect:
            ref = struct.unpack("<I", attr[50][:4])[0]
            result["checks"]["id50"] = ref
            if ref != expect["id50"]:
                result["ok"] = False

        if expect.get("offscreen_gone"):
            mid = expect["offscreen_gone"]
            off_row = conn.execute(
                "SELECT MainId FROM Offscreen WHERE MainId=?", (mid,)
            ).fetchone()
            result["checks"]["offscreen_row"] = off_row is None
            if off_row is not None:
                result["ok"] = False
            exta_ids = [
                c.get("exta_id")
                for c in chunks
                if c["name"] == "CHNKExta"
            ]
            result["checks"]["exta_count"] = len(exta_ids)
            result["checks"]["exta_ids_sample"] = exta_ids[:3]

        conn.close()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return result


def main() -> None:
    targets: list[Path] = []
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            p = Path(arg)
            if p.is_dir():
                targets.extend(sorted(p.glob("E2*.clip")))
            else:
                targets.append(p)
    else:
        targets = sorted(DEFAULT_DIR.glob("E2*.clip"))

    if not targets:
        print(f"No E2 .clip files in {DEFAULT_DIR}")
        sys.exit(1)

    results = [validate_clip_tlv(t) for t in targets]
    out_path = DEFAULT_DIR / "validate_tlv_report.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"TLV validated {len(results)} file(s)")
    for r in results:
        status = "PASS" if r["ok"] else "FAIL"
        print(f"  [{status}] {Path(r['path']).name}")
        if not r["ok"]:
            for k, v in r.get("checks", {}).items():
                if v is False or (isinstance(v, list) and v):
                    print(f"    {k}: {v}")

    failed = sum(1 for r in results if not r["ok"])
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
