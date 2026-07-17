# OWL → ORM codegen (SQLAlchemy + Drizzle)

Pipeline: **ontology → IR → SQLAlchemy models.py + Drizzle schema.ts**. One IR, two generators — they never drift.

## Directory layout

```text
ontology2orm/
├── ontology/
│   └── model.owl
├── scripts/
│   ├── extract_ir.py          # OWLReady2 -> IR (ontology_ir.json)
│   ├── gen_sqlalchemy.py      # IR -> models.py
│   ├── gen_drizzle.mjs        # IR -> schema.ts (Node, zero deps)
│   ├── type_map.py            # shared XSD type maps
│   └── templates/
│       ├── models.py.jinja
│       └── schema.ts.jinja
├── ontology_ir.json
├── models.py
└── schema.ts
```

## Mapping rules

| OWL                                     | SQLAlchemy                                        | Drizzle                                   |
|-----------------------------------------|---------------------------------------------------|-------------------------------------------|
| `owl:Class`                             | `class X(Base)` + `__tablename__`                 | `pgTable("x", {...})`                     |
| `rdfs:label`                            | Python class name (CamelCase)                     | camelCase export + snake_case table       |
| `rdfs:subClassOf`                       | joined-table inheritance (`id` FK to parent)      | FK on child `id` referencing parent table |
| `owl:DatatypeProperty`                  | `Mapped[Optional[T]] = mapped_column(...)`        | `text/integer/boolean/timestamp(...)`     |
| `owl:ObjectProperty` (functional/max 1) | FK column + `relationship()`                      | FK `.references()` + `relations()` one    |
| `owl:ObjectProperty` (non-functional)   | association table + `relationship(secondary=...)` | junction table + `relations()` many       |
| IRI                                     | keep as metadata / unique `iri` column if needed  | `text("iri").unique()` if needed          |

### XSD → ORM types

```python
XSD_TO_SQLALCHEMY = {
    "str": ("String", "str"),
    "int": ("Integer", "int"),
    "float": ("Float", "float"),
    "bool": ("Boolean", "bool"),
    "datetime": ("DateTime", "datetime"),
    "date": ("Date", "date"),
}

XSD_TO_DRIZZLE = {
    "str": "text",
    "int": "integer",
    "float": "real",
    "bool": "boolean",
    "datetime": "timestamp",
    "date": "date",
}
```

## 1. Extract IR

The canonical implementation is `scripts/extract_ir.py` in this skill (executable via its uv shebang):

```bash
$SKILL_DIR/scripts/extract_ir.py /abs/path/model.owl ontology_ir.json --root "Indian court"
```

Reference implementation if you need a custom variant:
from owlready2 import get_ontology
from dataclasses import dataclass, field, asdict
import json

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
    parent: str | None = None
    columns: list = field(default_factory=list)
    relations: list = field(default_factory=list)

def main(path: str, out: str):
    onto = get_ontology(f"file://{path}").load()
    tables: dict[str, Table] = {}

    for cls in onto.classes():
        name = (cls.label[0] if cls.label else cls.name)
        parent = next(
            (s.name for s in cls.is_a if hasattr(s, "name") and s.name != "Thing"),
            None,
        )
        tables[name] = Table(name=name, parent=parent)

    for p in onto.data_properties():
        for d in p.domain:
            tbl = tables.get(d.name)
            if tbl:
                rng = p.range[0] if p.range else "str"
                tbl.columns.append(Column(name=p.name, owl_type=str(rng)))

    for p in onto.object_properties():
        functional = getattr(p, "is_functional", False) or False
        for d in p.domain:
            for r in p.range:
                tbl = tables.get(d.name)
                if tbl and hasattr(r, "name"):
                    kind = "many-to-one" if functional else "many-to-many"
                    tbl.relations.append(Relation(name=p.name, target=r.name, kind=kind))

    data = {k: asdict(v) for k, v in tables.items()}
    with open(out, "w") as f:
        json.dump(data, f, indent=2)
    print(f"wrote {out} ({len(tables)} tables)")

