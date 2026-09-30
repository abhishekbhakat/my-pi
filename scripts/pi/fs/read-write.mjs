import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { die } from "../errors.mjs";

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function parseJsonObjectFile(filePath, { redact = false } = {}) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { ok: false, reason: redact ? "invalid JSON" : `invalid JSON: ${error.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "must be a JSON object" };
  }
  return { ok: true, data };
}

export function readJsonObject(filePath, fallback) {
  if (!exists(filePath)) {
    if (fallback !== undefined) return fallback;
    die(`missing ${filePath}`);
  }
  const parsed = parseJsonObjectFile(filePath);
  if (!parsed.ok) die(`${filePath} ${parsed.reason}`);
  return parsed.data;
}

export function writeAtomic(dest, contents, mode) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const dir = path.dirname(dest);
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, contents, { mode: mode ?? 0o666, flag: "wx" });
    if (mode && process.platform !== "win32") fs.chmodSync(tmp, mode);
    try {
      fs.renameSync(tmp, dest);
    } catch {
      fs.copyFileSync(tmp, dest);
      if (mode && process.platform !== "win32") fs.chmodSync(dest, mode);
    }
    if (mode && process.platform !== "win32") {
      try {
        fs.chmodSync(dest, mode);
      } catch {
        // best-effort on platforms that already applied mode via rename
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
