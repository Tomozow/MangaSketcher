"""Step 5: Complete the external-chunk mapping (LayerThumbnail offscreens),
list every Offscreen row with its owner, and print the layer tree in
FirstChild/Next order.

Output: 05_output.txt (UTF-8)

Usage: python 05_thumbnails_and_tree.py
"""
from __future__ import annotations

import sqlite3
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"
CLIP = HERE.parent / "export_sample.clip"
OUT = HERE / "05_output.txt"

lines: list[str] = []


def w(s: str = "") -> None:
    lines.append(s)


def load_exta_ids() -> set[str]:
    data = CLIP.read_bytes()
    _, first_off = struct.unpack_from(">QQ", data, 8)
    ids = set()
    off = first_off
    while off < len(data):
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        if name == "CHNKExta":
            idlen = struct.unpack_from(">Q", data, off + 16)[0]
            ids.add(data[off + 24 : off + 24 + idlen].decode("ascii"))
        off = off + 16 + length
    return ids


def attr_wh(attr: bytes) -> tuple[int, int, int, int]:
    nlen = struct.unpack_from(">I", attr, 16)[0]
    poff = 20 + nlen * 2
    return struct.unpack_from(">4I", attr, poff)


def main() -> None:
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    exta_ids = load_exta_ids()

    w("=== LayerThumbnail columns ===")
    w(", ".join(r[1] for r in conn.execute("PRAGMA table_info('LayerThumbnail')")))
    w()
    w("=== LayerThumbnail rows ===")
    for r in conn.execute("SELECT * FROM LayerThumbnail ORDER BY MainId"):
        d = {}
        for k in r.keys():
            v = r[k]
            if v is None:
                continue
            if isinstance(v, bytes):
                v = f"blob[{len(v)}]"
            d[k] = v
        w(f"  {d}")
    w()

    w("=== all Offscreen rows -> owner & external chunk presence ===")
    rows = conn.execute("SELECT * FROM Offscreen ORDER BY MainId").fetchall()
    used_ids = set()
    for r in rows:
        eid = r["BlockData"].decode("ascii") if isinstance(r["BlockData"], bytes) else r["BlockData"]
        used_ids.add(eid)
        wdt, hgt, gw, gh = attr_wh(r["Attribute"])
        # owner: which mipmapinfo / thumbnail references it
        mi = conn.execute("SELECT MainId, LayerId FROM MipmapInfo WHERE Offscreen=?", (r["MainId"],)).fetchone()
        th = conn.execute(
            "SELECT MainId, LayerId FROM LayerThumbnail WHERE ThumbnailOffscreen=?", (r["MainId"],)
        ).fetchone()
        owner = []
        if mi:
            owner.append(f"MipmapInfo {mi['MainId']} (layer {mi['LayerId']})")
        if th:
            owner.append(f"LayerThumbnail {th['MainId']} (layer {th['LayerId']})")
        w(
            f"  Offscreen {r['MainId']:>3} layer={r['LayerId']:>2} {wdt}x{hgt} grid {gw}x{gh} "
            f"eid={eid} inExta={eid in exta_ids} owner={'; '.join(owner) or 'NONE'}"
        )
    w()
    w(f"CHNKExta ids never referenced by Offscreen.BlockData: {sorted(exta_ids - used_ids)}")
    w()

    w("=== layer tree (FirstChild / Next chain from CanvasRootFolder) ===")
    root = conn.execute("SELECT CanvasRootFolder, CanvasCurrentLayer FROM Canvas").fetchone()
    w(f"CanvasRootFolder={root['CanvasRootFolder']} CanvasCurrentLayer={root['CanvasCurrentLayer']}")

    def visit(layer_id: int, depth: int) -> None:
        r = conn.execute(
            "SELECT MainId, LayerName, LayerType, LayerFolder, LayerVisibility, LayerOpacity, "
            "LayerFirstChildIndex, LayerNextIndex FROM Layer WHERE MainId=?",
            (layer_id,),
        ).fetchone()
        if not r:
            w("  " * depth + f"- <missing {layer_id}>")
            return
        w(
            "  " * depth
            + f"- MainId={r['MainId']} {r['LayerName']!r} type={r['LayerType']} folder={r['LayerFolder']} "
            f"vis={r['LayerVisibility']} opacity={r['LayerOpacity']} next={r['LayerNextIndex']} child={r['LayerFirstChildIndex']}"
        )
        if r["LayerFirstChildIndex"]:
            visit(r["LayerFirstChildIndex"], depth + 1)
        if r["LayerNextIndex"]:
            visit(r["LayerNextIndex"], depth)

    visit(root["CanvasRootFolder"], 0)

    conn.close()
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
