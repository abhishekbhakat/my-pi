import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Verdict } from "./decide.ts";

export type VerdictStore = {
  load(key: string): Verdict | undefined;
  save(key: string, verdict: Verdict): void;
  size(): number;
};

/** JSON file on disk so verdicts survive restarts. Keep it on the volume. */
export function openVerdictStore(path: string): VerdictStore {
  const map = new Map<string, Verdict>();
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, Verdict>;
      for (const [key, verdict] of Object.entries(parsed)) map.set(key, verdict);
    } catch {
      // Corrupt file: start empty rather than crash.
    }
  }
  const flush = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(Object.fromEntries(map.entries())));
  };
  return {
    load: (key) => map.get(key),
    save: (key, verdict) => {
      map.set(key, verdict);
      flush();
    },
    size: () => map.size,
  };
}
