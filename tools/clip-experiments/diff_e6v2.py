"""Deep diff of E6_v2.clip (generated) vs E6_v2_resolved.clip (CSP 5.0.1 re-saved).

Answers:
  1. Are our computed TLV fields (bbox id=42, font size id=32, id=63/64/72, run vtypes)
     byte-preserved for all 5 text layers (MainId 5,10,11,12,13)?
  2. What cache structures (Offscreen/Mipmap/MipmapInfo/LayerThumbnail/ExternalChunk/CHNKExta)
     did CSP regenerate?
  3. Which metadata did CSP normalize (Canvas, CanvasPreview, Project, sqlite_sequence...)?
  4. Why is the file size identical (885,096) while hashes differ?
     -> chunk map compare + raw byte-diff ranges attributed to SQLite pages/tables.

Usage: python tools/clip-experiments/diff_e6v2.py
Writes: sample/_experiments/E6_v2_diff_full.json
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "sample" / "_analysis"))
from importlib import import_module

_tlv = import_module("07_text_tlv_full")
parse_tlv_stream = _tlv.parse_tlv_stream
decode_scalar = _tlv.decode_scalar
parse_run_array_full = _tlv.parse_run_array_full
parse_run_array_compact = _tlv.parse_run_array_compact
RUN_ARRAY_IDS = _tlv.RUN_ARRAY_IDS
utf16_units = _tlv.utf16_units

LEFT = ROOT / "sample" / "_experiments" / "E6_v2.clip"
RIGHT = ROOT / "sample" / "_experiments" / "E6_v2_resolved.clip"
ORIGINAL = ROOT / "sample" / "export_sample.clip"
OUT = ROOT / "sample" / "_experiments" / "E6_v2_diff_full.json"

TEXT_LAYER_IDS = [5, 10, 11, 12, 13]

CSFCHUNK_MAGIC = b"CSFCHUNK"
SQLITE_MAGIC = b"SQLite format 3\x00"


# ---------------------------------------------------------------- container

def parse_container(data: bytes) -> dict[str, Any]:
    assert data[:8] == CSFCHUNK_MAGIC
    file_size_field, first_chunk_off = struct.unpack_from(">QQ", data, 8)
    chunks: list[dict[str, Any]] = []
    off = first_chunk_off
    while off < len(data):
        name = data[off : off + 8].decode("ascii")
        length = struct.unpack_from(">Q", data, off + 8)[0]
        data_off = off + 16
        body = data[data_off : data_off + length]
        rec: dict[str, Any] = {
            "name": name,
            "header_offset": off,
            "data_offset": data_off,
            "data_length": length,
            "sha256": hashlib.sha256(body).hexdigest(),
        }
        if name == "CHNKExta":
            idlen = struct.unpack_from(">Q", body, 0)[0]
            rec["exta_id"] = body[8 : 8 + idlen].decode("ascii")
            rec["exta_body_len"] = struct.unpack_from(">Q", body, 8 + idlen)[0]
        chunks.append(rec)
        off = data_off + length
    return {
        "file_size_field": file_size_field,
        "first_chunk_off": first_chunk_off,
        "chunks": chunks,
    }


def extract_sqlite(data: bytes, container: dict) -> tuple[bytes, int]:
    sqli = next(c for c in container["chunks"] if c["name"] == "CHNKSQLi")
    body = data[sqli["data_offset"] : sqli["data_offset"] + sqli["data_length"]]
    assert body[:16] == SQLITE_MAGIC
    return body, sqli["data_offset"]


# ---------------------------------------------------------------- byte diff

def byte_diff_ranges(a: bytes, b: bytes, merge_gap: int = 32) -> list[tuple[int, int]]:
    """Return [start, end) ranges where a and b differ (same length assumed)."""
    n = min(len(a), len(b))
    ranges: list[list[int]] = []
    i = 0
    while i < n:
        if a[i] != b[i]:
            start = i
            while i < n and a[i] != b[i]:
                i += 1
            if ranges and start - ranges[-1][1] <= merge_gap:
                ranges[-1][1] = i
            else:
                ranges.append([start, i])
        else:
            i += 1
    if len(a) != len(b):
        ranges.append([n, max(len(a), len(b))])
    return [(r[0], r[1]) for r in ranges]


# ---------------------------------------------------------------- sqlite page attribution

def read_varint(buf: bytes, off: int) -> tuple[int, int]:
    result = 0
    for i in range(9):
        byte = buf[off + i]
        if i == 8:
            return (result << 8) | byte, off + 9
        result = (result << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            return result, off + i + 1
    return result, off + 9


class PageMap:
    """Walk all B-trees + freelist to attribute each page to an owner."""

    def __init__(self, db: bytes):
        self.db = db
        self.page_size = struct.unpack_from(">H", db, 16)[0]
        if self.page_size == 1:
            self.page_size = 65536
        self.reserved = db[20]
        self.usable = self.page_size - self.reserved
        self.page_count = struct.unpack_from(">I", db, 28)[0]
        self.owner: dict[int, str] = {}

    def page(self, no: int) -> bytes:
        off = (no - 1) * self.page_size
        return self.db[off : off + self.page_size]

    def walk_btree(self, root: int, label: str) -> None:
        stack = [root]
        usable = self.usable
        x_table = usable - 35
        x_index = ((usable - 12) * 64) // 255 - 23
        m_local = ((usable - 12) * 32) // 255 - 23
        while stack:
            pno = stack.pop()
            if pno < 1 or pno > self.page_count or pno in self.owner:
                continue
            self.owner[pno] = label
            pg = self.page(pno)
            hdr = 100 if pno == 1 else 0
            ptype = pg[hdr]
            ncells = struct.unpack_from(">H", pg, hdr + 3)[0]
            if ptype in (2, 5):  # interior
                right = struct.unpack_from(">I", pg, hdr + 8)[0]
                stack.append(right)
                ptr_base = hdr + 12
            elif ptype in (10, 13):  # leaf
                ptr_base = hdr + 8
            else:
                self.owner[pno] = f"{label}:BADTYPE({ptype})"
                continue
            for i in range(ncells):
                cptr = struct.unpack_from(">H", pg, ptr_base + 2 * i)[0]
                if ptype == 5:  # table interior: child + rowid, no payload
                    stack.append(struct.unpack_from(">I", pg, cptr)[0])
                    continue
                off = cptr
                if ptype == 2:  # index interior
                    stack.append(struct.unpack_from(">I", pg, off)[0])
                    off += 4
                payload_len, off = read_varint(pg, off)
                if ptype == 13:  # table leaf: rowid varint after payload len
                    _rowid, off = read_varint(pg, off)
                x = x_table if ptype == 13 else x_index
                if payload_len > x:
                    k = m_local + (payload_len - m_local) % (usable - 4)
                    local = k if k <= x else m_local
                    ovfl = struct.unpack_from(">I", pg, off + local)[0]
                    self.walk_overflow(ovfl, f"{label}:overflow")

    def walk_overflow(self, pno: int, label: str) -> None:
        while pno and 1 <= pno <= self.page_count and pno not in self.owner:
            self.owner[pno] = label
            pno = struct.unpack_from(">I", self.page(pno), 0)[0]

    def walk_freelist(self) -> None:
        trunk = struct.unpack_from(">I", self.db, 32)[0]
        while trunk and trunk not in self.owner:
            self.owner[trunk] = "freelist:trunk"
            pg = self.page(trunk)
            nxt, count = struct.unpack_from(">II", pg, 0)
            for i in range(count):
                leaf = struct.unpack_from(">I", pg, 8 + 4 * i)[0]
                if 1 <= leaf <= self.page_count and leaf not in self.owner:
                    self.owner[leaf] = "freelist:leaf"
            trunk = nxt

    def build(self) -> None:
        # pointer-map pages if auto_vacuum
        largest_root = struct.unpack_from(">I", self.db, 52)[0]
        if largest_root:
            # ptrmap pages every (usable//5)+1 pages starting at page 2
            per = self.usable // 5 + 1
            p = 2
            while p <= self.page_count:
                self.owner[p] = "ptrmap"
                p += per + 1
        self.walk_btree(1, "sqlite_master")
        # read schema via sqlite3 for reliability
        fd, tmp = tempfile.mkstemp(suffix=".sqlite")
        os.write(fd, self.db)
        os.close(fd)
        conn = sqlite3.connect(tmp)
        rows = conn.execute(
            "SELECT type, name, rootpage FROM sqlite_master WHERE rootpage > 0"
        ).fetchall()
        conn.close()
        os.unlink(tmp)
        for typ, name, root in rows:
            self.walk_btree(root, f"{typ}:{name}")
        self.walk_freelist()

    def owner_of(self, pno: int) -> str:
        return self.owner.get(pno, "UNATTRIBUTED")


def sqlite_header_fields(db: bytes) -> dict[str, int]:
    keys = [
        ("page_size", 16, ">H"),
        ("file_change_counter", 24, ">I"),
        ("page_count", 28, ">I"),
        ("freelist_trunk", 32, ">I"),
        ("freelist_count", 36, ">I"),
        ("schema_cookie", 40, ">I"),
        ("schema_format", 44, ">I"),
        ("default_cache", 48, ">I"),
        ("largest_root_autovac", 52, ">I"),
        ("text_encoding", 56, ">I"),
        ("user_version", 60, ">I"),
        ("incremental_vacuum", 64, ">I"),
        ("application_id", 68, ">I"),
        ("version_valid_for", 92, ">I"),
        ("sqlite_version_number", 96, ">I"),
    ]
    return {k: struct.unpack_from(fmt, db, off)[0] for k, off, fmt in keys}


# ---------------------------------------------------------------- logical diff

def fingerprint(val: Any) -> Any:
    if isinstance(val, (bytes, memoryview)):
        b = bytes(val)
        return {
            "len": len(b),
            "sha256_12": hashlib.sha256(b).hexdigest()[:12],
            "head_hex": b[:24].hex(),
        }
    return val


def open_db(db_bytes: bytes) -> sqlite3.Connection:
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    os.write(fd, db_bytes)
    os.close(fd)
    conn = sqlite3.connect(tmp)
    conn.row_factory = sqlite3.Row
    return conn


def diff_all_tables(conn_a: sqlite3.Connection, conn_b: sqlite3.Connection) -> dict[str, Any]:
    tables_a = {r[0] for r in conn_a.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    tables_b = {r[0] for r in conn_b.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    out: dict[str, Any] = {}
    for t in sorted(tables_a | tables_b):
        if t.startswith("sqlite_") and t != "sqlite_sequence":
            continue
        if t not in tables_a or t not in tables_b:
            out[t] = {"only_in": "left" if t in tables_a else "right"}
            continue
        try:
            rows_a = conn_a.execute(f"SELECT rowid AS __rid, * FROM [{t}]").fetchall()
            rows_b = conn_b.execute(f"SELECT rowid AS __rid, * FROM [{t}]").fetchall()
        except sqlite3.OperationalError:
            rows_a = conn_a.execute(f"SELECT * FROM [{t}]").fetchall()
            rows_b = conn_b.execute(f"SELECT * FROM [{t}]").fetchall()
        key = "__rid" if rows_a and "__rid" in rows_a[0].keys() else None
        if key is None and t == "sqlite_sequence":
            key = "name"
        map_a = {r[key] if key else i: r for i, r in enumerate(rows_a)}
        map_b = {r[key] if key else i: r for i, r in enumerate(rows_b)}
        only_a = sorted(set(map_a) - set(map_b), key=str)
        only_b = sorted(set(map_b) - set(map_a), key=str)
        diffs: list[dict] = []
        for k in sorted(set(map_a) & set(map_b), key=str):
            ra, rb = map_a[k], map_b[k]
            for col in ra.keys():
                if col == "__rid" or col not in rb.keys():
                    continue
                va, vb = ra[col], rb[col]
                if isinstance(va, (bytes, memoryview)) or isinstance(vb, (bytes, memoryview)):
                    if bytes(va or b"") != bytes(vb or b""):
                        diffs.append({"rowid": k, "column": col, "left": fingerprint(va), "right": fingerprint(vb)})
                elif va != vb:
                    diffs.append({"rowid": k, "column": col, "left": va, "right": vb})
        rec: dict[str, Any] = {
            "rows": [len(rows_a), len(rows_b)],
        }
        if only_a or only_b or diffs:
            rec.update(
                {
                    "only_left_rowids": only_a[:20],
                    "only_right_rowids": only_b[:20],
                    "column_diffs": diffs[:80],
                    "column_diff_count": len(diffs),
                }
            )
        out[t] = rec
    return out


# ---------------------------------------------------------------- text layer TLV

def tlv_map(blob: bytes, *, is_add: bool) -> dict[int, bytes]:
    tlvs, _c, _t = parse_tlv_stream(blob, 4 if is_add else 0)
    return {t.param_id: t.payload for t in tlvs}


def describe(pid: int, payload: bytes, *, compact: bool) -> str:
    if pid in RUN_ARRAY_IDS:
        return " | ".join(
            parse_run_array_compact(payload, pid) if compact else parse_run_array_full(payload, pid)
        )
    return decode_scalar(pid, payload)


def key_fields(attr: bytes) -> dict[str, Any]:
    """Decode the fields we computed at generation time."""
    m = tlv_map(attr, is_add=False)
    out: dict[str, Any] = {}
    if 42 in m and len(m[42]) >= 16:
        out["bbox_id42"] = list(struct.unpack("<4I", m[42][:16]))
    if 63 in m and len(m[63]) >= 8:
        out["size_id63"] = list(struct.unpack("<II", m[63][:8]))
    if 64 in m and len(m[64]) >= 32:
        out["rect_id64"] = list(struct.unpack("<8i", m[64][:32]))
    if 72 in m and len(m[72]) >= 8:
        out["cachew_id72"] = list(struct.unpack("<II", m[72][:8]))
    if 32 in m and len(m[32]) >= 4:
        out["fontsize_id32"] = struct.unpack_from("<I", m[32])[0]
    if 39 in m and len(m[39]) >= 8:
        out["charcount_id39"] = list(struct.unpack("<II", m[39][:8]))
    if 50 in m and len(m[50]) >= 4:
        out["floatcache_id50"] = struct.unpack_from("<I", m[50])[0]
    elif 50 in m:
        out["floatcache_id50"] = f"len={len(m[50])}"
    if 11 in m and len(m[11]) >= 12:
        out["run11_vtype"] = struct.unpack_from("<I", m[11], 8)[0]
    return out


def compare_text_layer(conn_a: sqlite3.Connection, conn_b: sqlite3.Connection, mid: int) -> dict[str, Any]:
    q = (
        "SELECT MainId, LayerName, LayerOffsetX, LayerOffsetY, "
        "LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY, "
        "TextLayerString, TextLayerAttributes, TextLayerAddAttributesV01 "
        "FROM Layer WHERE MainId=?"
    )
    ra = conn_a.execute(q, (mid,)).fetchone()
    rb = conn_b.execute(q, (mid,)).fetchone()
    rec: dict[str, Any] = {"mainId": mid}
    if ra is None or rb is None:
        rec["status"] = f"missing: left={ra is None} right={rb is None}"
        return rec
    text_a = bytes(ra["TextLayerString"] or b"")
    text_b = bytes(rb["TextLayerString"] or b"")
    attr_a = bytes(ra["TextLayerAttributes"] or b"")
    attr_b = bytes(rb["TextLayerAttributes"] or b"")
    add_a = bytes(ra["TextLayerAddAttributesV01"] or b"")
    add_b = bytes(rb["TextLayerAddAttributesV01"] or b"")
    rec["layerName"] = ra["LayerName"]
    rec["text"] = text_a.decode("utf-8")
    rec["byte_identical"] = {
        "TextLayerString": text_a == text_b,
        "TextLayerAttributes": attr_a == attr_b,
        "TextLayerAddAttributesV01": add_a == add_b,
        "LayerOffset": (ra["LayerOffsetX"], ra["LayerOffsetY"]) == (rb["LayerOffsetX"], rb["LayerOffsetY"]),
        "RenderOffscrOffset": (ra["LayerRenderOffscrOffsetX"], ra["LayerRenderOffscrOffsetY"])
        == (rb["LayerRenderOffscrOffsetX"], rb["LayerRenderOffscrOffsetY"]),
    }
    rec["key_fields_left"] = key_fields(attr_a)
    rec["key_fields_right"] = key_fields(attr_b)
    # per-TLV diff when not byte-identical
    for label, ba, bb, is_add in (
        ("attr_tlv_diffs", attr_a, attr_b, False),
        ("add_tlv_diffs", add_a, add_b, True),
    ):
        if ba == bb:
            continue
        ma, mb = tlv_map(ba, is_add=is_add), tlv_map(bb, is_add=is_add)
        diffs = []
        for pid in sorted(set(ma) | set(mb)):
            pa, pb = ma.get(pid), mb.get(pid)
            if pa == pb:
                continue
            compact = is_add and pid in RUN_ARRAY_IDS
            diffs.append(
                {
                    "id": pid,
                    "left": describe(pid, pa, compact=compact) if pa is not None else None,
                    "right": describe(pid, pb, compact=compact) if pb is not None else None,
                    "left_hex": pa.hex() if pa is not None and len(pa) <= 48 else None,
                    "right_hex": pb.hex() if pb is not None and len(pb) <= 48 else None,
                }
            )
        rec[label] = diffs
    return rec


# ---------------------------------------------------------------- cache summaries

def cache_summary(conn: sqlite3.Connection) -> dict[str, Any]:
    def rows(sql: str) -> list[dict]:
        try:
            return [dict(r) for r in conn.execute(sql).fetchall()]
        except sqlite3.OperationalError as e:
            return [{"error": str(e)}]

    off = rows(
        "SELECT MainId, LayerId, CanvasId, Attribute, BlockData FROM Offscreen ORDER BY MainId"
    )
    for r in off:
        bd = r.pop("BlockData", None)
        r["externalId"] = (
            bytes(bd).decode("ascii", errors="replace").replace("\x00", "") if bd else None
        )
        at = r.pop("Attribute", None)
        r["attr_len"] = len(bytes(at)) if at else 0
        if at:
            ab = bytes(at)
            # Offscreen Attribute: BE ints after 16-byte header (empirical: parameter block)
            if len(ab) >= 32:
                r["attr_head_be"] = list(struct.unpack_from(">8I", ab, 0))
    mip = rows("SELECT MainId, LayerId, CanvasId, MipmapCount, BaseMipmapInfo FROM Mipmap ORDER BY MainId")
    mipinfo = rows(
        "SELECT MainId, CanvasId, Scale, Offscreen, NextIndex FROM MipmapInfo ORDER BY MainId"
    )
    thumb = rows("SELECT MainId, LayerId, CanvasId FROM LayerThumbnail ORDER BY MainId")
    ext = rows("SELECT ExternalID, ExternalType, ExternalSize, ExternalOffset FROM ExternalChunk ORDER BY rowid")
    if ext and "error" in ext[0]:
        ext = rows("SELECT * FROM ExternalChunk ORDER BY rowid")
        for r in ext:
            for k, v in list(r.items()):
                if isinstance(v, bytes):
                    r[k] = v.decode("ascii", errors="replace").replace("\x00", "")
    return {
        "offscreen": off,
        "mipmap": mip,
        "mipmapinfo": mipinfo,
        "layerthumbnail": thumb,
        "externalchunk": ext,
    }


# ---------------------------------------------------------------- main

def main() -> None:
    data_l = LEFT.read_bytes()
    data_r = RIGHT.read_bytes()
    report: dict[str, Any] = {
        "left": str(LEFT),
        "right": str(RIGHT),
        "sha256": {
            "left": hashlib.sha256(data_l).hexdigest(),
            "right": hashlib.sha256(data_r).hexdigest(),
        },
        "size": {"left": len(data_l), "right": len(data_r)},
    }

    # --- container / chunk map
    cont_l = parse_container(data_l)
    cont_r = parse_container(data_r)
    report["container"] = {"left": cont_l, "right": cont_r}
    chunk_map_same = [
        (c["name"], c["header_offset"], c["data_length"]) for c in cont_l["chunks"]
    ] == [(c["name"], c["header_offset"], c["data_length"]) for c in cont_r["chunks"]]
    report["chunk_map_identical"] = chunk_map_same
    chunk_body_diffs = []
    if chunk_map_same:
        for cl, cr in zip(cont_l["chunks"], cont_r["chunks"]):
            if cl["sha256"] != cr["sha256"]:
                chunk_body_diffs.append(
                    {k: cl[k] for k in ("name", "header_offset", "data_length")}
                    | {"exta_id": cl.get("exta_id")}
                )
    report["chunk_body_diffs"] = chunk_body_diffs

    # --- sqlite extraction
    sql_l, sqli_off_l = extract_sqlite(data_l, cont_l)
    sql_r, sqli_off_r = extract_sqlite(data_r, cont_r)
    report["sqlite_header"] = {
        "left": sqlite_header_fields(sql_l),
        "right": sqlite_header_fields(sql_r),
    }

    # --- page attribution
    pm_l = PageMap(sql_l)
    pm_l.build()
    pm_r = PageMap(sql_r)
    pm_r.build()

    # --- raw byte diff -> chunk + page attribution
    ranges = byte_diff_ranges(data_l, data_r, merge_gap=32)
    range_recs: list[dict] = []
    page_owners: dict[int, dict[str, str]] = {}
    for start, end in ranges:
        rec: dict[str, Any] = {"start": start, "end": end, "len": end - start}
        # locate chunk
        for c in cont_l["chunks"]:
            if c["data_offset"] <= start < c["data_offset"] + max(c["data_length"], 1):
                rec["chunk"] = c["name"]
                rec["chunk_rel"] = start - c["data_offset"]
                if c["name"] == "CHNKSQLi":
                    ps = pm_l.page_size
                    p0 = (start - c["data_offset"]) // ps + 1
                    p1 = (end - 1 - c["data_offset"]) // ps + 1
                    rec["pages"] = list(range(p0, p1 + 1))
                    for p in rec["pages"]:
                        page_owners[p] = {
                            "left": pm_l.owner_of(p),
                            "right": pm_r.owner_of(p),
                        }
                break
        else:
            rec["chunk"] = "HEADER/GAP"
        range_recs.append(rec)
    report["byte_diff_ranges"] = range_recs
    report["byte_diff_total"] = sum(r["len"] for r in range_recs)
    report["diff_pages"] = {
        str(p): page_owners[p] for p in sorted(page_owners)
    }

    # --- logical diff
    conn_l = open_db(sql_l)
    conn_r = open_db(sql_r)
    report["tables"] = diff_all_tables(conn_l, conn_r)
    report["text_layers"] = [compare_text_layer(conn_l, conn_r, mid) for mid in TEXT_LAYER_IDS]
    report["caches"] = {"left": cache_summary(conn_l), "right": cache_summary(conn_r)}

    # reference: original sample cache counts
    data_o = ORIGINAL.read_bytes()
    cont_o = parse_container(data_o)
    sql_o, _ = extract_sqlite(data_o, cont_o)
    conn_o = open_db(sql_o)
    report["original_reference"] = {
        "exta_count": sum(1 for c in cont_o["chunks"] if c["name"] == "CHNKExta"),
        "caches": cache_summary(conn_o),
    }
    conn_o.close()

    conn_l.close()
    conn_r.close()

    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---------------- console summary ----------------
    print(f"sizes: {len(data_l)} vs {len(data_r)}  chunk_map_identical={chunk_map_same}")
    print(f"chunks L: {[(c['name'], c['data_length']) for c in cont_l['chunks']]}")
    print(f"chunks R: {[(c['name'], c['data_length']) for c in cont_r['chunks']]}")
    print(f"chunk bodies differing: {[c['name'] + ':' + str(c.get('exta_id')) for c in chunk_body_diffs]}")
    hl, hr = report["sqlite_header"]["left"], report["sqlite_header"]["right"]
    print("sqlite header diffs:")
    for k in hl:
        if hl[k] != hr[k]:
            print(f"  {k}: {hl[k]} -> {hr[k]}")
    print(f"byte diff ranges: {len(range_recs)} total {report['byte_diff_total']}B")
    print("diff pages (page: left_owner / right_owner):")
    for p, o in sorted(page_owners.items()):
        mark = "" if o["left"] == o["right"] else "  <-- OWNER CHANGED"
        print(f"  p{p}: {o['left']} / {o['right']}{mark}")
    print()
    print("text layers byte-identity:")
    for tl in report["text_layers"]:
        bi = tl.get("byte_identical", {})
        flags = " ".join(f"{k}={'OK' if v else 'DIFF'}" for k, v in bi.items())
        print(f"  L{tl['mainId']} ({tl.get('layerName')!r}): {flags}")
        for lbl in ("attr_tlv_diffs", "add_tlv_diffs"):
            for d in tl.get(lbl, []):
                print(f"    {lbl} id={d['id']}: {d['left']} -> {d['right']}")
    print()
    print("tables with diffs:")
    for t, td in report["tables"].items():
        if td.get("column_diff_count") or td.get("only_left_rowids") or td.get("only_right_rowids"):
            print(
                f"  {t}: rows={td['rows']} diffs={td.get('column_diff_count', 0)} "
                f"only_left={td.get('only_left_rowids')} only_right={td.get('only_right_rowids')}"
            )
            for d in td.get("column_diffs", [])[:12]:
                print(f"    rowid={d['rowid']} {d['column']}: {d['left']} -> {d['right']}")
    print()
    print(f"full report: {OUT}")


if __name__ == "__main__":
    main()
