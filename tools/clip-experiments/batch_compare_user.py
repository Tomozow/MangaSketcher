"""Batch three-way compare: original / generated / user CSP for E1/E2 experiments."""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from diff_clip import diff_clips, extract_sqlite, open_clip_db, parse_chunks  # noqa: E402

sys.path.insert(0, str(ROOT / "sample" / "_analysis"))
from importlib import import_module

_tlv = import_module("07_text_tlv_full")
utf16_units = _tlv.utf16_units

EXPERIMENTS = [
    "E1a_samelen",
    "E1b_shorter",
    "E1c_longer",
    "E2a_len_change_synced",
    "E2b_moved",
    "E2c_fontsize",
    "E2d_no_cache",
]

ORIGINAL = ROOT / "sample" / "export_sample.clip"
GEN_DIR = ROOT / "sample" / "_experiments"
USER_DIR = GEN_DIR / "user"
OUT = GEN_DIR / "user_compare_report.json"


def extract_l5_metrics(path: Path) -> dict:
    conn, chunks, data = open_clip_db(path)
    row = conn.execute(
        "SELECT TextLayerString, TextLayerAttributes, LayerOffsetX, LayerOffsetY, "
        "LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY FROM Layer WHERE MainId=5"
    ).fetchone()
    if not row or row["TextLayerAttributes"] is None:
        conn.close()
        return {"error": "Layer MainId=5 missing or no attributes"}
    attr = row["TextLayerAttributes"]
    text = row["TextLayerString"].decode("utf-8")
    off = 0
    fields: dict = {}
    while off + 8 <= len(attr):
        pid, plen = struct.unpack_from("<II", attr, off)
        pay = attr[off + 8 : off + 8 + plen]
        if pid in (32, 39, 42, 50, 63, 64, 72):
            if pid == 42 and len(pay) >= 16:
                fields["bbox"] = struct.unpack("<4I", pay)
            elif pid == 63 and len(pay) >= 8:
                fields["size63"] = struct.unpack("<II", pay)
            elif pid == 64 and len(pay) >= 32:
                fields["id64"] = struct.unpack("<8i", pay)
            elif pid == 32 and len(pay) >= 4:
                fields["fontSizeValue"] = struct.unpack_from("<I", pay, 0)[0]
            elif pid == 39 and len(pay) >= 4:
                fields["charCount39"] = struct.unpack_from("<I", pay, 0)[0]
            elif pid == 50 and len(pay) >= 4:
                fields["id50"] = struct.unpack_from("<I", pay, 0)[0]
            elif pid == 72 and len(pay) >= 8:
                fields["id72"] = struct.unpack("<II", pay)
        off += 8 + plen

    offscreens = [
        {
            "mainId": r[0],
            "layerId": r[1],
            "attr_len": r[2],
            "blockData_len": r[3],
            "ext": bytes(r[4]).decode("ascii", errors="replace").replace("\x00", "") if r[4] else "",
        }
        for r in conn.execute(
            "SELECT MainId, LayerId, length(Attribute), length(BlockData), BlockData "
            "FROM Offscreen ORDER BY MainId"
        ).fetchall()
    ]
    exta_count = sum(1 for c in chunks if c["name"] == "CHNKExta")
    seq = dict(conn.execute("SELECT name, seq FROM sqlite_sequence").fetchall())
    canvas_work = conn.execute("SELECT CanvasWorkTime FROM Canvas").fetchone()
    conn.close()
    bbox = fields.get("bbox")
    pitch = None
    if bbox:
        h = bbox[3] - bbox[1]
        cc = fields.get("charCount39") or utf16_units(text)
        if cc > 0:
            pitch = h / cc
    return {
        "text": text,
        "utf16": utf16_units(text),
        "layerOffset": (row["LayerOffsetX"], row["LayerOffsetY"]),
        "renderOffscr": (row["LayerRenderOffscrOffsetX"], row["LayerRenderOffscrOffsetY"]),
        **fields,
        "pitch_px_per_char": round(pitch, 3) if pitch else None,
        "offscreen_count": len(offscreens),
        "offscreen_l5": [o for o in offscreens if o["layerId"] == 5],
        "exta_count": exta_count,
        "sqlite_sequence": seq,
        "canvasWorkTime": canvas_work[0] if canvas_work else None,
    }


def main() -> None:
    report: dict = {"experiments": {}}
    for name in EXPERIMENTS:
        orig = ORIGINAL
        gen = GEN_DIR / f"{name}.clip"
        user = USER_DIR / f"{name}.clip"
        exp: dict = {
            "files": {"original": str(orig), "generated": str(gen), "user": str(user)},
            "metrics": {
                "original": extract_l5_metrics(orig),
                "generated": extract_l5_metrics(gen),
                "user": extract_l5_metrics(user),
            },
        }
        # Lightweight TLV diff summary (gen vs user, layer 5 only)
        try:
            d = diff_clips(gen, user, "generated", "user_csp")
            l5 = next((l for l in d["text_layers"] if l["mainId"] == 5), None)
            exp["tlv_diff_gen_vs_user"] = {
                "attr_diff_count": l5["attr_tlv"]["diff_count"] if l5 and "attr_tlv" in l5 else 0,
                "add_diff_count": l5["add_tlv"]["diff_count"] if l5 and "add_tlv" in l5 else 0,
                "attr_diffs": l5["attr_tlv"].get("diffs", []) if l5 and "attr_tlv" in l5 else [],
                "add_diffs": l5["add_tlv"].get("diffs", []) if l5 and "add_tlv" in l5 else [],
            }
            exp["side_effects"] = {
                "exta_count_gen": len(d["exta"]["left"]),
                "exta_count_user": len(d["exta"]["right"]),
                "offscreen_count_gen": len(d["offscreen"]["left"]),
                "offscreen_count_user": len(d["offscreen"]["right"]),
                "table_diffs": {
                    t: {
                        "column_diff_count": td.get("column_diff_count", 0),
                        "only_left": td.get("only_left_count", 0),
                        "only_right": td.get("only_right_count", 0),
                    }
                    for t, td in d["tables"].items()
                    if td.get("column_diff_count", 0)
                    or td.get("only_left_count", 0)
                    or td.get("only_right_count", 0)
                },
            }
        except Exception as e:
            exp["diff_error"] = str(e)
        report["experiments"][name] = exp
        print(f"\n{'='*60}\n{name}")
        um = exp["metrics"]["user"]
        gm = exp["metrics"]["generated"]
        if "error" in um:
            print(f"  user: {um['error']}")
        else:
            print(f"  user text={um['text']!r} utf16={um['utf16']}")
            print(f"  user bbox={um.get('bbox')} size63={um.get('size63')} pitch={um.get('pitch_px_per_char')}")
            print(f"  user fontSizeValue={um.get('fontSizeValue')} id50={um.get('id50')}")
        if "error" not in gm and "error" not in um:
            if um.get("bbox") != gm.get("bbox"):
                print(f"  GEN bbox={gm.get('bbox')} -> USER bbox={um.get('bbox')}")

    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWritten: {OUT}")


if __name__ == "__main__":
    main()
