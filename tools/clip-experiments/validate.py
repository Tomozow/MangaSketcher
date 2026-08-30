"""Cross-validate .clip experiment outputs (E0/E1).

Checks: magic, chunk map, SQLite extraction, integrity_check, ExternalChunk offsets,
and text layer strings for E1 variants.

Usage: python validate.py [clip files or directories]
Default: validates all *.clip in sample/_experiments/
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

CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"
HEADER_SIZE = 24


class ValidationError(Exception):
    pass


def parse_chunks(data: bytes) -> list[dict]:
    if data[0:8] != CSFCHUNK_MAGIC:
        raise ValidationError(f"bad magic: {data[0:8]!r}")
    file_size_field, first_chunk_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict] = []
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
            rec["exta_id"] = eid
        chunks.append(rec)
        off = data_off + length
    if file_size_field != len(data):
        raise ValidationError(f"file_size_field {file_size_field} != actual {len(data)}")
    return chunks


def extract_sqlite(data: bytes, chunks: list[dict]) -> bytes:
    sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
    body = data[sqli["data_offset"] : sqli["end_offset"]]
    if body[:16] != SQLITE_MAGIC:
        raise ValidationError("CHNKSQLi is not SQLite")
    return body


def validate_clip(path: Path) -> dict:
    data = path.read_bytes()
    result: dict = {"path": str(path), "ok": True, "checks": {}}

    try:
        chunks = parse_chunks(data)
        result["checks"]["magic_and_chunk_map"] = "ok"
        result["file_size"] = len(data)
        result["chunk_count"] = len(chunks)
    except ValidationError as e:
        result["ok"] = False
        result["checks"]["magic_and_chunk_map"] = str(e)
        return result

    try:
        sqlite_bytes = extract_sqlite(data, chunks)
        result["checks"]["sqlite_extract"] = f"ok ({len(sqlite_bytes)} bytes)"
    except ValidationError as e:
        result["ok"] = False
        result["checks"]["sqlite_extract"] = str(e)
        return result

    fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp_path)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        result["checks"]["integrity_check"] = integrity
        if integrity != "ok":
            result["ok"] = False

        exta_chunks = [c for c in chunks if c["name"] == "CHNKExta"]
        mismatches = []
        for row in conn.execute("SELECT ExternalID, Offset FROM ExternalChunk ORDER BY Offset"):
            eid, db_offset = row[0], row[1]
            found = None
            for c in exta_chunks:
                payload = data[c["data_offset"] : c["end_offset"]]
                idlen = struct.unpack_from(">Q", payload, 0)[0]
                file_eid = payload[8 : 8 + idlen].decode("ascii")
                if file_eid == eid:
                    found = c["header_offset"]
                    break
            if found is None:
                mismatches.append({"externalId": eid, "error": "chunk not found"})
            elif found != db_offset:
                mismatches.append(
                    {"externalId": eid, "dbOffset": db_offset, "actualOffset": found}
                )
        if mismatches:
            result["ok"] = False
            result["checks"]["external_chunk_offsets"] = mismatches
        else:
            result["checks"]["external_chunk_offsets"] = "ok"

        # Text layer readback for E1 variants
        name = path.name
        expected_text: str | None = None
        if name == "E1a_samelen.clip":
            expected_text = "かきくけこ"
        elif name == "E1b_shorter.clip":
            expected_text = "あい"
        elif name == "E1c_longer.clip":
            expected_text = "あいうえおかきくけこ"
        elif name == "E2a_len_change_synced.clip":
            expected_text = "かきくけこさしすせそ"
        elif name == "E2b_moved.clip":
            expected_text = "あいうえお"
        elif name == "E2c_fontsize.clip":
            expected_text = "あいうえお"
        elif name == "E2d_no_cache.clip":
            expected_text = "かきくけこ"

        if expected_text is not None:
            row = conn.execute(
                "SELECT TextLayerString FROM Layer WHERE MainId=5"
            ).fetchone()
            if row and row[0]:
                actual = row[0].decode("utf-8")
                result["checks"]["text_mainid5"] = actual
                if actual != expected_text:
                    result["ok"] = False
                    result["checks"]["text_mainid5_match"] = False
                else:
                    result["checks"]["text_mainid5_match"] = True
            else:
                result["ok"] = False
                result["checks"]["text_mainid5"] = "missing"

        conn.close()
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        for suffix in ("-journal", "-wal", "-shm"):
            Path(tmp_path + suffix).unlink(missing_ok=True)

    return result


def main() -> None:
    targets: list[Path] = []
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            p = Path(arg)
            if p.is_dir():
                targets.extend(sorted(p.glob("*.clip")))
            else:
                targets.append(p)
    else:
        targets = sorted(DEFAULT_DIR.glob("*.clip"))

    if not targets:
        print(f"No .clip files found in {DEFAULT_DIR}")
        sys.exit(1)

    results = [validate_clip(t) for t in targets]
    out_path = DEFAULT_DIR / "validate_report.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Validated {len(results)} file(s)")
    for r in results:
        status = "PASS" if r["ok"] else "FAIL"
        print(f"  [{status}] {Path(r['path']).name}")
        if not r["ok"]:
            for k, v in r["checks"].items():
                if v not in ("ok", True):
                    print(f"    {k}: {v}")

    failed = sum(1 for r in results if not r["ok"])
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
