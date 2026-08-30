"""Step 8: Inspect ParamScheme / ElemScheme for TLV id <-> label mapping.

ParamScheme maps DB column names (_PW_ID is the column ordinal, NOT TLV id).
This script also scans the .clip binary for Layer/Text* label strings and
attempts heuristic TLV id naming from cross-layer behavior.

Usage: python 08_paramscheme.py
"""
from __future__ import annotations

import json
import re
import sqlite3
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"
CLIP = HERE.parent / "export_sample.clip"
CLIPMERGER_SCHEME = Path(r"A:\dev\ClipMerger\_clip_extract\paramscheme.json")
OUT = HERE / "08_output.txt"

# Heuristic names from 07 analysis (ParamScheme does NOT list inner TLV ids).
TLV_GUESS_NAMES: dict[int, str] = {
    11: "CharRunHeader",
    12: "RunAttr_U16_0",
    13: "FontSizeMmScale",
    14: "EmptySlot_14",
    15: "EmptySlot_15",
    16: "RunAttr_U16_0b",
    17: "EmptySlot_17",
    18: "RunAttr_U16_0c",
    19: "EmptySlot_19",
    20: "RunAttr_U16_0d",
    21: "EmptySlot_21",
    22: "EmptySlot_22",
    26: "HorzVertScalePct",
    27: "EmptySlot_27",
    28: "EmptySlot_28",
    29: "RunAttr_U16_1",
    30: "PerIndexRunTable",
    31: "FontNameUtf8",
    32: "FontSizeValue",
    33: "Const_16",
    34: "TextColorRGBA",
    35: "Const_0",
    37: "MmPerPt_x100",
    38: "Const_4",
    39: "Utf16CharCount",
    40: "EmptySlot_40",
    41: "EmptySlot_41",
    42: "CanvasBBox",
    43: "Const_50",
    44: "PxPerPt_x1000",
    45: "Const_0b",
    46: "Const_0c",
    47: "SubstituteFontList",
    48: "Const_1",
    49: "Const_1003",
    50: "FloatCacheOffscreenMainId",
    51: "Const_0d",
    52: "Const_1b",
    53: "Const_0e",
    54: "EdgePaddingFlags",
    55: "Const_0f",
    56: "ThumbnailLink",
    57: "FontFaceDescriptor",
    58: "Const_1800",
    59: "Const_900",
    60: "Const_900b",
    61: "Const_0g",
    62: "Const_0h",
    63: "RenderPixelSize",
    64: "RenderRectCentiPx",
    65: "RunAttr_U16_1b",
    66: "Const_0i",
    67: "Const_1000",
    68: "Const_0j",
    69: "Const_0k",
    70: "Const_u64_0",
    71: "Const_f64_384",
    72: "CacheWidthField",
    73: "Const_1c",
    74: "Const_0l",
}

lines: list[str] = []


def w(s: str = "") -> None:
    lines.append(s)


def collect_tlv_ids() -> dict[int, dict[int, bytes]]:
    conn = sqlite3.connect(str(DB))
    by_layer: dict[int, dict[int, bytes]] = {}
    for mid, blob in conn.execute(
        "SELECT MainId, TextLayerAttributes FROM Layer WHERE TextLayerAttributes IS NOT NULL"
    ):
        ids: dict[int, bytes] = {}
        off = 0
        while off + 8 <= len(blob):
            pid, plen = struct.unpack_from("<II", blob, off)
            ids[pid] = blob[off + 8 : off + 8 + plen]
            off += 8 + plen
        by_layer[mid] = ids
    conn.close()
    return by_layer


