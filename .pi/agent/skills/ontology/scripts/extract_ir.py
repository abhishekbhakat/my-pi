#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["owlready2"]
# ///
"""Extract an ORM-ready IR (JSON) from an OWL ontology.

Usage:
    uv run scripts/extract_ir.py <ontology.owl> [out.json] [--root LABEL] [--filter REGEX]

Options:
    --root LABEL     only classes in the subtree under the class with this label/name
    --filter REGEX   only classes whose label/name matches (case matters; use (?i) prefix)

The IR is the single source of truth for the ORM generators
(gen_sqlalchemy.py, gen_drizzle.py). Generators never re-read the OWL.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import deque
from dataclasses import asdict, dataclass, field

from owlready2 import get_ontology


def pascal(name: str) -> str:
    parts = re.split(r"[^0-9A-Za-z]+", name.strip())
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def class_label(cls) -> str:
    try:
        labels = cls.label
        if labels:
            return str(labels[0])
    except Exception:
        pass
    return cls.name


@dataclass
class Column:
    name: str
    owl_type: str
    nullable: bool = True


@dataclass
class Relation:
    name: str
    target: str
    kind: str  # "many-to-one" | "many-to-many"


@dataclass
class Table:
    name: str
    iri: str
    parent: str | None = None
    columns: list = field(default_factory=list)
    relations: list = field(default_factory=list)


def xsd_name(rng) -> str:
    """Map an OWLReady2 range to a simple type key."""
    s = str(rng)
    mapping = {
        "str": "string", "int": "integer", "float": "float",
        "bool": "boolean", "datetime": "dateTime", "date": "date",
    }
    if s in mapping:
        return mapping[s]
    m = re.search(r"#([A-Za-z]+)", s)
    return m.group(1) if m else "string"


def main(owl_path: str, out_path: str, root: str | None, pattern: str | None) -> None:
    uri = owl_path if owl_path.startswith(("file://", "http")) else f"file://{owl_path}"
    onto = get_ontology(uri).load()

    classes = list(onto.classes())
    if root:
        start = next((c for c in classes if class_label(c) == root or c.name == root), None)
        if start is None:
            print(f"root class not found: {root}", file=sys.stderr)
            sys.exit(2)
        seen, q = {start}, deque([start])
        while q:
            cur = q.popleft()
            for sub in cur.subclasses():
                if sub not in seen:
                    seen.add(sub)
                    q.append(sub)
        classes = list(seen)
    elif pattern:
        pat = re.compile(pattern)
        classes = [c for c in classes if pat.search(class_label(c)) or pat.search(c.name)]
    in_scope = set(classes)

    tables: dict[str, Table] = {}
    iri_to_name: dict[str, str] = {}

    for cls in classes:
        name = pascal(class_label(cls)) or pascal(cls.name)
        if not name:
            continue
        iri_to_name[cls.iri] = name
        parent = None
        for s in cls.is_a:
            if hasattr(s, "iri") and getattr(s, "name", "Thing") != "Thing" and s in in_scope:
                parent = pascal(class_label(s))
                break
        tables[name] = Table(name=name, iri=cls.iri, parent=parent)

    for p in onto.data_properties():
        rng = xsd_name(p.range[0]) if p.range else "string"
        for d in p.domain:
            if d not in in_scope:
                continue
            name = iri_to_name.get(getattr(d, "iri", ""))
            if name and name in tables:
                tables[name].columns.append(Column(name=p.name, owl_type=rng))

    for p in onto.object_properties():
        functional = "FunctionalProperty" in [t.name for t in p.is_a] or False
        for d in p.domain:
            if d not in in_scope:
                continue
            src = iri_to_name.get(getattr(d, "iri", ""))
            if not src or src not in tables:
                continue
            for r in p.range:
                if r not in in_scope:
                    continue
                tgt = iri_to_name.get(getattr(r, "iri", ""))
                if tgt:
                    kind = "many-to-one" if functional else "many-to-many"
                    tables[src].relations.append(Relation(name=p.name, target=tgt, kind=kind))

    data = {"base_iri": onto.base_iri, "tables": {k: asdict(v) for k, v in tables.items()}}
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"wrote {out_path}: {len(tables)} classes", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("owl")
    ap.add_argument("out", nargs="?", default="ontology_ir.json")
    ap.add_argument("--root", default=None)
    ap.add_argument("--filter", default=None)
    args = ap.parse_args()
    main(args.owl, args.out, args.root, args.filter)
