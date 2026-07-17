#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["owlready2"]
# ///
"""Print a quick summary of an OWL ontology.

Usage:
    uv run scripts/inspect_owl.py <ontology.owl> [--tree ROOT_LABEL]
"""
from __future__ import annotations

import argparse
import sys

from owlready2 import get_ontology


def label_of(ent) -> str:
    try:
        labels = ent.label
        if labels:
            return str(labels[0])
    except Exception:
        pass
    return getattr(ent, "name", str(ent))


def print_tree(cls, depth: int, max_depth: int = 6) -> None:
    if depth > max_depth:
        return
    subs = sorted(cls.subclasses(), key=label_of)
    for s in subs:
        print("  " * (depth + 1) + "- " + label_of(s))
        print_tree(s, depth + 1, max_depth)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("owl")
    ap.add_argument("--tree", default=None, help="print class tree under this label")
    args = ap.parse_args()

    uri = args.owl if args.owl.startswith(("file://", "http")) else f"file://{args.owl}"
    onto = get_ontology(uri).load()

    classes = list(onto.classes())
    print(f"base_iri:          {onto.base_iri}")
    print(f"classes:           {len(classes)}")
    print(f"object properties: {len(list(onto.object_properties()))}")
    print(f"data properties:   {len(list(onto.data_properties()))}")
    print(f"individuals:       {len(list(onto.individuals()))}")

    if args.tree:
        for c in classes:
            if label_of(c) == args.tree or c.name == args.tree:
                print(f"\n- {label_of(c)}")
                print_tree(c, 0)
                return
        print(f"class not found: {args.tree}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
