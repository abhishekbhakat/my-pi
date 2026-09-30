import fs from "node:fs";
import path from "node:path";
import { SKIP_DIRS, TEXT_EXT, TEXT_NAME } from "../paths.mjs";
import { exists } from "./read-write.mjs";

export function rmTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function* walkFiles(root) {
  if (!exists(root)) return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        yield full;
      }
    }
  }
}

export function pruneEmptyDirs(root) {
  if (!exists(root)) return;
  const stack = [root];
  const seen = [];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      stack.push(path.join(current, entry.name));
    }
    seen.push(current);
  }
  for (let i = seen.length - 1; i >= 0; i -= 1) {
    const dir = seen[i];
    if (dir === root) continue;
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      // ignore race / non-empty
    }
  }
}

export function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

/** Mirror src -> dst file-by-file. Skips node_modules/.git. Preserves those dirs on dst. */
export function copyDirReplace(src, dst) {
  if (!exists(src)) return null;
  const started = Date.now();
  fs.mkdirSync(dst, { recursive: true });
  const srcRels = new Set();
  let files = 0;
  let unchanged = 0;
  for (const file of walkFiles(src)) {
    const rel = relPosix(src, file);
    srcRels.add(rel);
    const out = path.join(dst, ...rel.split("/"));
    const bytes = fs.readFileSync(file);
    if (exists(out)) {
      try {
        if (Buffer.compare(bytes, fs.readFileSync(out)) === 0) {
          unchanged += 1;
          continue;
        }
      } catch {
        // fall through to copy
      }
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    files += 1;
  }
  let removed = 0;
  for (const file of walkFiles(dst)) {
    const rel = relPosix(dst, file);
    if (srcRels.has(rel)) continue;
    fs.rmSync(file, { force: true });
    removed += 1;
  }
  pruneEmptyDirs(dst);
  return { files, unchanged, removed, ms: Date.now() - started };
}

export function isTextFile(filePath, bytes) {
  if (bytes.includes(0)) return false;
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  return TEXT_EXT.has(ext) || TEXT_NAME.has(base) || base.startsWith("Makefile");
}

export function writeIfChanged(src, dst, stats) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const bytes = fs.readFileSync(src);
  const out = isTextFile(src, bytes) ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n")) : bytes;
  if (exists(dst) && Buffer.compare(out, fs.readFileSync(dst)) === 0) {
    stats.unchanged += 1;
    return false;
  }
  fs.writeFileSync(dst, out);
  stats.updated += 1;
  return true;
}
