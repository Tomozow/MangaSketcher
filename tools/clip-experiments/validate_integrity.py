"""Structural integrity checks for .clip SQLite (E6 and v2 outputs).

Verifies: mipmap chains resolve, no orphan Offscreen/Exta/ExternalChunk,
ExternalChunk <-> CHNKExta 1:1, ElemScheme.MaxIndex >= table max MainId,
sqlite_sequence consistency, sibling chains form valid trees.

Usage: python validate_integrity.py [clip files...]
Default: E6_clone.clip + E2a_v2/E2c_v2/E2d_v2 in sample/_experiments/
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
DEFAULT_FILES = [
    ROOT / "sample" / "_experiments" / "E6_v2.clip",
    ROOT / "sample" / "_experiments" / "E6_clone.clip",
    ROOT / "sample" / "_experiments" / "E2a_v2.clip",
    ROOT / "sample" / "_experiments" / "E2c_v2.clip",
    ROOT / "sample" / "_experiments" / "E2d_v2.clip",
]

CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"


def parse_chunks(data: bytes) -> list[dict]:
    if data[0:8] != CSFCHUNK_MAGIC:
        raise ValueError(f"bad magic: {data[0:8]!r}")
    _, first_chunk_off = struct.unpack_from(">QQ", data, 8)
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
            rec["exta_id"] = payload[8 : 8 + idlen].decode("ascii")
        chunks.append(rec)
        off = data_off + length
    return chunks


def extract_sqlite(data: bytes, chunks: list[dict]) -> bytes:
    sqli = next(c for c in chunks if c["name"] == "CHNKSQLi")
    body = data[sqli["data_offset"] : sqli["end_offset"]]
    if body[:16] != SQLITE_MAGIC:
        raise ValueError("CHNKSQLi is not SQLite")
    return body


def blob_to_external_id(blob: bytes | None) -> str | None:
    if not blob:
        return None
    return blob.decode("ascii").replace("\0", "").strip() or None


def walk_mipmap_info(conn: sqlite3.Connection, first_id: int) -> list[int]:
    out: list[int] = []
    cur = first_id
    seen: set[int] = set()
    while cur and cur not in seen:
        seen.add(cur)
        row = conn.execute(
            "SELECT MainId, NextIndex FROM MipmapInfo WHERE MainId=?", (cur,)
        ).fetchone()
        if not row:
            break
        out.append(int(row[0]))
        cur = int(row[1] or 0)
    return out


def layer_children(conn: sqlite3.Connection, parent_id: int) -> list[int]:
    row = conn.execute(
        "SELECT LayerFirstChildIndex FROM Layer WHERE MainId=?", (parent_id,)
    ).fetchone()
    if not row:
        return []
    out: list[int] = []
    cur = int(row[0] or 0)
    seen: set[int] = set()
    while cur and cur not in seen:
        seen.add(cur)
        out.append(cur)
        nxt = conn.execute(
            "SELECT LayerNextIndex FROM Layer WHERE MainId=?", (cur,)
        ).fetchone()
        cur = int(nxt[0] or 0) if nxt else 0
    return out


def validate_integrity(path: Path) -> dict:
    data = path.read_bytes()
    result: dict = {"path": str(path), "ok": True, "checks": {}}
    errors: list[str] = []

    try:
        chunks = parse_chunks(data)
        sqlite_bytes = extract_sqlite(data, chunks)
    except (ValueError, StopIteration) as e:
        result["ok"] = False
        result["checks"]["parse"] = str(e)
        return result

    exta_ids = [c["exta_id"] for c in chunks if c.get("name") == "CHNKExta" and "exta_id" in c]

    fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
    try:
        import os

        os.write(fd, sqlite_bytes)
        os.close(fd)
        conn = sqlite3.connect(tmp_path)

        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        result["checks"]["integrity_check"] = integrity
        if integrity != "ok":
            errors.append(f"integrity_check={integrity}")

        # Mipmap chains
        mip_errors: list[str] = []
        for mip in conn.execute("SELECT MainId, LayerId, BaseMipmapInfo, MipmapCount FROM Mipmap"):
            mip_id, layer_id, base_info, mip_count = mip
            chain = walk_mipmap_info(conn, int(base_info or 0))
            if len(chain) != int(mip_count or 0):
                mip_errors.append(
                    f"Mipmap {mip_id} layer={layer_id}: count={mip_count} chain={len(chain)}"
                )
            for info_id in chain:
                info = conn.execute(
                    "SELECT Offscreen, LayerId FROM MipmapInfo WHERE MainId=?", (info_id,)
                ).fetchone()
                if not info:
                    mip_errors.append(f"MipmapInfo {info_id} missing")
                    continue
                off_id = int(info[0] or 0)
                if off_id and not conn.execute(
                    "SELECT 1 FROM Offscreen WHERE MainId=?", (off_id,)
                ).fetchone():
                    mip_errors.append(f"MipmapInfo {info_id} -> missing Offscreen {off_id}")
        if mip_errors:
            errors.extend(mip_errors[:20])
            result["checks"]["mipmap_chains"] = mip_errors[:20]
        else:
            result["checks"]["mipmap_chains"] = "ok"

        # Referenced offscreens
        referenced: set[int] = set()
        for row in conn.execute("SELECT Offscreen FROM MipmapInfo"):
            if row[0]:
                referenced.add(int(row[0]))
        for row in conn.execute("SELECT ThumbnailOffscreen FROM LayerThumbnail"):
            if row[0]:
                referenced.add(int(row[0]))

        # TLV id=50 float-cache offscreens count as referenced
        for row in conn.execute(
            "SELECT TextLayerAttributes FROM Layer WHERE TextLayerAttributes IS NOT NULL"
        ):
            blob = row[0]
            if not blob or len(blob) < 8:
                continue
            off = 0
            n = len(blob)
            while off + 8 <= n:
                pid = int.from_bytes(blob[off : off + 4], "little")
                plen = int.from_bytes(blob[off + 4 : off + 8], "little")
                if plen > n - off - 8:
                    break
                if pid == 50 and plen >= 4:
                    cache_id = int.from_bytes(blob[off + 8 : off + 12], "little")
                    if cache_id:
                        referenced.add(cache_id)
                off += 8 + plen

        orphan_offs: list[int] = []
        for row in conn.execute("SELECT MainId FROM Offscreen"):
            off_id = int(row[0])
            if off_id not in referenced:
                orphan_offs.append(off_id)
        if orphan_offs:
            errors.append(f"orphan Offscreen MainIds: {orphan_offs[:30]}")
            result["checks"]["orphan_offscreens"] = orphan_offs
        else:
            result["checks"]["orphan_offscreens"] = "ok"

        # ExternalChunk <-> CHNKExta
        db_exta = [r[0] for r in conn.execute("SELECT ExternalID FROM ExternalChunk ORDER BY Offset")]
        exta_set = set(exta_ids)
        db_set = set(db_exta)
        chunk_mismatch = {
            "db_only": sorted(db_set - exta_set),
            "file_only": sorted(exta_set - db_set),
        }
        if chunk_mismatch["db_only"] or chunk_mismatch["file_only"]:
            errors.append(f"ExternalChunk/CHNKExta mismatch: {chunk_mismatch}")
            result["checks"]["external_chunk_pairing"] = chunk_mismatch
        else:
            result["checks"]["external_chunk_pairing"] = "ok"

        # Offscreen BlockData <-> Exta (only when listed in ExternalChunk)
        exta_orphans: list[str] = []
        for eid in exta_ids:
            if eid not in db_set:
                exta_orphans.append(eid)
        block_orphans: list[str] = []
        for eid in db_exta:
            if eid not in exta_set:
                block_orphans.append(eid)
        if exta_orphans or block_orphans:
            errors.append(
                f"ExternalChunk/CHNKExta orphans: exta={exta_orphans[:10]} chunk={block_orphans[:10]}"
            )
            result["checks"]["exta_pairing"] = {
                "exta_orphans": exta_orphans,
                "chunk_missing_for_db": block_orphans,
            }
        else:
            result["checks"]["exta_pairing"] = "ok"

        # ElemScheme.MaxIndex >= max MainId
        elem_errors: list[str] = []
        for table in ("Layer", "Mipmap", "MipmapInfo", "Offscreen", "LayerThumbnail"):
            max_main = conn.execute(f"SELECT MAX(MainId) FROM {table}").fetchone()[0] or 0
            elem = conn.execute(
                "SELECT MaxIndex FROM ElemScheme WHERE TableName=?", (table,)
            ).fetchone()
            max_index = int(elem[0] or 0) if elem else 0
            if max_index < int(max_main):
                elem_errors.append(f"{table}: MaxIndex={max_index} < max MainId={max_main}")
        if elem_errors:
            errors.extend(elem_errors)
            result["checks"]["elem_scheme"] = elem_errors
        else:
            result["checks"]["elem_scheme"] = "ok"

        # sqlite_sequence >= max _PW_ID
        seq_errors: list[str] = []
        for table in ("Layer", "Mipmap", "MipmapInfo", "Offscreen", "LayerThumbnail"):
            max_pw = conn.execute(f"SELECT MAX(_PW_ID) FROM {table}").fetchone()[0] or 0
            seq = conn.execute(
                "SELECT seq FROM sqlite_sequence WHERE name=?", (table,)
            ).fetchone()
            seq_val = int(seq[0] or 0) if seq else 0
            if seq_val < int(max_pw):
                seq_errors.append(f"{table}: seq={seq_val} < max _PW_ID={max_pw}")
        if seq_errors:
            errors.extend(seq_errors)
            result["checks"]["sqlite_sequence"] = seq_errors
        else:
            result["checks"]["sqlite_sequence"] = "ok"

        # Layer sibling chains
        tree_errors: list[str] = []
        root = conn.execute(
            "SELECT CanvasRootFolder FROM Canvas LIMIT 1"
        ).fetchone()
        root_id = int(root[0]) if root else 2

        def validate_subtree(parent_id: int) -> None:
            children = layer_children(conn, parent_id)
            seen_in_parent: set[int] = set()
            for cid in children:
                if cid in seen_in_parent:
                    tree_errors.append(f"duplicate child {cid} under {parent_id}")
                seen_in_parent.add(cid)
                row = conn.execute(
                    "SELECT LayerFirstChildIndex FROM Layer WHERE MainId=?", (cid,)
                ).fetchone()
                if row and int(row[0] or 0):
                    validate_subtree(cid)

        validate_subtree(root_id)

        all_layers = {int(r[0]) for r in conn.execute("SELECT MainId FROM Layer")}
        reachable: set[int] = set()
        stack = [root_id]
        while stack:
            pid = stack.pop()
            for cid in layer_children(conn, pid):
                if cid in reachable:
                    tree_errors.append(f"cycle or multi-parent at layer {cid}")
                reachable.add(cid)
                stack.append(cid)
        unreachable = sorted(all_layers - reachable - {root_id})
        if unreachable:
            tree_errors.append(f"unreachable layers: {unreachable}")

        if tree_errors:
            errors.extend(tree_errors)
            result["checks"]["layer_tree"] = tree_errors
        else:
            result["checks"]["layer_tree"] = "ok"

        conn.close()
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        for suffix in ("-journal", "-wal", "-shm"):
            Path(tmp_path + suffix).unlink(missing_ok=True)

    if errors:
        result["ok"] = False
        result["errors"] = errors[:50]
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
        targets = [p for p in DEFAULT_FILES if p.exists()]

    if not targets:
        print("No target .clip files found")
        sys.exit(1)

    results = [validate_integrity(t) for t in targets]
    out_path = ROOT / "sample" / "_experiments" / "validate_integrity_report.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Integrity check: {len(results)} file(s)")
    for r in results:
        status = "PASS" if r["ok"] else "FAIL"
        print(f"  [{status}] {Path(r['path']).name}")
        if not r["ok"]:
            for e in r.get("errors", [])[:10]:
                print(f"    - {e}")

    failed = sum(1 for r in results if not r["ok"])
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
