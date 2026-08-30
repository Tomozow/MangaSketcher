"""Step 4: Map Layer -> Mipmap -> MipmapInfo -> Offscreen -> external chunk,
parse Offscreen.Attribute, walk BlockData blocks inside the CHNKExta payload,
and zlib-decompress one block to confirm compression + pixel format.

Also dumps ExternalTableAndColumnName, CanvasPreview and scans ParamScheme
for version-ish entries.

Output: 04_output.txt (UTF-8)

Usage: python 04_raster_chain.py
"""
from __future__ import annotations

import sqlite3
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"
CLIP = HERE.parent / "export_sample.clip"
OUT = HERE / "04_output.txt"

lines: list[str] = []


def w(s: str = "") -> None:
    lines.append(s)


def load_extas() -> dict[str, bytes]:
    data = CLIP.read_bytes()
    _, first_off = struct.unpack_from(">QQ", data, 8)
    extas: dict[str, bytes] = {}
    off = first_off
    n = len(data)
    while off < n:
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        payload_off = off + 16
        if name == "CHNKExta":
            idlen = struct.unpack_from(">Q", data, payload_off)[0]
            eid = data[payload_off + 8 : payload_off + 8 + idlen].decode("ascii")
            blen = struct.unpack_from(">Q", data, payload_off + 8 + idlen)[0]
            body_off = payload_off + 16 + idlen
            extas[eid] = data[body_off : body_off + blen]
        off = payload_off + length
    return extas


def parse_attribute(attr: bytes) -> dict:
    """Offscreen.Attribute: [hdr u32BE x4][Parameter sec][InitColor sec][BlockSize sec].
    Each section: [name_len u32BE][name UTF-16BE][payload]."""
    out: dict = {}
    hdr = struct.unpack_from(">4I", attr, 0)
    out["header"] = hdr  # (16, param_len, init_len, blocksize_len)
    off = 16

    def read_section(off: int) -> tuple[str, int, int]:
        nlen = struct.unpack_from(">I", attr, off)[0]
        name = attr[off + 4 : off + 4 + nlen * 2].decode("utf-16-be")
        return name, off + 4 + nlen * 2, nlen

    name, poff, _ = read_section(off)
    assert name == "Parameter", name
    params = struct.unpack_from(">20I", attr, poff)
    out["parameter"] = params
    off += hdr[1]

    name, ioff, _ = read_section(off)
    assert name == "InitColor", name
    init_payload = attr[ioff : off + hdr[2]]
    out["init_color_raw"] = init_payload
    off += hdr[2]

    name, boff, _ = read_section(off)
    assert name == "BlockSize", name
    b0, cnt, esz = struct.unpack_from(">3I", attr, boff)
    sizes = struct.unpack_from(f">{cnt}I", attr, boff + 12)
    out["block_sizes"] = list(sizes)
    out["block_meta"] = (b0, cnt, esz)
    return out


def walk_blocks(body: bytes) -> list[dict]:
    """Scan BlockDataBeginChunk entries in an external chunk body."""
    begin = "BlockDataBeginChunk".encode("utf-16-be")
    out = []
    p = 0
    while True:
        i = body.find(begin, p)
        if i < 0:
            break
        q = i + len(begin)
        idx, uncomp, bh, bw, flag = struct.unpack_from(">5I", body, q)
        rec = {
            "offset_in_body": i - 4 - 4,  # label starts after [total u32][name_len u32]
            "index": idx,
            "uncompressed_len_field": uncomp,
            "block_h": bh,
            "block_w": bw,
            "has_data": flag,
        }
        if flag:
            outer = struct.unpack_from(">I", body, q + 20)[0]
            inner = struct.unpack_from("<I", body, q + 24)[0]
            rec["outer_len_be"] = outer
            rec["inner_len_le"] = inner
            rec["zlib_off"] = q + 28
        out.append(rec)
        p = q
    return out


