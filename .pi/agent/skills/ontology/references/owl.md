# OWL with Python: OWLReady2 + RDFLib

Always run with **uv**: `uv add owlready2 rdflib`, `uv run python ...`.

## OWLReady2 — OWL semantics (preferred for ontology work)

### Load

```python
from owlready2 import get_ontology, onto_path

onto_path.append("/abs/path/to/ontology/dir")
onto = get_ontology("file:///abs/path/to/ontology.owl").load()

onto.base_iri
list(onto.classes())
list(onto.object_properties())
list(onto.data_properties())
list(onto.individuals())
```

### Create

```python
from owlready2 import Thing, ObjectProperty, DataProperty, FunctionalProperty

with onto:
    class Court(Thing):
        pass

    class HighCourt(Court):
        pass

    class heardBy(ObjectProperty):
        domain = [Thing]        # set real classes
        range = [Court]

    class hasCaseNumber(DataProperty, FunctionalProperty):
        domain = [Thing]
        range = [str]

    c = Court("SupremeCourtOfIndia")
    c.label = ["Supreme Court of India"]

onto.save(file="legal.owl", format="rdfxml")
```

### Edit existing

```python
onto = get_ontology("file:///abs/path/IndiLegalOnt.owl").load()

with onto:
    # attach a new class under an existing one
    parent = onto.search_one(label="LegislativeInstrument") or Thing
    StateAct = type("StateAct", (parent,), {})
    StateAct.label = ["State Act"]

onto.save(file="IndiLegalOnt.owl", format="rdfxml")
```

### Restrictions

```python
with onto:
    class Case(Thing):
        pass
    class Court(Thing):
        pass
    class heardBy(ObjectProperty):
        domain = [Case]
        range = [Court]

    Case.is_a.append(heardBy.some(Court))       # ∃
    Case.is_a.append(heardBy.only(Court))       # ∀
    Case.is_a.append(heardBy.exactly(1, Court))
```

### Search / introspection

```python
onto.search(iri="*Court*")
onto.search(type=onto.Court, label="*High*")
onto.search_one(label="High Court")

list(onto.Court.subclasses())
list(onto.Court.descendants())
list(onto.HighCourt.ancestors())

cls.iri      # full URI
cls.name     # local name
cls.label    # rdfs:label list
cls.is_a     # parents
```

### Reasoning (needs Java)

```python
from owlready2 import sync_reasoner_hermit, sync_reasoner_pellet

with onto:
    sync_reasoner_hermit([onto], infer_property_values=True)
    # sync_reasoner_pellet([onto], infer_property_values=True, infer_data_property_values=True)

onto.save(file="legal_inferred.owl", format="rdfxml")
```

Notes: HermiT = default (LGPL). Pellet = AGPL, supports data-property inference and `debug=2` explain. Define disjointness/restrictions before reasoning. Scope with `sync_reasoner([onto])` on big worlds.

## RDFLib — triples + full SPARQL

### Parse / serialize

```python
from rdflib import Graph, Namespace, RDF, RDFS, Literal
from rdflib.namespace import OWL

g = Graph()
g.parse("onto.owl")                # auto-detect
print(len(g), "triples")

EX = Namespace("http://ex.org/")
g.bind("ex", EX)
g.add((EX.Person, RDF.type, OWL.Class))
g.add((EX.alice, RDF.type, EX.Person))
g.add((EX.alice, EX.age, Literal(30)))

g.serialize(destination="onto.ttl", format="turtle")
g.serialize(destination="onto.rdf", format="xml")
```

Formats: RDF/XML, Turtle, N3, NTriples, JSON-LD.

### SPARQL

```python
from rdflib.plugins.sparql import prepareQuery

q = prepareQuery("""
SELECT ?label WHERE { ?s rdfs:label ?label . }
""", initNs={"rdfs": "http://www.w3.org/2000/01/rdf-schema#"})

for row in g.query(q):
    print(row.label)

# UPDATE
g.update('DELETE { ?s ?p "old" } INSERT { ?s ?p "new" } WHERE { ?s ?p "old" }')
```

Use `prepareQuery` for repeated queries. OWLReady2's native SPARQL is a fast **subset** (no full ASK/CONSTRUCT/SERVICE); use RDFLib for standards-complete SPARQL.

## Which tool when

| Task                                                  | Tool             |
|-------------------------------------------------------|------------------|
| Classes, restrictions, inheritance, reasoners         | OWLReady2        |
| Raw triple add/remove, Turtle/N3/JSON-LD, full SPARQL | RDFLib           |
| Bulk individuals from CSV/txt                         | OWLReady2 script |
| DL axiom engineering / OWLAPI parity                  | owlapy           |
| Convert RDF/XML → Turtle                              | RDFLib           |

## Bulk load individuals from files

```python
from pathlib import Path

def add_individuals(onto, cls, names, suffix=""):
    created = []
    with onto:
        for name in names:
            label = f"{name}{suffix}".strip()
            local = "".join(ch if ch.isalnum() else "_" for ch in label)
            ind = cls(local)
            ind.label = [label]
            created.append(ind)
    return created

names = Path("data/high_courts.txt").read_text().splitlines()
add_individuals(onto, onto.HighCourt, [n.strip() for n in names if n.strip()])
```

## Common mistakes

| Mistake                         | Fix                                 |
|---------------------------------|-------------------------------------|
| bare `pip install owlready2`    | `uv add owlready2`                  |
| classes outside `with onto:`    | always use the context manager      |
| spaces in Python ids as IRIs    | safe local names + `.label`         |
| expect Turtle from `onto.save`  | RDFLib `serialize(format="turtle")` |
| regex-edit multi-MB OWL         | load–mutate–save via OWLReady2      |
| reason without `with onto:`     | inferences won't persist on save    |
| full SPARQL on OWLReady2 native | use RDFLib                          |