def main() -> None:
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row

    w("=" * 72)
    w("ParamScheme: Layer / Text* columns (_PW_ID is DB column id, NOT TLV id)")
    w("=" * 72)
    for r in conn.execute(
        """
        SELECT _PW_ID, TableName, LabelName, DataType, Flag, OwnerType, LockType, LinkTable
        FROM ParamScheme
        WHERE TableName='Layer' AND LabelName LIKE 'Text%'
        ORDER BY _PW_ID
        """
    ):
        w(
            f"  _PW_ID={r['_PW_ID']:4d}  {r['LabelName']:35s}  "
            f"DataType={r['DataType']} Flag={r['Flag']} OwnerType={r['OwnerType']} "
            f"Lock={r['LockType']} Link={r['LinkTable'] or ''}"
        )
    w()

    w("=" * 72)
    w("ElemScheme (table element counts — no TLV labels)")
    w("=" * 72)
    for r in conn.execute("SELECT * FROM ElemScheme ORDER BY _PW_ID"):
        w(f"  {dict(r)}")
    w()

    w("=" * 72)
    w("ParamScheme DataType value distribution (all 1250 rows)")
    w("=" * 72)
    for dt, cnt in conn.execute(
        "SELECT DataType, COUNT(*) FROM ParamScheme GROUP BY DataType ORDER BY DataType"
    ):
        w(f"  DataType={dt}: {cnt} rows")
    w("  (observed: 1=int, 2=float, 3=uuid/text, 4=blob — TLV inner ids are NOT here)")
    w()

    # Compare with ClipMerger export
    w("=" * 72)
    w("ClipMerger paramscheme.json TextLayer entries")
    w("=" * 72)
    if CLIPMERGER_SCHEME.exists():
        scheme = json.loads(CLIPMERGER_SCHEME.read_text(encoding="utf-8"))
        for row in scheme:
            if row.get("TableName") == "Layer" and "TextLayer" in row.get("LabelName", ""):
                w(f"  _PW_ID={row['_PW_ID']:4d}  {row['LabelName']}")
    else:
        w("  (ClipMerger paramscheme.json not found)")
    w()

    w("=" * 72)
    w("TLV id inventory from sample text layers")
    w("=" * 72)
    by_layer = collect_tlv_ids()
    all_ids = sorted({pid for m in by_layer.values() for pid in m})
    w(f"  unique TLV ids: {all_ids}")
    w(f"  count: {len(all_ids)}")
    w()

    w("  id | guess_name                  | L5 | L6 | L7 | const across layers?")
    w("  " + "-" * 68)
    for pid in all_ids:
        payloads = [by_layer.get(5, {}).get(pid), by_layer.get(6, {}).get(pid), by_layer.get(7, {}).get(pid)]
        same = len({p for p in payloads if p is not None}) == 1 and payloads[0] is not None
        if all(p is not None for p in payloads):
            same = payloads[0] == payloads[1] == payloads[2]
        name = TLV_GUESS_NAMES.get(pid, "?")
        lens = [len(p) if p else "-" for p in payloads]
        w(f"  {pid:3d} | {name:27s} | {str(lens[0]):>4} | {str(lens[1]):>4} | {str(lens[2]):>4} | {'CONST' if same else 'VAR'}")
    w()

    w("=" * 72)
    w("Binary string scan: Layer* labels in export_sample.clip")
    w("=" * 72)
    if CLIP.exists():
        data = CLIP.read_bytes()
        labels = sorted(set(m.group().decode("ascii") for m in re.finditer(rb"LayerTextLayer[A-Za-z0-9]+", data)))
        for lb in labels:
            w(f"  {lb}")
        w()
        w(f"  Total LayerTextLayer* strings: {len(labels)}")
        w("  => DB column names only; no inner TLV enum strings in container.")
    else:
        w("  export_sample.clip not found beside sample/")
    w()

    w("=" * 72)
    w("CONCLUSION: ParamScheme id <-> TLV id mapping")
    w("=" * 72)
    w("  FAILED for inner TLV ids.")
    w("  ParamScheme._PW_ID indexes Layer TABLE COLUMNS (e.g. _PW_ID=175 -> TextLayerAttributes blob).")
    w("  Inner TLV param_id (11..74) is a separate enum baked into CSP; not present in SQLite metadata.")
    w("  Names in table above are heuristic from byte patterns / cross-layer diffs.")
    w()

    conn.close()
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