if __name__ == "__main__":
    import sys
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "ontology_ir.json")
```

```bash
$SKILL_DIR/scripts/extract_ir.py /abs/path/model.owl ontology_ir.json
```

## 2. SQLAlchemy 2.0 (models.py)

Modern typed style: `DeclarativeBase`, `Mapped[]`, `mapped_column()`.

```jinja
{# scripts/templates/models.py.jinja #}
from __future__ import annotations
from typing import Optional, List
from datetime import datetime, date
from sqlalchemy import ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass

{% for t in tables %}
class {{ t.name }}({% if t.parent %}{{ t.parent }}{% else %}Base{% endif %}):
    __tablename__ = "{{ t.name|lower }}"
    id: Mapped[int] = mapped_column({% if t.parent %}ForeignKey("{{ t.parent|lower }}.id"), {% endif %}primary_key=True)
{%- for c in t.columns %}
    {{ c.name }}: Mapped[Optional[{{ c.py_type }}]] = mapped_column({{ c.sa_type }}, nullable=True)
{%- endfor %}
{%- for r in t.relations if r.kind == "many-to-one" %}
    {{ r.name }}_id: Mapped[Optional[int]] = mapped_column(ForeignKey("{{ r.target|lower }}.id"))
    {{ r.name }}: Mapped[Optional["{{ r.target }}"]] = relationship("{{ r.target }}", foreign_keys=[{{ r.name }}_id])
{%- endfor %}

{% endfor %}
```

Example output:

```python
class Person(Base):
    __tablename__ = "person"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)

class Employee(Person):
    __tablename__ = "employee"
    id: Mapped[int] = mapped_column(ForeignKey("person.id"), primary_key=True)
    works_in_id: Mapped[Optional[int]] = mapped_column(ForeignKey("department.id"))
    works_in: Mapped[Optional["Department"]] = relationship("Department", foreign_keys=[works_in_id])
```

### Many-to-many

Create an association table for non-functional object properties:

```python
from sqlalchemy import Table, Column, Integer, ForeignKey

book_tag = Table(
    "book_tag",
    Base.metadata,
    Column("book_id", Integer, ForeignKey("book.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tag.id"), primary_key=True),
)

class Book(Base):
    __tablename__ = "book"
    id: Mapped[int] = mapped_column(primary_key=True)
    tags: Mapped[List["Tag"]] = relationship("Tag", secondary=book_tag)
```

## 3. Drizzle (schema.ts)

```jinja
{# scripts/templates/schema.ts.jinja #}
import { pgTable, serial, text, integer, boolean, timestamp, real, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

{% for t in tables %}
export const {{ t.name|camel }} = pgTable("{{ t.name|snake }}", {
  id: serial("id").primaryKey(),
{%- for c in t.columns %}
  {{ c.name|camel }}: {{ c.drizzle_type }}("{{ c.name|snake }}"),
{%- endfor %}
{%- for r in t.relations if r.kind == "many-to-one" %}
  {{ r.name|camel }}Id: integer("{{ r.name|snake }}_id").references(() => {{ r.target|camel }}.id),
{%- endfor %}
});
{% endfor %}

{% for t in tables %}
export const {{ t.name|camel }}Relations = relations({{ t.name|camel }}, ({ one, many }) => ({
{%- for r in t.relations if r.kind == "many-to-one" %}
  {{ r.name|camel }}: one({{ r.target|camel }}, {
    fields: [{{ t.name|camel }}.{{ r.name|camel }}Id],
    references: [{{ r.target|camel }}.id],
  }),
{%- endfor %}
{%- for r in t.incoming %}
  {{ r.name|camel }}: many({{ r.source|camel }}),
{%- endfor %}
}));
{% endfor %}
```

### One-to-many (functional object property)

```ts
export const author = pgTable("author", {
  id: serial("id").primaryKey(),
  name: text("name"),
});

export const book = pgTable("book", {
  id: serial("id").primaryKey(),
  title: text("title"),
  authorId: integer("author_id").references(() => author.id),
});

export const authorRelations = relations(author, ({ many }) => ({
  books: many(book),
}));

export const bookRelations = relations(book, ({ one }) => ({
  author: one(author, { fields: [book.authorId], references: [author.id] }),
}));
```

### Many-to-many (non-functional)

```ts
export const bookToTag = pgTable("book_to_tag", {
  bookId: integer("book_id").notNull().references(() => book.id),
  tagId: integer("tag_id").notNull().references(() => tag.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.bookId, t.tagId] }),
}));

