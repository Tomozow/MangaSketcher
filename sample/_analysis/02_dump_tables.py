"""Step 2: List all tables in the extracted SQLite DB and dump key tables.

- Full table list with row counts.
- Canvas table: full row (scalar columns).
- Layer table: every row, key columns + all non-null scalar values.
- ExternalChunk table.
- Version-ish tables (Project, ParamScheme sample).

Usage: python 02_dump_tables.py
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "export_sample.sqlite"


def dump_row(row: sqlite3.Row, *, max_blob: int = 24) -> list[str]:
    out = []
    for k in row.keys():
        v = row[k]
        if v is None:
            continue
        if isinstance(v, bytes):
            if len(v) <= max_blob:
                out.append(f"{k}=blob[{len(v)}]:{v.hex()}")
            else:
                out.append(f"{k}=blob[{len(v)}]")
        else:
            out.append(f"{k}={v!r}")
    return out


def main() -> None:
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row

    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]
    print("=== tables ===")
    for t in tables:
        cnt = conn.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info('{t}')")]
        print(f"{t:<28} rows={cnt:<4} cols={len(cols)}")
    print()

    print("=== Canvas columns ===")
    for r in conn.execute("PRAGMA table_info('Canvas')"):
        print(f"  {r[1]} ({r[2]})")
    print()
    print("=== Canvas row ===")
    for row in conn.execute("SELECT * FROM Canvas"):
        for item in dump_row(row):
            print(f"  {item}")
    print()

    print("=== Layer columns ===")
    lcols = [(r[1], r[2]) for r in conn.execute("PRAGMA table_info('Layer')")]
    print(", ".join(f"{c}({t})" for c, t in lcols))
    print()

    print("=== Layer rows (non-null values only) ===")
    for row in conn.execute("SELECT * FROM Layer ORDER BY MainId"):
        print(f"--- Layer MainId={row['MainId']} name={row['LayerName']!r} type={row['LayerType']}")
        for item in dump_row(row):
            print(f"    {item}")
    print()

    print("=== ExternalChunk ===")
    for row in conn.execute("SELECT * FROM ExternalChunk"):
        print("  " + " ".join(dump_row(row, max_blob=64)))
    print()

    for t in ("Project", "ProjectInfo", "Version", "AppVersion"):
        if t in tables:
            print(f"=== {t} ===")
            for row in conn.execute(f"SELECT * FROM '{t}'"):
                for item in dump_row(row, max_blob=200):
                    print(f"  {item}")
            print()

    conn.close()


if __name__ == "__main__":
    main()
