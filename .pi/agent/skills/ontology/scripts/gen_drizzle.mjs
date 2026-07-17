#!/usr/bin/env node
/**
 * Generate a Drizzle ORM schema (schema.ts) from an ontology IR JSON.
 *
 * The IR is produced by extract_ir.py (OWL -> JSON). This script never reads
 * OWL directly: one shared IR feeds both gen_sqlalchemy.py and this script.
 *
 * Usage:
 *   ./gen_drizzle.mjs ontology_ir.json [schema.ts]
 *   node gen_drizzle.mjs ontology_ir.json [schema.ts]
 */
import { readFileSync, writeFileSync } from "node:fs";

const XSD_TO_DRIZZLE = {
  string: "text",
  integer: "integer",
  float: "real",
  decimal: "numeric",
  boolean: "boolean",
  dateTime: "timestamp",
  date: "date",
};

const SQL_RESERVED = new Set([
  "case", "order", "user", "group", "table", "check", "default",
  "column", "select", "where", "union", "index", "view", "trigger",
  "constraint", "primary", "foreign", "references", "unique", "all",
]);

const TS_RESERVED = new Set([
  "case", "class", "default", "function", "new", "var", "let", "const",
  "return", "if", "else", "switch", "break", "continue", "do", "while",
  "for", "in", "of", "typeof", "instanceof", "delete", "void", "this",
  "super", "extends", "import", "export", "null", "true", "false", "try",
  "catch", "finally", "throw", "yield", "async", "await", "static", "enum",
  "interface", "type", "implements", "namespace", "declare", "module",
]);

function snake(name) {
  const s = name
    .replace(/(.)([A-Z][a-z]+)/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return s.replace(/[^0-9a-zA-Z_]+/g, "_").toLowerCase();
}

function camel(name) {
  const parts = name.trim().split(/[^0-9A-Za-z]+|_+/).filter(Boolean);
  if (parts.length === 0) return name;
  const first = parts[0][0].toLowerCase() + parts[0].slice(1);
  return first + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

function tableName(name) {
  const t = snake(name);
  return SQL_RESERVED.has(t) ? `${t}_tbl` : t;
}

function exportName(name) {
  const c = camel(name);
  return TS_RESERVED.has(c) ? `${c}Table` : c;
}

function upperFirst(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function emit(tables) {
  // Stage 1: compute which pg-core builders are actually used
  const used = new Set(["serial"]);
  for (const t of Object.values(tables)) {
    for (const c of t.columns) used.add(XSD_TO_DRIZZLE[c.owl_type] ?? "text");
    for (const r of t.relations) if (r.kind === "many-to-one") used.add("integer");
  }
  const hasM2M = Object.values(tables).some((t) => t.relations.some((r) => r.kind === "many-to-many"));
  if (hasM2M) {
    used.add("integer");
    used.add("primaryKey");
  }
  const order = ["serial", "text", "integer", "real", "numeric", "boolean", "timestamp", "date", "primaryKey"];
  const imports = order.filter((i) => used.has(i));

  const exp = Object.fromEntries(Object.keys(tables).map((n) => [n, exportName(n)]));

  const out = [
    "// Auto-generated from ontology IR. Do not edit by hand; regenerate.",
    `import { ${imports.join(", ")} } from "drizzle-orm/pg-core";`,
    'import { relations } from "drizzle-orm";',
    "",
  ];

  // Stage 2: pgTable per class
  for (const t of Object.values(tables)) {
    out.push(`export const ${exp[t.name]} = pgTable("${tableName(t.name)}", {`);
    out.push('  id: serial("id").primaryKey(),');
    for (const c of t.columns) {
      const dt = XSD_TO_DRIZZLE[c.owl_type] ?? "text";
      out.push(`  ${camel(c.name)}: ${dt}("${snake(c.name)}"),`);
    }
    for (const r of t.relations) {
      if (r.kind !== "many-to-one") continue;
      out.push(`  ${camel(r.name)}Id: integer("${snake(r.name)}_id").references(() => ${exp[r.target]}.id),`);
    }
    out.push("});", "");
  }

  // Stage 3: junction tables for many-to-many (deduped, self-ref safe)
  const junctions = new Map();
  for (const t of Object.values(tables)) {
    for (const r of t.relations) {
      if (r.kind !== "many-to-many") continue;
      const pair = [t.name, r.target].sort();
      const key = pair.join("|");
      if (junctions.has(key)) continue;
      const [a, b] = pair;
      if (a === b) {
        const jexp = `${camel(a)}Self`;
        junctions.set(key, jexp);
        out.push(`export const ${jexp} = pgTable("${tableName(a)}_self", {`);
        out.push(`  ${camel(a)}Id: integer("${snake(a)}_id").notNull().references(() => ${exp[a]}.id),`);
        out.push(`  related${upperFirst(camel(a))}Id: integer("related_${snake(a)}_id").notNull().references(() => ${exp[a]}.id),`);
        out.push("}, (t) => [");
        out.push(`  primaryKey({ columns: [t.${camel(a)}Id, t.related${upperFirst(camel(a))}Id] }),`);
        out.push("]);", "");
      } else {
        const jexp = `${camel(a)}To${upperFirst(camel(b))}`;
        junctions.set(key, jexp);
        out.push(`export const ${jexp} = pgTable("${tableName(a)}_${tableName(b)}", {`);
        out.push(`  ${camel(a)}Id: integer("${snake(a)}_id").notNull().references(() => ${exp[a]}.id),`);
        out.push(`  ${camel(b)}Id: integer("${snake(b)}_id").notNull().references(() => ${exp[b]}.id),`);
        out.push("}, (t) => [");
        out.push(`  primaryKey({ columns: [t.${camel(a)}Id, t.${camel(b)}Id] }),`);
        out.push("]);", "");
      }
    }
  }

  // Stage 4: relations() — outgoing one(), incoming many()
  const incoming = Object.fromEntries(Object.keys(tables).map((n) => [n, []]));
  for (const t of Object.values(tables)) {
    for (const r of t.relations) {
      if (r.kind === "many-to-one" && incoming[r.target]) {
        incoming[r.target].push({ source: t.name, via: r.name });
      }
    }
  }

  for (const t of Object.values(tables)) {
    out.push(`export const ${exp[t.name]}Relations = relations(${exp[t.name]}, ({ one, many }) => ({`);
    for (const r of t.relations) {
      if (r.kind !== "many-to-one") continue;
      out.push(`  ${camel(r.name)}: one(${exp[r.target]}, {`);
      out.push(`    fields: [${exp[t.name]}.${camel(r.name)}Id],`);
      out.push(`    references: [${exp[r.target]}.id],`);
      out.push("  }),");
    }
    for (const inc of incoming[t.name]) {
      out.push(`  ${camel(inc.source)}s: many(${exp[inc.source]}),`);
    }
    out.push("}));", "");
  }

  return out.join("\n");
}

function main() {
  const [, , irPath, outPath = "schema.ts"] = process.argv;
  if (!irPath) {
    console.error("Usage: gen_drizzle.mjs <ontology_ir.json> [schema.ts]");
    process.exit(1);
  }
  const ir = JSON.parse(readFileSync(irPath, "utf8"));
  writeFileSync(outPath, emit(ir.tables));
  console.error(`wrote ${outPath}`);
}

main();
