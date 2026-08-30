"""Step 3: Inspect TEXT layers (LayerType=0 with TextLayerString).

For each text layer:
- decode TextLayerString (UTF-8 blob).
- dump TextLayerAttributes / TextLayerAddAttributesV01: size, hex of first ~300B,
  strings via UTF-8 / UTF-16LE / UTF-16BE / CP932 scans.
- parse the TLV structure: [param_id u32 LE][payload_len u32 LE][payload].
  Most payloads look like [count u32][reserved u32][value_type u32][inner_len u32][data].

Output is written UTF-8 to 03_output.txt (console cp932-safe).

Usage: python 03_text_layers.py
"""
from __future__ import annotations

import re
import sqlite3
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"
OUT = HERE / "03_output.txt"

lines: list[str] = []


def w(s: str = "") -> None:
    lines.append(s)


def hexdump(b: bytes, limit: int = 304) -> str:
    out = []
    for i in range(0, min(len(b), limit), 16):
        chunk = b[i : i + 16]
        hexs = " ".join(f"{x:02x}" for x in chunk)
        asc = "".join(chr(x) if 32 <= x < 127 else "." for x in chunk)
        out.append(f"  {i:06x}  {hexs:<47}  {asc}")
    if len(b) > limit:
        out.append(f"  ... ({len(b) - limit} more bytes)")
    return "\n".join(out)


def find_strings_utf16(b: bytes, endian: str) -> list[tuple[int, str]]:
    fmt = "<H" if endian == "le" else ">H"
    found = []
    i = 0
    n = len(b)
    while i + 2 <= n:
        chars = []
        start = i
        j = i
        while j + 2 <= n:
            (cu,) = struct.unpack_from(fmt, b, j)
            ch = chr(cu)
            if (0x20 <= cu < 0x7F) or (0x3000 <= cu <= 0x30FF) or (0x4E00 <= cu <= 0x9FFF) or (0xFF00 <= cu <= 0xFFEF):
                chars.append(ch)
                j += 2
            else:
                break
        if len(chars) >= 3:
            found.append((start, "".join(chars)))
            i = j + 2
        else:
            i += 2
    return found


def find_strings_utf8(b: bytes) -> list[tuple[int, str]]:
    found = []
    pat = re.compile(rb"(?:[\x20-\x7e]|[\xc2-\xf4][\x80-\xbf]{1,3}){4,}")
    for m in pat.finditer(b):
        try:
            s = m.group().decode("utf-8")
        except UnicodeDecodeError:
            continue
        found.append((m.start(), s))
    return found


def find_strings_cp932(b: bytes) -> list[tuple[int, str]]:
    found = []
    pat = re.compile(rb"(?:[\x20-\x7e]|[\x81-\x9f\xe0-\xfc][\x40-\xfc]){4,}")
    for m in pat.finditer(b):
        try:
            s = m.group().decode("cp932")
        except UnicodeDecodeError:
            continue
        if any(ord(c) > 0x7F for c in s):
            found.append((m.start(), s))
    return found


def parse_tlv(b: bytes) -> list[tuple[int, int, bytes]]:
    """[param_id u32 LE][len u32 LE][payload]* — returns (id, len, payload)."""
    out = []
    off = 0
    n = len(b)
    while off + 8 <= n:
        pid, plen = struct.unpack_from("<II", b, off)
        if off + 8 + plen > n:
            break
        out.append((pid, plen, b[off + 8 : off + 8 + plen]))
        off += 8 + plen
    if off != n:
        out.append((-1, n - off, b[off:]))
    return out


def describe_payload(payload: bytes) -> str:
    """Try to interpret common payload shapes."""
    if len(payload) == 0:
        return "(empty)"
    parts = []
    if len(payload) >= 16:
        count, resv, vtype, ilen = struct.unpack_from("<IIII", payload, 0)
        inner = payload[16 : 16 + ilen]
        if 16 + ilen == len(payload) and count < 1000:
            parts.append(f"count={count} resv={resv} vtype={vtype} inner_len={ilen}")
            if ilen == 2:
                parts.append(f"u16={struct.unpack('<H', inner)[0]}")
            elif ilen == 4:
                parts.append(f"u32={struct.unpack('<I', inner)[0]} f32={struct.unpack('<f', inner)[0]:.4g}")
            elif ilen == 8:
                parts.append(f"u32x2={struct.unpack('<II', inner)} f64={struct.unpack('<d', inner)[0]:.6g}")
            elif ilen == 16:
                parts.append(f"f64x2={tuple(round(v, 6) for v in struct.unpack('<dd', inner))}")
            elif ilen == 18:
                u16 = struct.unpack_from("<H", inner, 0)[0]
                d1, d2 = struct.unpack_from("<dd", inner, 2)
                parts.append(f"u16={u16} f64x2=({d1:.6g},{d2:.6g})")
            elif ilen % 8 == 0 and ilen <= 64:
                vals = struct.unpack(f"<{ilen//8}d", inner)
                parts.append("f64[]=" + ",".join(f"{v:.6g}" for v in vals))
            else:
                parts.append(f"inner_hex={inner[:48].hex()}")
            return " ".join(parts)
    return f"raw={payload[:48].hex()}{'...' if len(payload) > 48 else ''}"


def dump_blob(name: str, b: bytes) -> None:
    w(f"  -- {name}: total {len(b)} bytes")
    w(hexdump(b))
    u8 = find_strings_utf8(b)
    if u8:
        w("  UTF-8 strings:")
        for off, s in u8[:20]:
            w(f"    @{off:5d}: {s!r}")
    sjis = find_strings_cp932(b)
    if sjis:
        w("  CP932 strings:")
        for off, s in sjis[:20]:
            w(f"    @{off:5d}: {s!r}")
    for endian in ("be", "le"):
        ss = find_strings_utf16(b, endian)
        if ss:
            w(f"  UTF-16{endian.upper()} strings:")
            for off, s in ss[:30]:
                w(f"    @{off:5d}: {s!r}")
    w("  TLV parse:")
    for pid, plen, payload in parse_tlv(b):
        w(f"    id={pid:<4} len={plen:<5} {describe_payload(payload)}")
    w()


def main() -> None:
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        "SELECT * FROM Layer WHERE TextLayerString IS NOT NULL ORDER BY MainId"
    ).fetchall()
    w(f"text layers: {len(rows)}")
    w()
    for row in rows:
        w(f"=== Layer MainId={row['MainId']} name={row['LayerName']!r} ===")
        s = row["TextLayerString"]
        w(f"  TextLayerString blob[{len(s)}] utf-8 -> {s.decode('utf-8')!r}")
        w(
            f"  offsets: LayerOffsetX={row['LayerOffsetX']} LayerOffsetY={row['LayerOffsetY']} "
            f"RenderOffscrOffset=({row['LayerRenderOffscrOffsetX']},{row['LayerRenderOffscrOffsetY']})"
        )
        w(f"  TextLayerType={row['TextLayerType']} TextLayerAttributesVersion={row['TextLayerAttributesVersion']}")
        dump_blob("TextLayerAttributes", row["TextLayerAttributes"])
        dump_blob("TextLayerAddAttributesV01", row["TextLayerAddAttributesV01"])

    conn.close()
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
