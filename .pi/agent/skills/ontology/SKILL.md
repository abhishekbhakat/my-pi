---
name: ontology
description: >
  Read, create, edit OWL/RDF ontology files (.owl, .ttl, .rdf) with Python,
  generate ORM database models from them — SQLAlchemy models.py in Python,
  Drizzle schema.ts in TypeScript. Use when user mention ontology, OWL, RDF,
  turtle, SPARQL, OWLReady2, RDFLib, schema.org, SALI, legal ontology,
  knowledge graph schema, class hierarchy, object property, datatype property,
  or want to turn ontology into SQLAlchemy / Drizzle ORM models, derive
  database schemas from ontology, or keep ontology and ORM in sync.
user-invocable: true
disable-model-invocation: false
---

# Ontology Engineering (Python + OWL to ORM)

Work with OWL/RDF ontologies in Python using **uv-managed tooling**, then derive database models: **SQLAlchemy 2.0** (Python) and **Drizzle ORM** (TypeScript). Never use bare `python3`, `pip`, `poetry`, or `conda`.

## When to use this skill

- Read / inspect existing `.owl`, `.ttl`, `.rdf`, `.n3` file (classes, properties, individuals)
- Create new ontology from scratch (TBox + ABox)
- Edit ontology: add classes, subclass links, datatype properties, object properties, individuals
- Generate SQLAlchemy `models.py` from ontology
- Generate Drizzle `schema.ts` from ontology
- Keep ontology and ORM schema in sync (single source of truth = ontology)
- Write SPARQL queries against ontology files

## Scripts (fast track — prefer these)

All scripts have `#!/usr/bin/env -S uv run --script` shebang with PEP 723 inline dependencies — execute direct, no `uv run` prefix, no project setup. Dependencies auto-resolve on first run.

| Script | Command | Output |
|--------|---------|--------|
| Inspect ontology | `$SKILL_DIR/scripts/inspect_owl.py file.owl [--tree "Indian court"]` | counts, class tree |
| OWL to IR | `$SKILL_DIR/scripts/extract_ir.py file.owl ir.json [--root LABEL \| --filter REGEX]` | `ir.json` |
| IR to SQLAlchemy | `$SKILL_DIR/scripts/gen_sqlalchemy.py ir.json models.py` | `models.py` (SA 2.0 typed) |
| IR to Drizzle | `$SKILL_DIR/scripts/gen_drizzle.mjs ir.json schema.ts` (Node) | `schema.ts` |
| OWL to Mermaid | `$SKILL_DIR/scripts/owl_to_mermaid.py file.owl out.mmd [--root LABEL] [--filter REGEX] [--mode class\|instances] [--direction TD\|LR] [--max-nodes N]` | `.mmd` diagram |

`$SKILL_DIR` = directory containing this skill (parent of `SKILL.md`). Scripts executable; `uv run <script>` form also work if exec bits lost (e.g. after copy). Toolchain note: OWL parsing stay Python (OWLReady2 right tool for OWL semantics); Drizzle generator is **Node ESM** (`gen_drizzle.mjs`) so TS projects need no Python beyond IR step; SQLAlchemy generator stay Python.

Typical pipeline:

```bash
SKILL_DIR=<this skill dir>
$SKILL_DIR/scripts/extract_ir.py ontology.owl ir.json --root "Indian court"
$SKILL_DIR/scripts/gen_sqlalchemy.py ir.json models.py   # python stack
$SKILL_DIR/scripts/gen_drizzle.mjs ir.json schema.ts    # ts stack (either/or)
$SKILL_DIR/scripts/owl_to_mermaid.py ontology.owl diagram.mmd --root "Indian court"
```

**Large ontologies** (10k+ classes, e.g. SALI/LMSS-based): always scope with `--root` or `--filter` before generate IR or diagrams.

Edge cases generators handle: SQL reserved table names (`case` becomes `case_tbl`), TS reserved exports (`case` becomes `caseTable`), self-referencing many-to-many (distinct FK columns), class emission in dependency order (parents first). Self-referencing m2m relationships generated as tables but need manual `back_populates`/`relationName` wiring — flagged in output.

## Environment (uv only)

```bash
# bootstrap
uv add owlready2 rdflib jinja2

# run any python
uv run python script.py
uv run python -c "from owlready2 import *; ..."
```

`owlready2` need **Java** for reasoners (HermiT/Pellet) only; basic read/write work without it.

```bash
# macOS if reasoners needed
brew install openjdk@17
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
```

## Core idea: ontology is schema source of truth

```text
ontology.owl / .ttl
        │  parse with OWLReady2
        ▼
   Intermediate Representation (IR)
        │
   ┌────┴────┐
   ▼         ▼
models.py  schema.ts
(SQLAlchemy) (Drizzle)
```