def main() -> None:
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    extas = load_extas()

    w("=== ExternalTableAndColumnName ===")
    for r in conn.execute("SELECT * FROM ExternalTableAndColumnName"):
        w(f"  {dict(r)}")
    w()

    w("=== Offscreen table columns ===")
    w(", ".join(r[1] for r in conn.execute("PRAGMA table_info('Offscreen')")))
    w("=== Mipmap columns ===")
    w(", ".join(r[1] for r in conn.execute("PRAGMA table_info('Mipmap')")))
    w("=== MipmapInfo columns ===")
    w(", ".join(r[1] for r in conn.execute("PRAGMA table_info('MipmapInfo')")))
    w()

    layers = conn.execute(
        "SELECT MainId, LayerName, LayerType, LayerRenderMipmap, LayerLayerMaskMipmap "
        "FROM Layer ORDER BY MainId"
    ).fetchall()

    for lay in layers:
        w(f"=== Layer {lay['MainId']} {lay['LayerName']!r} (type={lay['LayerType']}) ===")
        for role, mip_id in (("render", lay["LayerRenderMipmap"]), ("mask", lay["LayerLayerMaskMipmap"])):
            if not mip_id:
                continue
            mip = conn.execute("SELECT * FROM Mipmap WHERE MainId=?", (mip_id,)).fetchone()
            if not mip:
                continue
            w(f"  [{role}] Mipmap MainId={mip['MainId']} MipmapCount={mip['MipmapCount'] if 'MipmapCount' in mip.keys() else '?'} BaseMipmapInfo={mip['BaseMipmapInfo']}")
            cur = mip["BaseMipmapInfo"]
            level = 0
            seen = set()
            while cur and cur not in seen:
                seen.add(cur)
                info = conn.execute("SELECT * FROM MipmapInfo WHERE MainId=?", (cur,)).fetchone()
                if not info:
                    break
                off_id = info["Offscreen"]
                osc = conn.execute("SELECT * FROM Offscreen WHERE MainId=?", (off_id,)).fetchone()
                if osc:
                    attr = parse_attribute(osc["Attribute"])
                    p = attr["parameter"]
                    eid = osc["BlockData"].decode("ascii") if isinstance(osc["BlockData"], bytes) else osc["BlockData"]
                    in_file = eid in extas
                    total_blocks = attr["block_meta"][1]
                    nonzero = sum(1 for s in attr["block_sizes"] if s)
                    w(
                        f"    L{level}: MipmapInfo={cur} scale={info['ThisScale']} -> Offscreen={off_id} "
                        f"w={p[0]} h={p[1]} grid={p[2]}x{p[3]} p4..9={p[4:10]}"
                    )
                    w(
                        f"        BlockData={eid} (in CHNKExta: {in_file}, body={len(extas.get(eid, b''))}B) "
                        f"blocks={total_blocks} nonzero_blocks={nonzero}"
                    )
                    w(f"        attr.parameter[10:20]={p[10:20]}")
                    ic = attr["init_color_raw"]
                    w(f"        InitColor payload ({len(ic)}B): {ic.hex()}")
                cur = info["NextIndex"]
                level += 1
        w()

    # --- block walk on the two raster layers + one text layer body
    w("=== external chunk block structure ===")
    for eid, body in extas.items():
        blocks = walk_blocks(body)
        w(f"--- {eid}: body {len(body)}B, {len(blocks)} BlockDataBeginChunk entries")
        if not blocks:
            w(f"    head hex: {body[:64].hex()}")
            continue
        for b in blocks[:4]:
            w(f"    {b}")
        if len(blocks) > 4:
            w(f"    ... {len(blocks) - 4} more blocks")
        # decompress first data block
        first = next((b for b in blocks if b["has_data"]), None)
        if first:
            z = body[first["zlib_off"] : first["zlib_off"] + first["inner_len_le"]]
            try:
                raw = zlib.decompress(z)
                bpp = len(raw) / (first["block_w"] * first["block_h"])
                w(
                    f"    zlib OK: inner {first['inner_len_le']}B -> raw {len(raw)}B "
                    f"({first['block_w']}x{first['block_h']} => {bpp:.2f} bytes/px), "
                    f"uncomp_field={first['uncompressed_len_field']}"
                )
                # plane stats: for 5bpp expect A plane + BGRA
                n = first["block_w"] * first["block_h"]
                if len(raw) == n * 5:
                    a = raw[:n]
                    w(f"      plane0 (alpha?) min={min(a)} max={max(a)} nonzero={sum(1 for x in a if x)}")
                    bgra = raw[n : n * 5]
                    w(f"      plane1 first 32B: {bgra[:32].hex()}")
                elif len(raw) == n:
                    w(f"      single plane min={min(raw)} max={max(raw)} nonzero={sum(1 for x in raw if x)}")
                else:
                    w(f"      raw head: {raw[:48].hex()}")
            except Exception as e:  # noqa: BLE001
                w(f"    zlib FAILED: {e}; head={z[:16].hex()}")
        # tail labels (BlockStatus/BlockCheckSum)
        for label in ("BlockStatus", "BlockCheckSum"):
            enc = label.encode("utf-16-be")
            i = body.find(enc)
            if i >= 0:
                cnt = struct.unpack_from(">I", body, i + len(enc) + 4)[0]
                w(f"    tail label {label} at {i}, count={cnt}")
        w()

    # --- CanvasPreview
    w("=== CanvasPreview ===")
    for r in conn.execute("SELECT * FROM CanvasPreview"):
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, bytes):
                d[k] = f"blob[{len(v)}] head={v[:16].hex()}"
        w(f"  {d}")
    w()

    # --- ParamScheme version-ish rows
    w("=== ParamScheme (version / schema related rows) ===")
    cols = [r[1] for r in conn.execute("PRAGMA table_info('ParamScheme')")]
    w(f"  columns: {cols}")
    w("  first 5 rows:")
    for r in conn.execute("SELECT * FROM ParamScheme LIMIT 5"):
        w(f"    {dict(r)}")
    text_cols = [
        r[1]
        for r in conn.execute("PRAGMA table_info('ParamScheme')")
        if (r[2] or "").upper() in ("TEXT", "")
    ]
    if text_cols:
        cond = " OR ".join(f"{c} LIKE '%ersion%'" for c in text_cols)
        for r in conn.execute(f"SELECT * FROM ParamScheme WHERE {cond} LIMIT 40"):
            w(f"  {dict(r)}")
    w()
    w("=== ElemScheme sample (first 10) ===")
    for r in conn.execute("SELECT * FROM ElemScheme LIMIT 10"):
        w(f"  {dict(r)}")
    w()
    w("=== sqlite_sequence ===")
    for r in conn.execute("SELECT * FROM sqlite_sequence"):
        w(f"  {dict(r)}")

    conn.close()
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
