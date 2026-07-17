#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Generate SQLAlchemy 2.0 typed models (models.py) from an ontology IR JSON.

Usage:
    uv run scripts/gen_sqlalchemy.py ontology_ir.json [models.py]
"""
from __future__ import annotations

import json
import re
import sys

XSD_TO_SA = {
    "string": ("String", "str"),
    "integer": ("Integer", "int"),
    "float": ("Float", "float"),
    "decimal": ("Numeric", "float"),
    "boolean": ("Boolean", "bool"),
    "dateTime": ("DateTime", "datetime"),
    "date": ("Date", "date"),
}

SQL_RESERVED = {
    "case", "order", "user", "group", "table", "check", "default",
    "column", "select", "where", "union", "index", "view", "trigger",
    "constraint", "primary", "foreign", "references", "unique", "all",
}


def snake(name: str) -> str:
    s = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    return re.sub(r"[^0-9a-zA-Z_]+", "_", s).lower()


def table_name(name: str) -> str:
    t = snake(name)
    return f"{t}_tbl" if t in SQL_RESERVED else t


def attr_name(name: str) -> str:
    s = snake(name)
    return s if s and not s[0].isdigit() else f"_{s}"


def order_tables(tables: dict) -> list:
    """Parents before children (single inheritance)."""
    done, out = set(), []
    pending = list(tables.values())
    while pending:
        progressed = False
        for t in list(pending):
            if t["parent"] is None or t["parent"] in done:
                out.append(t)
                done.add(t["name"])
                pending.remove(t)
                progressed = True
        if not progressed:  # cycle or missing parent — emit rest as-is
            out.extend(pending)
            break
    return out


def emit(tables: dict) -> str:
    used_sa = {"Column", "ForeignKey", "Integer", "Table"}
    for t in tables.values():
        for c in t["columns"]:
            used_sa.add(XSD_TO_SA.get(c["owl_type"], ("String", "str"))[0])
    if not any(r["kind"] == "many-to-many" for t in tables.values() for r in t["relations"]):
        used_sa.discard("Column")
        used_sa.discard("Table")
    sa_imports = [i for i in ["Table", "Column", "ForeignKey", "Integer", "String",
                              "Float", "Numeric", "Boolean", "DateTime", "Date"] if i in used_sa]
    out = [
        '"""Auto-generated from ontology IR. Do not edit by hand; regenerate."""',
        "from __future__ import annotations",
        "",
        "from datetime import date, datetime",
        "from typing import List, Optional",
        "",
        f"from sqlalchemy import {', '.join(sa_imports)}",
        "from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship",
        "",
        "",
        "class Base(DeclarativeBase):",
        "    pass",
        "",
    ]

    # association tables for many-to-many
    m2m: list = []
    seen = set()
    for t in tables.values():
        for r in t["relations"]:
            if r["kind"] != "many-to-many":
                continue
            pair = tuple(sorted([t["name"], r["target"]]))
            if pair in seen:
                continue
            seen.add(pair)
            a, b = table_name(pair[0]), table_name(pair[1])
            assoc = f"{a}_{b}" if a != b else f"{a}_self"
            m2m.append((pair, assoc))
            if a == b:
                cols = [
                    f'    Column("{a}_id", Integer, ForeignKey("{a}.id"), primary_key=True),',
                    f'    Column("related_{a}_id", Integer, ForeignKey("{a}.id"), primary_key=True),',
                ]
            else:
                cols = [
                    f'    Column("{a}_id", Integer, ForeignKey("{a}.id"), primary_key=True),',
                    f'    Column("{b}_id", Integer, ForeignKey("{b}.id"), primary_key=True),',
                ]
            out += [f"{assoc} = Table(", f'    "{assoc}",', "    Base.metadata,", *cols, ")", ""]

    for t in order_tables(tables):
        base = t["parent"] if t["parent"] else "Base"
        out += ["", f"class {t['name']}({base}):", f'    __tablename__ = "{table_name(t["name"])}"']
        if t["parent"]:
            out.append(
                f'    id: Mapped[int] = mapped_column(ForeignKey("{table_name(t["parent"])}.id"), primary_key=True)'
            )
        else:
            out.append("    id: Mapped[int] = mapped_column(primary_key=True)")
        for c in t["columns"]:
            sa, py = XSD_TO_SA.get(c["owl_type"], ("String", "str"))
            out.append(
                f"    {attr_name(c['name'])}: Mapped[Optional[{py}]] = mapped_column({sa}, nullable=True)"
            )
        for r in t["relations"]:
            if r["kind"] == "many-to-one":
                tgt = r["target"]
                rel = attr_name(r["name"])
                out.append(
                    f'    {rel}_id: Mapped[Optional[int]] = mapped_column(ForeignKey("{table_name(tgt)}.id"))'
                )
                out.append(
                    f'    {rel}: Mapped[Optional["{tgt}"]] = relationship("{tgt}", foreign_keys=[{rel}_id])'
                )
        for (a, b), assoc in m2m:
            if a == b:
                continue  # self m2m needs manual back_populates; skip auto
            if t["name"] == a:
                out.append(
                    f'    {snake(b)}s: Mapped[List["{b}"]] = relationship("{b}", secondary={assoc})'
                )
            elif t["name"] == b:
                out.append(
                    f'    {snake(a)}s: Mapped[List["{a}"]] = relationship("{a}", secondary={assoc})'
                )
    return "\n".join(out) + "\n"


def main(ir_path: str, out_path: str) -> None:
    with open(ir_path) as f:
        ir = json.load(f)
    code = emit(ir["tables"])
    with open(out_path, "w") as f:
        f.write(code)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "models.py")