Build **one IR** (classes become tables, datatype props become columns, object props become FKs/relations), then render both ORMs from it so they never drift.

Full pipeline details: [references/orm-codegen.md](references/orm-codegen.md).

## Workflow 1 — Read / inspect OWL file

Always use `uv run`. Prefer OWLReady2 for class/property introspection.

```bash
uv run python <<'PY'
from owlready2 import get_ontology

onto = get_ontology("file:///ABS/PATH/to/ontology.owl").load()

print("Base IRI:", onto.base_iri)
print("Classes:", len(list(onto.classes())))

for cls in onto.classes():
    print("Class:", cls.name, "| IRI:", cls.iri, "| Label:", cls.label)
    print("  is_a:", [str(s) for s in cls.is_a][:5])

print("\nDatatype properties")
for p in onto.data_properties():
    print(p.name, "domain:", [d.name for d in p.domain], "range:", [str(r) for r in p.range])

print("\nObject properties")
for p in onto.object_properties():
    print(p.name, "domain:", [d.name for d in p.domain], "range:", [r.name for r in p.range])
PY
```

### Quick SPARQL with RDFLib

```bash
uv run python <<'PY'
from rdflib import Graph
from rdflib.plugins.sparql import prepareQuery

g = Graph()
g.parse("ontology.owl")

q = prepareQuery("""
SELECT DISTINCT ?label WHERE {
  ?entity a ?type .
  ?type rdfs:label "High Court" .
  ?entity rdfs:label ?label .
} ORDER BY ?label
""", initNs={"rdfs": "http://www.w3.org/2000/01/rdf-schema#"})

for row in g.query(q):
    print(row.label)
PY
```

OWLReady2 vs RDFLib (when to use which):

| Need                                                                           | Use           |
|--------------------------------------------------------------------------------|---------------|
| OWL classes, restrictions, `is_a`, `equivalent_to`, reasoners                  | **OWLReady2** |
| Raw triples, full SPARQL 1.1 (ASK/CONSTRUCT/SERVICE/UPDATE), Turtle/N3/JSON-LD | **RDFLib**    |
| DL axiom-level work / OWLAPI-style                                             | owlapy (rare) |

Deep reference: [references/owl.md](references/owl.md).

## Workflow 2 — Create / edit ontology

Use OWLReady2. Mutate inside `with onto:` so entities bind to that ontology.

```bash
uv run python <<'PY'
from owlready2 import get_ontology, Thing, ObjectProperty, DataProperty, FunctionalProperty

onto = get_ontology("http://example.org/legal.owl")

with onto:
    class Court(Thing):
        pass

    class HighCourt(Court):
        pass

    class Case(Thing):
        pass

    class heardBy(ObjectProperty):
        domain = [Case]
        range = [Court]

    class hasCaseNumber(DataProperty, FunctionalProperty):
        domain = [Case]
        range = [str]

    # individual
    sc = Court("SupremeCourtOfIndia")
    sc.label = ["Supreme Court of India"]

onto.save(file="legal.owl", format="rdfxml")
print("saved legal.owl")
PY
```

### Edit existing ontology

```bash
uv run python <<'PY'
from owlready2 import get_ontology

onto = get_ontology("file:///ABS/PATH/IndiLegalOnt.owl").load()

with onto:
    NewClass = type("StateAct", (Thing,), {})
    NewClass.label = ["State Act"]
    # or attach under an existing class:
    # NewClass = type("StateAct", (onto.LegislativeInstrument,), {})

onto.save(file="IndiLegalOnt.owl", format="rdfxml")
PY
```

Authoring rules, restrictions, bulk loading from files, and pitfalls: [references/owl.md](references/owl.md).

## Workflow 3 — Generate ORM models from ontology

Use scripts (see fast track). Manual flow when scripts do not fit:

Parse ontology once into IR, then emit **either** SQLAlchemy **or** Drizzle (or both) from that IR.

### 3.1 Extract IR

```bash
$SKILL_DIR/scripts/extract_ir.py ontology.owl ontology_ir.json --root "Indian court"
```

The IR shape:

```json
{
  "base_iri": "http://...",
  "tables": {
    "ClassName": {
      "name": "ClassName", "iri": "http://...", "parent": null,
      "columns": [{"name": "caseNumber", "owl_type": "string", "nullable": true}],
      "relations": [{"name": "heardBy", "target": "Court", "kind": "many-to-one"}]
    }
  }
}
```

Generators consume only IR — never re-read OWL file.

### 3.2 Type mapping

Shared config so Python and TS stay in sync:

