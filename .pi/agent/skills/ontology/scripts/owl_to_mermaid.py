#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["owlready2"]
# ///
"""Render an OWL ontology as a Mermaid diagram.

Modes:
  class      TBox class diagram (default): classes, inheritance, datatype
             attributes, object-property arrows.
  instances  ABox flowchart: individuals and their rdf:type / object links
             (capped; use --filter/--root/--max-nodes on big files).

Usage:
    uv run scripts/owl_to_mermaid.py ontology.owl [diagram.mmd]
    uv run scripts/owl_to_mermaid.py ontology.owl --mode class --root "Indian court"
    uv run scripts/owl_to_mermaid.py ontology.owl --filter "(?i)court|tribunal"
    uv run scripts/owl_to_mermaid.py ontology.owl --mode instances --max-nodes 60

Options:
    --mode class|instances   diagram kind (default: class)
    --root LABEL             only the subtree under the class with this label/name
    --filter REGEX           only classes whose label/name matches
    --direction TD|LR        mermaid direction (default: TD)
    --max-nodes N            hard cap on nodes (default: 200)
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import deque

from owlready2 import get_ontology


def safe(name: str) -> str:
    s = re.sub(r"[^0-9A-Za-z_]", "_", name.strip())
    if not s or s[0].isdigit():
        s = "_" + s
    return s


def label_of(ent) -> str:
    try:
        labels = ent.label
        if labels:
            return str(labels[0])
    except Exception:
        pass
    return getattr(ent, "name", str(ent))


def collect_classes(onto, root: str | None, pat: re.Pattern | None, max_nodes: int) -> list:
    classes = list(onto.classes())
    if root:
        start = None
        for c in classes:
            if label_of(c) == root or c.name == root:
                start = c
                break
        if start is None:
            print(f"root class not found: {root}", file=sys.stderr)
            sys.exit(2)
        seen, q = {start}, deque([start])
        while q and len(seen) < max_nodes:
            cur = q.popleft()
            for sub in cur.subclasses():
                if sub not in seen:
                    seen.add(sub)
                    q.append(sub)
        classes = list(seen)
    elif pat:
        classes = [c for c in classes if pat.search(label_of(c)) or pat.search(c.name)]
    return classes[:max_nodes]


def class_diagram(onto, args) -> str:
    pat = re.compile(args.filter) if args.filter else None
    classes = collect_classes(onto, args.root, pat, args.max_nodes)
    names = {c: safe(label_of(c)) for c in classes}
    in_scope = set(classes)

    lines = ["classDiagram", f"    direction {args.direction}"]
    total = len(list(onto.classes()))
    if total > len(classes):
        lines.append(f'    note "showing {len(classes)} of {total} classes"')

    for c in classes:
        n = names[c]
        lines.append(f"    class {n}")
        lab = label_of(c)
        if lab != c.name:
            lines.append(f"    {n} : {lab}")
        for s in c.is_a:
            if s in in_scope:
                lines.append(f"    {names[s]} <|-- {n}")

    # datatype attributes
    for p in onto.data_properties():
        for d in p.domain:
            if d in in_scope:
                rng = p.range[0] if p.range else "string"
                rng = rng.__name__ if isinstance(rng, type) else str(rng).split("#")[-1]
                lines.append(f"    {names[d]} : +{rng} {p.name}")

    # object-property arrows
    for p in onto.object_properties():
        for d in p.domain:
            if d not in in_scope:
                continue
            for r in p.range:
                if r in in_scope:
                    lines.append(f"    {names[d]} --> {names[r]} : {p.name}")

    return "\n".join(lines) + "\n"


def instances_diagram(onto, args) -> str:
    pat = re.compile(args.filter) if args.filter else None
    individuals = []
    for ind in onto.individuals():
        lab = label_of(ind)
        if pat and not (pat.search(lab) or pat.search(getattr(ind, "name", ""))):
            continue
        individuals.append(ind)
        if len(individuals) >= args.max_nodes:
            break

    idx = {ind: f"n{i}" for i, ind in enumerate(individuals)}
    lines = [f"flowchart {args.direction}"]
    for ind, nid in idx.items():
        lab = label_of(ind)
        types = [label_of(t) for t in ind.is_a if hasattr(t, "name")]
        tstr = f"\\n({types[0]})" if types else ""
        lines.append(f'    {nid}["{lab}{tstr}"]')
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("owl")
    ap.add_argument("out", nargs="?", default=None)
    ap.add_argument("--mode", choices=["class", "instances"], default="class")
    ap.add_argument("--root", default=None)
    ap.add_argument("--filter", default=None)
    ap.add_argument("--direction", default="TD", choices=["TD", "LR", "BT", "RL"])
    ap.add_argument("--max-nodes", type=int, default=200)
    args = ap.parse_args()

    uri = args.owl if args.owl.startswith(("file://", "http")) else f"file://{args.owl}"
    onto = get_ontology(uri).load()

    body = class_diagram(onto, args) if args.mode == "class" else instances_diagram(onto, args)

    if args.out:
        with open(args.out, "w") as f:
            f.write(body)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(body)


if __name__ == "__main__":
    main()
