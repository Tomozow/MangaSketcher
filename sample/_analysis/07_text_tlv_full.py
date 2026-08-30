"""Step 7: Full boundary-validated TLV parse of TextLayerAttributes and
TextLayerAddAttributesV01 for all text layers.

TextLayerAttributes:     [param_id u32 LE][payload_len u32 LE][payload]*
TextLayerAddAttributesV01: [total_len u32 LE (=blob_len-4)][same TLV stream]*

Run-array payloads (Attributes, full form):
  [count u32][reserved u32=0][value_type u32 (=UTF-16 char count)][inner_len u32][inner...]

Run-array payloads (AddAttributes, compact form):
  id 11: [count u32][inner_len u32=14][14 zero bytes]
  others: [count u32][inner_len u32][inner...]  (inner often 4 zero bytes)

Usage: python 07_text_tlv_full.py
"""
from __future__ import annotations

import sqlite3
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"
OUT = HERE / "07_output.txt"

RUN_ARRAY_IDS = {11, 12, 13, 18, 26, 29, 30, 65}
COMPACT_RUN_IDS = {12, 13, 18, 26, 29, 30, 65}

lines: list[str] = []


def w(s: str = "") -> None:
    lines.append(s)


def hexdump(b: bytes, base: int = 0, limit: int | None = None) -> None:
    n = len(b) if limit is None else min(len(b), limit)
    for i in range(0, n, 16):
        chunk = b[i : i + 16]
        hexs = " ".join(f"{x:02x}" for x in chunk)
        asc = "".join(chr(x) if 32 <= x < 127 else "." for x in chunk)
        w(f"    {base + i:06x}  {hexs:<47}  {asc}")
    if limit is not None and len(b) > limit:
        w(f"    ... ({len(b) - limit} more bytes)")


def utf16_units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


@dataclass
class Tlv:
    offset: int
    param_id: int
    length: int
    payload: bytes
    children: list[Any] = field(default_factory=list)
    note: str = ""


def parse_tlv_stream(data: bytes, start: int = 0) -> tuple[list[Tlv], int, bytes]:
    """Parse TLVs; return (entries, bytes_consumed, trailing)."""
    entries: list[Tlv] = []
    off = start
    n = len(data)
    while off + 8 <= n:
        pid, plen = struct.unpack_from("<II", data, off)
        if plen > n - off - 8:
            trailing = data[off:]
            return entries, off - start, trailing
        payload = data[off + 8 : off + 8 + plen]
        entries.append(Tlv(off, pid, plen, payload))
        off += 8 + plen
    trailing = data[off:]
    return entries, off - start, trailing


def parse_run_array_full(payload: bytes, param_id: int) -> list[str]:
    notes: list[str] = []
    if len(payload) < 16:
        notes.append(f"short({len(payload)}B)")
        return notes
    count, resv, vtype, ilen = struct.unpack_from("<IIII", payload, 0)
    notes.append(f"count={count} resv={resv} vtype={vtype} inner_len={ilen}")
    inner = payload[16 : 16 + ilen]
    if 16 + ilen != len(payload):
        notes.append(f"UNCONSUMED={len(payload) - 16 - ilen}B")
        extra = payload[16 + ilen :]
        notes.append(f"tail_hex={extra[:32].hex()}")
    if param_id == 11:
        if ilen + 16 == len(payload):
            notes.append(f"inner_len={ilen}")
            if ilen >= 4:
                flags = struct.unpack_from("<I", inner, 0)[0]
                notes.append(f"flags={flags:#x}")
            if ilen > 8:
                rest = inner[8:]
                for start in range(0, min(16, len(rest) - 2), 2):
                    try:
                        s = rest[start:].decode("utf-16-le").split("\x00")[0]
                        if len(s) >= 3:
                            notes.append(f"utf16_font={s!r}")
                            break
                    except UnicodeDecodeError:
                        pass
                notes.append(f"inner_hex={inner.hex()}")
        else:
            pad = payload[16:]
            notes.append(f"default_style_size={ilen} pad={len(pad)}B zeros={pad == bytes(len(pad))}")
    elif param_id == 13 and ilen == 18:
        u16 = struct.unpack_from("<H", inner, 0)[0]
        d1, d2 = struct.unpack_from("<dd", inner, 2)
        notes.append(f"u16={u16} f64=({d1:.8g},{d2:.8g})")
    elif param_id == 26 and ilen == 16:
        d1, d2 = struct.unpack_from("<dd", inner, 0)
        notes.append(f"scale%=({d1:.8g},{d2:.8g})")
    elif param_id in (12, 18, 29, 65) and ilen == 2:
        notes.append(f"u16={struct.unpack('<H', inner)[0]}")
    elif param_id == 30:
        notes.extend(parse_id30_runs(inner, vtype))
    elif ilen == 4:
        u32 = struct.unpack_from("<I", inner, 0)[0]
        f32 = struct.unpack_from("<f", inner, 0)[0]
        notes.append(f"u32={u32} f32={f32:.6g}")
    elif ilen == 2:
        notes.append(f"u16={struct.unpack('<H', inner)[0]}")
    elif ilen == 8:
        notes.append(f"u32x2={struct.unpack('<II', inner)}")
    elif ilen == 16:
        notes.append(f"f64x2={tuple(round(x, 6) for x in struct.unpack('<dd', inner))}")
    else:
        notes.append(f"inner_hex={inner[:64].hex()}{'...' if len(inner) > 64 else ''}")
    return notes


