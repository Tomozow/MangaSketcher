#!/usr/bin/env python3
"""Render CanvasPreview PNG from page_template Offscreen and patch a .clip file.

Reads input clip, decodes page_template level-0 Offscreen (MainId=5), writes PNG
into CanvasPreview.ImageData, and saves output clip preserving container layout.

Usage: python render_preview.py <input.clip> <output.clip>
"""
from __future__ import annotations

import sqlite3
import struct
import sys
import tempfile
from io import BytesIO
from pathlib import Path

CLIPMERGER = Path("A:/dev/ClipMerger")
if str(CLIPMERGER) not in sys.path:
    sys.path.insert(0, str(CLIPMERGER))

from clip_raster import decode_color_offscreen, parse_attribute_param  # noqa: E402

CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"
PAGE_TEMPLATE_OFFSCREEN_ID = 5
CANVAS_W = 1518
CANVAS_H = 2150


def parse_chunks(data: bytes) -> list[dict]:
    _, first_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict] = []
    off = first_off
    n = len(data)
    while off < n:
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        data_off = off + 16
        rec = {
            "name": name,
            "header_offset": off,
            "data_offset": data_off,
            "data_length": length,
            "end_offset": data_off + length,
        }
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


def blob_to_external_id(blob: bytes | None) -> str | None:
    if not blob:
        return None
    return blob.decode("ascii").replace("\0", "").strip() or None


def rebuild_clip(data: bytes, chunks: list[dict], sqlite_bytes: bytes) -> bytes:
    head_payload = next(
        c
        for c in chunks
        if c["name"] == "CHNKHead"
    )
    head_body = data[head_payload["data_offset"] : head_payload["end_offset"]]
    sqli_header_off = (
        24
        + 16
        + len(head_body)
        + sum(16 + c["data_length"] for c in chunks if c["name"] == "CHNKExta")
    )
    new_head = bytearray(head_body)
    struct.pack_into(">Q", new_head, 8, sqli_header_off)

    parts: list[bytes] = [CSFCHUNK_MAGIC]
    total = 24 + 16 + len(new_head)
    for c in chunks:
        if c["name"] == "CHNKExta":
            total += 16 + c["data_length"]
    total += 16 + len(sqlite_bytes) + 16

    parts.append(struct.pack(">QQ", total, 24))
    parts.append(b"CHNKHead" + struct.pack(">Q", len(new_head)) + bytes(new_head))
    for c in chunks:
        if c["name"] != "CHNKExta":
            continue
        payload = data[c["data_offset"] : c["end_offset"]]
        parts.append(b"CHNKExta" + struct.pack(">Q", len(payload)) + payload)
    parts.append(b"CHNKSQLi" + struct.pack(">Q", len(sqlite_bytes)) + sqlite_bytes)
    parts.append(b"CHNKFoot" + struct.pack(">Q", 0))
    out = b"".join(parts)
    if len(out) != total:
        raise RuntimeError(f"size mismatch built={len(out)} expected={total}")
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python render_preview.py <input.clip> <output.clip>", file=sys.stderr)
        return 2

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    data = src.read_bytes()
    chunks = parse_chunks(data)
    extas = {c["exta_id"]: c["exta_body"] for c in chunks if c.get("exta_id")}

    sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
    sqlite_bytes = data[sqli["data_offset"] : sqli["end_offset"]]
    if sqlite_bytes[:16] != SQLITE_MAGIC:
        raise RuntimeError("CHNKSQLi is not SQLite")

    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp)
        row = conn.execute(
            "SELECT Attribute, BlockData FROM Offscreen WHERE MainId=?",
            (PAGE_TEMPLATE_OFFSCREEN_ID,),
        ).fetchone()
        if not row:
            raise RuntimeError(f"Offscreen {PAGE_TEMPLATE_OFFSCREEN_ID} missing")
        attr, block = row
        eid = blob_to_external_id(block)
        if not eid or eid not in extas:
            raise RuntimeError(f"page_template Exta missing for {eid!r}")
        w, h, gw, gh = parse_attribute_param(attr)[:4]
        if w != CANVAS_W or h != CANVAS_H:
            raise RuntimeError(f"unexpected page_template size {w}x{h}")
        img = decode_color_offscreen(extas[eid], w, h, gw, gh)
        buf = BytesIO()
        img.save(buf, format="PNG")
        png = buf.getvalue()
        conn.execute(
            "UPDATE CanvasPreview SET ImageType=1, ImageWidth=?, ImageHeight=?, ImageData=? WHERE MainId=1",
            (CANVAS_W, CANVAS_H, png),
        )
        conn.commit()
        conn.close()
        new_sqlite = Path(tmp).read_bytes()
    finally:
        Path(tmp).unlink(missing_ok=True)

    out = rebuild_clip(data, chunks, new_sqlite)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(out)
    print(f"CanvasPreview updated: {dst} ({len(png)} byte PNG)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
