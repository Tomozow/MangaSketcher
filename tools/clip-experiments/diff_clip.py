"""Logical diff of two .clip files (SQLite + TLV + raster structure).

Usage:
  python diff_clip.py <left.clip> <right.clip> [--label-left A] [--label-right B] [--json out.json]

Compares:
  (a) SQLite logical diff (row counts, key column values per table)
  (b) Text layer TLV diffs (TextLayerString + Attributes/Add BLOB per id)
  (c) Offscreen / Mipmap / LayerThumbnail / ExternalChunk structure
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

# Reuse decode helpers from analysis parser
sys.path.insert(0, str(ROOT / "sample" / "_analysis"))
from importlib import import_module

_tlv_mod = import_module("07_text_tlv_full")
parse_tlv_stream = _tlv_mod.parse_tlv_stream
decode_scalar = _tlv_mod.decode_scalar
parse_run_array_full = _tlv_mod.parse_run_array_full
parse_run_array_compact = _tlv_mod.parse_run_array_compact
RUN_ARRAY_IDS = _tlv_mod.RUN_ARRAY_IDS
utf16_units = _tlv_mod.utf16_units

CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"

TEXT_LAYER_MAIN_IDS = [5, 6, 7]

# Tables with logical comparison (ignore byte layout)
COMPARE_TABLES = [
    "Layer",
    "Offscreen",
    "Mipmap",
    "LayerThumbnail",
    "ExternalChunk",
    "ElemScheme",
    "ParamScheme",
    "Canvas",
    "sqlite_sequence",
]

LAYER_KEY_COLS = [
    "MainId",
    "LayerName",
    "LayerOffsetX",
    "LayerOffsetY",
    "LayerRenderOffscrOffsetX",
    "LayerRenderOffscrOffsetY",
    "TextLayerString",
    "TextLayerAttributes",
    "TextLayerAddAttributesV01",
]

OFFSCREEN_KEY_COLS = ["MainId", "Attribute", "BlockData", "Width", "Height", "LayerMainId"]


def parse_chunks(data: bytes) -> list[dict[str, Any]]:
    if data[0:8] != CSFCHUNK_MAGIC:
        raise ValueError("bad CSFCHUNK magic")
    _, first_chunk_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict[str, Any]] = []
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
        raise ValueError("CHNKSQLi is not SQLite")
    return body


def open_clip_db(path: Path) -> tuple[sqlite3.Connection, list[dict], bytes]:
    data = path.read_bytes()
    chunks = parse_chunks(data)
    sqlite_bytes = extract_sqlite(data, chunks)
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    import os

    os.write(fd, sqlite_bytes)
    os.close(fd)
    conn = sqlite3.connect(tmp)
    conn.row_factory = sqlite3.Row
    conn.execute(f"ATTACH DATABASE '{tmp}' AS _tmp")
    return conn, chunks, data


def blob_fingerprint(val: Any) -> Any:
    if isinstance(val, (bytes, memoryview)):
        b = bytes(val)
        if len(b) <= 64:
            return {"len": len(b), "hex": b.hex()}
        return {"len": len(b), "hex_head": b[:32].hex(), "hex_tail": b[-16:].hex()}
    return val


def row_logical_key(table: str, row: sqlite3.Row) -> str:
    keys = row.keys()
    if table == "Layer":
        return str(row["MainId"])
    if table == "Offscreen":
        return str(row["MainId"])
    if table == "Mipmap":
        return str(row["MainId"])
    if table == "LayerThumbnail":
        return str(row["MainId"]) if "MainId" in keys else str(row[0])
    if table == "ExternalChunk":
        return str(row["ExternalID"]) if "ExternalID" in keys else str(row[0])
    if table == "ElemScheme":
        return str(row[0])
    if table == "ParamScheme":
        return str(row[0])
    if table == "Canvas":
        return "canvas"
    if table == "sqlite_sequence":
        return str(row["name"]) if "name" in keys else str(row[0])
    return str(tuple(row))


def compare_table(conn_a: sqlite3.Connection, conn_b: sqlite3.Connection, table: str) -> dict:
    try:
        rows_a = conn_a.execute(f"SELECT * FROM [{table}]").fetchall()
        rows_b = conn_b.execute(f"SELECT * FROM [{table}]").fetchall()
    except sqlite3.OperationalError as e:
        return {"error": str(e)}

    cols = rows_a[0].keys() if rows_a else (rows_b[0].keys() if rows_b else [])
    map_a = {row_logical_key(table, r): r for r in rows_a}
    map_b = {row_logical_key(table, r): r for r in rows_b}

    only_a = sorted(set(map_a) - set(map_b))
    only_b = sorted(set(map_b) - set(map_a))
    common = sorted(set(map_a) & set(map_b))

    col_diffs: list[dict] = []
    for key in common:
        ra, rb = map_a[key], map_b[key]
        for col in cols:
            va, vb = ra[col], rb[col]
            if isinstance(va, (bytes, memoryview)) or isinstance(vb, (bytes, memoryview)):
                if bytes(va or b"") != bytes(vb or b""):
                    col_diffs.append(
                        {
                            "key": key,
                            "column": col,
                            "left": blob_fingerprint(va),
                            "right": blob_fingerprint(vb),
                        }
                    )
            elif va != vb:
                col_diffs.append({"key": key, "column": col, "left": va, "right": vb})

    return {
        "row_count_left": len(rows_a),
        "row_count_right": len(rows_b),
        "only_left": only_a[:20],
        "only_right": only_b[:20],
        "only_left_count": len(only_a),
        "only_right_count": len(only_b),
        "column_diffs": col_diffs[:50],
        "column_diff_count": len(col_diffs),
    }


def tlv_by_id(data: bytes, *, is_add: bool) -> dict[int, bytes]:
    start = 4 if is_add else 0
    tlvs, _consumed, trail = parse_tlv_stream(data, start)
    if trail:
        return {t.param_id: t.payload for t in tlvs}  # still return partial
    return {t.param_id: t.payload for t in tlvs}


def describe_tlv_payload(pid: int, payload: bytes, *, compact: bool) -> str:
    if pid in RUN_ARRAY_IDS:
        parts = parse_run_array_compact(payload, pid) if compact else parse_run_array_full(payload, pid)
        return " | ".join(parts)
    return decode_scalar(pid, payload)


def compare_tlv_blobs(
    left: bytes | None,
    right: bytes | None,
    *,
    is_add: bool,
    name: str,
) -> dict:
    if left is None and right is None:
        return {"name": name, "status": "both_missing"}
    if left is None or right is None:
        return {"name": name, "status": "one_missing", "left_len": len(left or b""), "right_len": len(right or b"")}

    ids_l = tlv_by_id(left, is_add=is_add)
    ids_r = tlv_by_id(right, is_add=is_add)
    all_ids = sorted(set(ids_l) | set(ids_r))
    diffs: list[dict] = []
    for pid in all_ids:
        pl, pr = ids_l.get(pid), ids_r.get(pid)
        if pl == pr:
            continue
        entry: dict[str, Any] = {"id": pid}
        compact = is_add and pid in RUN_ARRAY_IDS
        if pl is not None:
            entry["left"] = describe_tlv_payload(pid, pl, compact=compact)
            entry["left_hex"] = pl.hex() if len(pl) <= 64 else pl[:32].hex() + "..."
        if pr is not None:
            entry["right"] = describe_tlv_payload(pid, pr, compact=compact)
            entry["right_hex"] = pr.hex() if len(pr) <= 64 else pr[:32].hex() + "..."
        diffs.append(entry)
    return {"name": name, "status": "ok", "diff_count": len(diffs), "diffs": diffs}


def compare_text_layers(conn_a: sqlite3.Connection, conn_b: sqlite3.Connection) -> list[dict]:
    results: list[dict] = []
    for mid in TEXT_LAYER_MAIN_IDS:
        qa = conn_a.execute(
            "SELECT MainId, LayerName, LayerOffsetX, LayerOffsetY, "
            "LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY, "
            "TextLayerString, TextLayerAttributes, TextLayerAddAttributesV01 "
            "FROM Layer WHERE MainId=?",
            (mid,),
        ).fetchone()
        qb = conn_b.execute(
            "SELECT MainId, LayerName, LayerOffsetX, LayerOffsetY, "
            "LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY, "
            "TextLayerString, TextLayerAttributes, TextLayerAddAttributesV01 "
            "FROM Layer WHERE MainId=?",
            (mid,),
        ).fetchone()
        if not qa and not qb:
            continue
        layer: dict[str, Any] = {"mainId": mid}
        if qa:
            layer["left"] = {
                "name": qa["LayerName"],
                "text": qa["TextLayerString"].decode("utf-8") if qa["TextLayerString"] else None,
                "utf16": utf16_units(qa["TextLayerString"].decode("utf-8")) if qa["TextLayerString"] else 0,
                "offset": (qa["LayerOffsetX"], qa["LayerOffsetY"]),
                "renderOffscr": (qa["LayerRenderOffscrOffsetX"], qa["LayerRenderOffscrOffsetY"]),
            }
        if qb:
            layer["right"] = {
                "name": qb["LayerName"],
                "text": qb["TextLayerString"].decode("utf-8") if qb["TextLayerString"] else None,
                "utf16": utf16_units(qb["TextLayerString"].decode("utf-8")) if qb["TextLayerString"] else 0,
                "offset": (qb["LayerOffsetX"], qb["LayerOffsetY"]),
                "renderOffscr": (qb["LayerRenderOffscrOffsetX"], qb["LayerRenderOffscrOffsetY"]),
            }
        if qa and qb:
            layer["attr_tlv"] = compare_tlv_blobs(
                qa["TextLayerAttributes"], qb["TextLayerAttributes"], is_add=False, name="Attributes"
            )
            layer["add_tlv"] = compare_tlv_blobs(
                qa["TextLayerAddAttributesV01"],
                qb["TextLayerAddAttributesV01"],
                is_add=True,
                name="AddAttributes",
            )
        results.append(layer)
    return results


def summarize_offscreen(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT MainId, LayerId, length(Attribute) as attr_len, "
        "length(BlockData) as bd_len, BlockData FROM Offscreen ORDER BY MainId"
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        bd = r["BlockData"]
        ext_id = ""
        if bd:
            ext_id = bytes(bd).decode("ascii", errors="replace").replace("\x00", "")
        out.append(
            {
                "mainId": r["MainId"],
                "layerId": r["LayerId"],
                "attr_len": r["attr_len"],
                "blockData_len": r["bd_len"],
                "externalId": ext_id or None,
            }
        )
    return out


def summarize_mipmap(conn: sqlite3.Connection) -> list[dict]:
    return [
        {
            "mainId": r["MainId"],
            "layerId": r["LayerId"],
            "mipmapCount": r["MipmapCount"],
            "baseMipmapInfo": r["BaseMipmapInfo"],
        }
        for r in conn.execute(
            "SELECT MainId, LayerId, MipmapCount, BaseMipmapInfo FROM Mipmap ORDER BY MainId"
        ).fetchall()
    ]


def summarize_exta(chunks: list[dict], data: bytes) -> list[dict]:
    extas = [c for c in chunks if c["name"] == "CHNKExta"]
    out: list[dict] = []
    for i, c in enumerate(extas):
        body = data[c["data_offset"] : c["end_offset"]]
        ext_id = body[:40].decode("ascii", errors="replace").replace("\x00", "")
        out.append(
            {
                "index": i,
                "externalId": ext_id,
                "body_len": len(body),
                "header_offset": c["header_offset"],
            }
        )
    return out


def diff_clips(left_path: Path, right_path: Path, label_left: str, label_right: str) -> dict:
    conn_a, chunks_a, data_a = open_clip_db(left_path)
    conn_b, chunks_b, data_b = open_clip_db(right_path)

    result: dict[str, Any] = {
        "left": {"path": str(left_path), "label": label_left},
        "right": {"path": str(right_path), "label": label_right},
        "file_size": {"left": len(data_a), "right": len(data_b)},
        "chunk_count": {"left": len(chunks_a), "right": len(chunks_b)},
        "tables": {},
        "text_layers": compare_text_layers(conn_a, conn_b),
        "offscreen": {
            "left": summarize_offscreen(conn_a),
            "right": summarize_offscreen(conn_b),
        },
        "mipmap": {"left": summarize_mipmap(conn_a), "right": summarize_mipmap(conn_b)},
        "exta": {"left": summarize_exta(chunks_a, data_a), "right": summarize_exta(chunks_b, data_b)},
    }

    tables_a = {
        r[0]
        for r in conn_a.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    tables_b = {
        r[0]
        for r in conn_b.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    for t in sorted(tables_a | tables_b):
        if t.startswith("sqlite_") and t != "sqlite_sequence":
            continue
        result["tables"][t] = compare_table(conn_a, conn_b, t)

    conn_a.close()
    conn_b.close()
    return result


def print_summary(diff: dict) -> None:
    print(f"=== {diff['left']['label']} vs {diff['right']['label']} ===")
    print(f"  files: {diff['file_size']['left']} vs {diff['file_size']['right']} bytes")
    print(f"  chunks: {diff['chunk_count']['left']} vs {diff['chunk_count']['right']}")
    print(f"  exta: {len(diff['exta']['left'])} vs {len(diff['exta']['right'])}")

    for t, td in diff["tables"].items():
        if td.get("column_diff_count", 0) or td.get("only_left_count", 0) or td.get("only_right_count", 0):
            print(
                f"  table {t}: rows {td.get('row_count_left')} vs {td.get('row_count_right')}, "
                f"diffs={td.get('column_diff_count', 0)}, "
                f"only_left={td.get('only_left_count', 0)}, only_right={td.get('only_right_count', 0)}"
            )

    for layer in diff["text_layers"]:
        mid = layer["mainId"]
        if mid != 5:
            continue
        print(f"  Layer MainId={mid}:")
        if "left" in layer:
            print(f"    left text={layer['left']['text']!r} utf16={layer['left']['utf16']}")
        if "right" in layer:
            print(f"    right text={layer['right']['text']!r} utf16={layer['right']['utf16']}")
        for blob_key in ("attr_tlv", "add_tlv"):
            if blob_key not in layer:
                continue
            tlv = layer[blob_key]
            print(f"    {tlv['name']}: {tlv.get('diff_count', 0)} TLV diffs")
            for d in tlv.get("diffs", [])[:15]:
                print(f"      id={d['id']}: {d.get('left', '?')} -> {d.get('right', '?')}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Logical diff of two .clip files")
    ap.add_argument("left")
    ap.add_argument("right")
    ap.add_argument("--label-left", default="left")
    ap.add_argument("--label-right", default="right")
    ap.add_argument("--json", help="write full JSON report")
    args = ap.parse_args()

    diff = diff_clips(Path(args.left), Path(args.right), args.label_left, args.label_right)
    print_summary(diff)
    if args.json:
        Path(args.json).write_text(json.dumps(diff, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"JSON written: {args.json}")


if __name__ == "__main__":
    main()