def parse_id30_runs(inner: bytes, char_count: int) -> list[str]:
    notes: list[str] = [f"id30_runs bytes={len(inner)} char_count={char_count}"]
    pos = 0
    idx = 0
    while pos < len(inner) and idx < 64:
        if pos + 12 > len(inner):
            notes.append(f"  [{idx}]@{pos} tail={inner[pos:].hex()}")
            break
        a, b, c = struct.unpack_from("<III", inner, pos)
        if b == 4 and pos + 12 <= len(inner):
            notes.append(f"  [{idx}]@{pos} start={a} kind=4 value={c}")
            pos += 12
        elif b == 3 and pos + 16 <= len(inner):
            d = struct.unpack_from("<I", inner, pos + 12)[0]
            notes.append(f"  [{idx}]@{pos} start={a} kind=3 inner_len={c} value={d}")
            pos += 16
        else:
            notes.append(f"  [{idx}]@{pos} raw3=({a},{b},{c})")
            pos += 12
        idx += 1
    if pos < len(inner):
        notes.append(f"  UNCONSUMED id30={len(inner) - pos}B")
    return notes


def parse_run_array_compact(payload: bytes, param_id: int) -> list[str]:
    notes: list[str] = []
    if len(payload) < 4:
        notes.append(f"short({len(payload)}B) hex={payload.hex()}")
        return notes
    count = struct.unpack_from("<I", payload, 0)[0]
    if param_id == 30 and len(payload) == 4 + count * 8:
        entries = [struct.unpack_from("<II", payload, 4 + i * 8) for i in range(count)]
        notes.append(f"id30_compact count={count} pairs={entries[:8]}{'...' if count > 8 else ''}")
        return notes
    if len(payload) < 8:
        notes.append(f"count={count} short")
        return notes
    ilen = struct.unpack_from("<I", payload, 4)[0]
    inner = payload[8 : 8 + ilen]
    notes.append(f"compact count={count} inner_len={ilen}")
    if 8 + ilen != len(payload):
        notes.append(f"UNCONSUMED={len(payload) - 8 - ilen}B tail={payload[8+ilen:].hex()}")
    if param_id == 30 and count > 1 and ilen == 4 and 8 + ilen == len(payload):
        notes.append(f"u32={struct.unpack('<I', inner)[0]}")
    elif ilen == 4 and len(inner) == 4:
        notes.append(f"u32={struct.unpack('<I', inner)[0]}")
    elif ilen == 14:
        notes.append(f"pad14={inner.hex()}")
        if len(inner) >= 4:
            notes.append(f"flags?={struct.unpack('<I', inner[:4])[0]:#x}")
    elif ilen == 16:
        notes.append(f"f64x2={tuple(round(x, 6) for x in struct.unpack('<dd', inner))}")
    else:
        notes.append(f"inner_hex={inner[:48].hex()}")
    return notes


