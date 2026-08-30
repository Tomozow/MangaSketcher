"""Step 1: Parse the CSFCHUNK container of export_sample.clip.

- Verify magic, dump header fields.
- Enumerate all chunks with offsets/sizes.
- For CHNKExta: show external id + body size.
- For CHNKHead: hex dump.
- Extract CHNKSQLi payload to export_sample.sqlite.

Usage: python 01_parse_container.py
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIP_PATH = HERE.parent / "export_sample.clip"
SQLITE_OUT = HERE / "export_sample.sqlite"
CHUNKS_JSON = HERE / "chunks.json"

CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"
HEADER_SIZE = 24


def main() -> None:
    data = CLIP_PATH.read_bytes()
    print(f"file: {CLIP_PATH}")
    print(f"size: {len(data)} bytes")

    magic = data[0:8]
    assert magic == CSFCHUNK_MAGIC, f"bad magic: {magic!r}"
    file_size_field, first_chunk_off = struct.unpack_from(">QQ", data, 8)
    print(f"magic OK: {magic.decode()}")
    print(f"header.file_size_field  = {file_size_field} (matches file: {file_size_field == len(data)})")
    print(f"header.first_chunk_off  = {first_chunk_off}")
    print()

    chunks = []
    off = first_chunk_off
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
            eid = payload[8 : 8 + idlen].decode("ascii")
            body_len = struct.unpack_from(">Q", payload, 8 + idlen)[0]
            rec["exta_id_len"] = idlen
            rec["exta_id"] = eid
            rec["exta_body_len"] = body_len
            rec["exta_body_offset_in_file"] = data_off + 16 + idlen
        chunks.append(rec)
        off = data_off + length

    print(f"{'name':<10} {'hdr_off':>10} {'data_off':>10} {'length':>10}  extra")
    for c in chunks:
        extra = ""
        if c["name"] == "CHNKExta":
            extra = f"id={c['exta_id']} (idlen={c['exta_id_len']}) body={c['exta_body_len']}B @file:{c['exta_body_offset_in_file']}"
        print(f"{c['name']:<10} {c['header_offset']:>10} {c['data_offset']:>10} {c['data_length']:>10}  {extra}")
    print()

    # CHNKHead payload dump
    head = next(c for c in chunks if c["name"] == "CHNKHead")
    hp = data[head["data_offset"] : head["end_offset"]]
    print(f"CHNKHead payload ({len(hp)} bytes): {hp.hex()}")
    if len(hp) >= 40:
        v1, v2 = struct.unpack_from(">QQ", hp, 0)
        idlen = struct.unpack_from(">Q", hp, 16)[0]
        print(f"  u64[0]={v1} u64[1]={v2} (u64[1] == CHNKSQLi data start? see chunk map)")
        print(f"  id_len={idlen} file_uuid={hp[24:24+idlen].hex()}")
    print()

    # extract sqlite
    sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
    body = data[sqli["data_offset"] : sqli["end_offset"]]
    assert body[:16] == SQLITE_MAGIC, "CHNKSQLi payload is not SQLite"
    SQLITE_OUT.write_bytes(body)
    print(f"extracted SQLite: {SQLITE_OUT} ({len(body)} bytes)")

    CHUNKS_JSON.write_text(json.dumps(chunks, indent=2), encoding="utf-8")
    print(f"chunk map saved: {CHUNKS_JSON}")


if __name__ == "__main__":
    main()