```python
XSD_TO_SQLALCHEMY = {"string": "String", "integer": "Integer", "float": "Float",
                     "decimal": "Numeric", "boolean": "Boolean",
                     "dateTime": "DateTime", "date": "Date"}
XSD_TO_DRIZZLE    = {"string": "text", "integer": "integer", "float": "real",
                     "decimal": "numeric", "boolean": "boolean",
                     "dateTime": "timestamp", "date": "date"}
```

### 3.3 Generate SQLAlchemy `models.py`

```bash
$SKILL_DIR/scripts/gen_sqlalchemy.py ontology_ir.json models.py
```

Output follow **SQLAlchemy 2.0 typed style**: `DeclarativeBase`, `Mapped[]`, `mapped_column()`, `relationship()`. `rdfs:subClassOf` = **joined-table inheritance** (child `id` is `ForeignKey(parent.id)`); non-functional object properties = association tables.

### 3.4 Generate Drizzle `schema.ts`

```bash
$SKILL_DIR/scripts/gen_drizzle.mjs ontology_ir.json schema.ts
```

Emit `pgTable` + `relations()` on both sides + junction tables for many-to-many. Re-export from central `schema/index.ts` (drizzle-kit need every table exported). Drizzle output flat (no ORM-level inheritance); subclass tables share parent shape — add parent FK manual if wanted.

Mapping tables, junction details, edge cases: [references/orm-codegen.md](references/orm-codegen.md).

### 3.5 SQLAlchemy to Alembic, Drizzle to drizzle-kit

After generate models:

```bash
# SQLAlchemy migrations
uv add alembic
uv run alembic init alembic
# edit alembic/env.py: import Base, set target_metadata = Base.metadata
uv run alembic revision --autogenerate -m "sync ontology"
uv run alembic upgrade head

# Drizzle migrations (TS project)
npx drizzle-kit generate
npx drizzle-kit migrate
```

Rules:

- ORM models are source of truth for DB; migrations are reviewed, versioned artifacts.
- One migration per logical change; never hand-edit old revision chains.
- Keep `alembic_version` as DB version-of-record.

## Workflow 4 — Ontology to Mermaid diagram

```bash
# whole TBox (small ontologies only)
$SKILL_DIR/scripts/owl_to_mermaid.py ontology.owl diagram.mmd

# scoped subtree (recommended for big files)
$SKILL_DIR/scripts/owl_to_mermaid.py ontology.owl courts.mmd --root "Indian court"

# regex scope, left-right layout
$SKILL_DIR/scripts/owl_to_mermaid.py ontology.owl trib.mmd --filter "(?i)tribunal" --direction LR

# individuals as flowchart (capped)
$SKILL_DIR/scripts/owl_to_mermaid.py ontology.owl inst.mmd --mode instances --max-nodes 60
```

Paste `.mmd` into Markdown with ` ```mermaid ` fence, mermaid.live, or GitHub/Obsidian (both render Mermaid native).

## Design rules (ontology to ORM)

| Rule                                           | Why                                                  |
|------------------------------------------------|------------------------------------------------------|
| Ontology file is schema source of truth    | single place to evolve classes/properties            |
| One IR, two generators                         | Python and TS models never drift                     |
| `rdfs:label` = human-readable class/table name | fall back to URI local name if missing               |
| Datatype property = column (XSD type mapped)   | keep type maps shared between generators             |
| Object property = FK + relationship            | functional = one FK; non-functional = junction table |
| `rdfs:subClassOf` = joined-table inheritance   | child `id` FK to parent `id`                         |
| Always generate `relations()` in Drizzle       | needed for relational query API                  |
| Run formatters after codegen                   | `ruff format` / `prettier`                           |
| Re-run codegen when ontology changes           | CI diff check catches drift                          |

Anti-patterns and full checklist: [references/orm-codegen.md](references/orm-codegen.md#anti-patterns).

## Quality bar

- [ ] Ontology loads with `uv run` + OWLReady2 without errors
- [ ] Every class/property has `rdfs:label`
- [ ] IR extraction script committed under `scripts/`
- [ ] `models.py` and `schema.ts` both generated from same IR
- [ ] SQLAlchemy models use 2.0 typed style (`Mapped[]`, `mapped_column()`)
- [ ] Drizzle schema has `relations()` and real FK `references()`
- [ ] Alembic / drizzle-kit migrations produced and reviewed
- [ ] All Python run via `uv run`, deps via `uv add`

## References

| File                                                   | Contents                                                                    |
|--------------------------------------------------------|-----------------------------------------------------------------------------|
| [references/owl.md](references/owl.md)                 | OWLReady2 + RDFLib: read, create, edit, SPARQL, pitfalls                    |
| [references/orm-codegen.md](references/orm-codegen.md) | Full OWL-to-ORM mapping, Jinja templates, junction tables, Alembic/Drizzle-kit |