def decode_scalar(param_id: int, payload: bytes) -> str:
    if len(payload) == 0:
        return "(empty)"
    if param_id == 31:
        try:
            return f"utf8={payload.split(b'\\x00')[0].decode('utf-8')!r}"
        except UnicodeDecodeError:
            return f"raw={payload.hex()}"
    if param_id == 32:
        v = struct.unpack("<I", payload[:4])[0]
        return f"u32={v} (~{v/50:.2f}pt? or {v/100:.2f})"
    if param_id == 37:
        v = struct.unpack("<I", payload[:4])[0]
        return f"u32={v} (={v/100:.5f} mm/pt)"
    if param_id == 44:
        v = struct.unpack("<I", payload[:4])[0]
        return f"u32={v} (={v/1000:.4f} px/pt@dpi)"
    if param_id == 39:
        lo, hi = struct.unpack("<II", payload[:8])
        return f"u64=({lo},{hi}) char_count={lo}"
    if param_id == 42:
        l, t, r, b = struct.unpack("<4I", payload[:16])
        return f"bbox canvas=({l},{t},{r},{b}) size=({r-l}x{b-t})"
    if param_id == 47:
        return f"subst_font blob={payload.hex()}"
    if param_id == 50:
        return f"Offscreen.MainId={struct.unpack('<I', payload[:4])[0]}"
    if param_id == 57:
        return decode_font_descriptor(payload)
    if param_id == 63:
        a, b = struct.unpack("<II", payload[:8])
        return f"size=({a},{b})"
    if param_id == 64:
        ints = struct.unpack("<8i", payload[:32])
        return (
            f"i32x8={ints} (w~{-ints[0]/100:.0f} h~{ints[5]/100:.0f})"
        )
    if param_id == 72:
        a, b = struct.unpack("<II", payload[:8])
        return f"u32x2=({a},{b})"
    if param_id == 34:
        if len(payload) == 12:
            r, g, b, a = struct.unpack("<4I", payload[:16]) if len(payload) >= 16 else (0, 0, 0, 0)
            if payload == b"\x00" * 12:
                return "RGBA=(0,0,0,0) all-zero black candidate"
            return f"bytes12={payload.hex()}"
    if len(payload) == 4:
        u = struct.unpack("<I", payload)[0]
        f = struct.unpack("<f", payload)[0]
        return f"u32={u} f32={f:.6g}"
    if len(payload) == 8:
        u2 = struct.unpack("<II", payload)
        d = struct.unpack("<d", payload)[0]
        return f"u32x2={u2} f64={d:.6g}"
    if len(payload) == 12:
        return f"bytes12={payload.hex()}"
    if len(payload) == 16:
        return f"u32x4={struct.unpack('<4I', payload)}"
    if len(payload) == 20:
        return f"bytes20={payload.hex()}"
    if len(payload) == 24:
        return f"bytes24={payload.hex()}"
    if len(payload) == 32:
        return f"bytes32={payload.hex()}"
    return f"raw[{len(payload)}]={payload[:48].hex()}{'...' if len(payload) > 48 else ''}"


def decode_font_descriptor(payload: bytes) -> str:
    if len(payload) < 4:
        return payload.hex()
    ver = payload[0]
    name_len = payload[2]
    name = payload[4 : 4 + name_len].split(b"\x00")[0].decode("utf-8", errors="replace")
    off = 4 + name_len
    if off + 2 > len(payload):
        return f"ver={ver} display={name!r}"
    ps_len = struct.unpack_from("<H", payload, off)[0]
    off += 2
    ps = payload[off : off + ps_len].split(b"\x00")[0].decode("ascii", errors="replace")
    return f"ver={ver} display={name!r} ps={ps!r}"


def describe_tlv(tlv: Tlv, *, compact: bool) -> None:
    pid, payload = tlv.param_id, tlv.payload
    if pid in RUN_ARRAY_IDS:
        if compact:
            parts = parse_run_array_compact(payload, pid)
        else:
            parts = parse_run_array_full(payload, pid)
        desc = " | ".join(parts)
    else:
        desc = decode_scalar(pid, payload)
    w(f"  @{tlv.offset:4d}  id={pid:<3} len={tlv.length:<4}  {desc}")
    # nested TLV inside payload?
    if pid in (47,) and len(payload) > 16:
        nested, consumed, trail = parse_tlv_stream(payload)
        if nested and not trail:
            w(f"         nested TLV ({len(nested)} children, {consumed}B)")
            for ch in nested:
                describe_tlv(ch, compact=False)


def analyze_blob(name: str, data: bytes, *, is_add: bool) -> dict[int, bytes]:
    w(f"  -- {name}: total {len(data)} bytes")
    start = 0
    if is_add:
        if len(data) < 4:
            w("  ERROR: too short for Add header")
            return {}
        hdr = struct.unpack_from("<I", data, 0)[0]
        ok = hdr == len(data) - 4
        w(f"  header u32={hdr}  (len-4={len(data)-4}, match={ok})")
        start = 4
    tlvs, consumed, trail = parse_tlv_stream(data, start)
    w(f"  TLV count={len(tlvs)}  parsed={consumed + start}B  trailing={len(trail)}B")
    if trail:
        w(f"  *** TRAILING {len(trail)} bytes (unattributed) ***")
        hexdump(trail, base=start + consumed)
    by_id: dict[int, bytes] = {}
    for tlv in tlvs:
        by_id[tlv.param_id] = tlv.payload
        describe_tlv(tlv, compact=is_add and tlv.param_id in RUN_ARRAY_IDS)
    w()
    return by_id