export const bookToTagRelations = relations(bookToTag, ({ one }) => ({
  book: one(book, { fields: [bookToTag.bookId], references: [book.id] }),
  tag: one(tag, { fields: [bookToTag.tagId], references: [tag.id] }),
}));
```

### Drizzle best practices

- Re-export all tables from a central `schema/index.ts` — drizzle-kit needs every export.
- `relations()` are query-level; `.references()` is the real FK — pair both.
- Index FK columns on the "many" side and both FKs in junction tables.
- Use `uuid('id').defaultRandom().primaryKey()` over `serial` for distributed-friendly IDs (optional).
- `drizzle-kit generate` + `migrate` in prod; `push` only in dev.

## 4. Migrations

### SQLAlchemy + Alembic

```bash
uv add alembic
uv run alembic init alembic
# alembic/env.py:
#   from models import Base
#   target_metadata = Base.metadata
uv run alembic revision --autogenerate -m "sync ontology"
uv run alembic upgrade head
```

- Review autogenerate output; it misses server defaults / check constraints.
- Import every model (and association tables) before `Base.metadata`.
- One migration per logical change; data migrations are separate explicit scripts.

### Drizzle-kit

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Post-processing

```bash
uv run ruff format models.py
uv run ruff check models.py
npx prettier --write schema.ts
npx tsc --noEmit          # type-check generated TS
```

## Drift check (CI)

```bash
# regenerate both, diff against committed files
$SKILL_DIR/scripts/extract_ir.py ontology/model.owl /tmp/ir.json
$SKILL_DIR/scripts/gen_sqlalchemy.py /tmp/ir.json /tmp/models.py
$SKILL_DIR/scripts/gen_drizzle.mjs  /tmp/ir.json /tmp/schema.ts
diff /tmp/models.py models.py || echo "models drifted"
diff /tmp/schema.ts schema.ts || echo "drizzle drifted"
```

## Anti-patterns

| Don't                                                 | Do                                    |
|-------------------------------------------------------|---------------------------------------|
| Each generator re-reads the OWL file                  | one shared IR                         |
| Hardcode type maps in two places                      | single `type_map.py` / yaml           |
| Skip `relations()` in Drizzle                         | always emit them for the query API    |
| FK column without `.references()`                     | real FK constraint + relations        |
| Trust Alembic autogenerate blindly                    | review every diff                     |
| Many migrations for one change                        | one migration per logical change      |
| Inherit tables from two parents (multiple subClassOf) | pick primary parent manually          |
| Use ontology reasoner output as FK truth              | only asserted domain/range drives FKs |

## Checklist

- [ ] IR extraction from OWLReady2 committed under `scripts/`
- [ ] Type maps shared between generators
- [ ] `models.py` uses `Mapped[]` + `mapped_column()` (SA 2.0)
- [ ] Joined-table inheritance for `rdfs:subClassOf`
- [ ] Junction tables for non-functional object properties
- [ ] `schema.ts` has `relations()` + real `references()`
- [ ] Alembic / drizzle-kit migrations generated and reviewed
- [ ] Formatters run on generated code
- [ ] CI drift check on ontology change