def cross_layer_diff(all_attrs: dict[int, dict[int, bytes]], all_add: dict[int, dict[int, bytes]]) -> None:
    w("=" * 72)
    w("CROSS-LAYER DIFF SUMMARY")
    w("=" * 72)
    ids = sorted({pid for m in all_attrs.values() for pid in m})
    for pid in ids:
        payloads = {mid: all_attrs[mid].get(pid) for mid in sorted(all_attrs)}
        uniq = {p for p in payloads.values() if p is not None}
        if len(uniq) <= 1:
            continue
        w(f"id={pid}:")
        for mid, p in payloads.items():
            if p is None:
                continue
            if pid in RUN_ARRAY_IDS:
                w(f"  L{mid}: {parse_run_array_full(p, pid)[0] if pid not in (30,) else f'len={len(p)}'}")
            else:
                w(f"  L{mid}: {decode_scalar(pid, p)}")
    w()
    w("AddAttributes compact diffs (run-array ids):")
    for pid in sorted(RUN_ARRAY_IDS):
        payloads = {mid: all_add[mid].get(pid) for mid in sorted(all_add)}
        uniq = {p for p in payloads.values() if p is not None}
        if len(uniq) <= 1:
            continue
        w(f"  id={pid}:")
        for mid, p in payloads.items():
            if p:
                w(f"    L{mid}: {' | '.join(parse_run_array_compact(p, pid))}")


def coord_analysis(rows: list[sqlite3.Row]) -> None:
    w("=" * 72)
    w("COORDINATE / OFFSET CORRELATION")
    w("=" * 72)
    for row in rows:
        mid = row["MainId"]
        text = row["TextLayerString"].decode("utf-8")
        u16 = utf16_units(text)
        lx, ly = row["LayerOffsetX"], row["LayerOffsetY"]
        rx, ry = row["LayerRenderOffscrOffsetX"], row["LayerRenderOffscrOffsetY"]
        attr = row["TextLayerAttributes"]
        off = 0
        bbox = size = offscreen_ref = None
        while off + 8 <= len(attr):
            pid, plen = struct.unpack_from("<II", attr, off)
            pay = attr[off + 8 : off + 8 + plen]
            if pid == 42:
                bbox = struct.unpack("<4I", pay)
            if pid == 63:
                size = struct.unpack("<II", pay)
            if pid == 50:
                offscreen_ref = struct.unpack("<I", pay)[0]
            off += 8 + plen
        w(f"MainId={mid} utf16={u16} LayerOffset=({lx},{ly}) RenderOffscr=({rx},{ry})")
        if bbox:
            l, t, r, b = bbox
            w(f"  id42 canvas bbox ({l},{t},{r},{b})  size {r-l}x{b-t}")
            w(f"  bbox_left - LayerOffsetX = {l - lx}   bbox_top - LayerOffsetY = {t - ly}")
        if size:
            w(f"  id63 size={size}  (matches bbox size: {bbox and size[0]==bbox[2]-bbox[0] and size[1]==bbox[3]-bbox[1]})")
        if offscreen_ref:
            w(f"  id50 -> Offscreen.MainId={offscreen_ref}")
    w()


def main() -> None:
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM Layer WHERE TextLayerString IS NOT NULL ORDER BY MainId"
    ).fetchall()
    w(f"text layers: {len(rows)}")
    w()

    all_attrs: dict[int, dict[int, bytes]] = {}
    all_add: dict[int, dict[int, bytes]] = {}

    for row in rows:
        mid = row["MainId"]
        text = row["TextLayerString"].decode("utf-8")
        w("=" * 72)
        w(f"Layer MainId={mid}  name={row['LayerName']!r}")
        w(f"  TextLayerString utf-8 ({len(row['TextLayerString'])}B): {text!r}")
        w(f"  UTF-16 units: {utf16_units(text)}")
        w(
            f"  LayerOffset=({row['LayerOffsetX']},{row['LayerOffsetY']})  "
            f"RenderOffscr=({row['LayerRenderOffscrOffsetX']},{row['LayerRenderOffscrOffsetY']})"
        )
        w()
        all_attrs[mid] = analyze_blob("TextLayerAttributes", row["TextLayerAttributes"], is_add=False)
        all_add[mid] = analyze_blob("TextLayerAddAttributesV01", row["TextLayerAddAttributesV01"], is_add=True)

    coord_analysis(rows)
    cross_layer_diff(all_attrs, all_add)

    # Attr vs Add identity check for shared scalars
    w("=" * 72)
    w("Attributes vs AddAttributes scalar identity (should match for L5)")
    w("=" * 72)
    mismatches = []
    for mid in sorted(all_attrs):
        for pid in sorted(set(all_attrs[mid]) & set(all_add[mid])):
            a, d = all_attrs[mid][pid], all_add[mid][pid]
            if pid in RUN_ARRAY_IDS:
                continue
            if a != d:
                mismatches.append(f"  L{mid} id={pid}: MISMATCH attr_len={len(a)} add_len={len(d)}")
    for line in mismatches:
        w(line)
    if not mismatches:
        w("  all non-run scalars identical between Attr and Add")
    else:
        w(f"  ({len(mismatches)} expected mismatches: id57 empty in Add; L7 id16/id20 compact)")
    w()

    conn.close()
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
