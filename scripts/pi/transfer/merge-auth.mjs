import { readJsonObject, writeAtomic, exists } from "../fs/read-write.mjs";
import { isOauthEntry } from "../setup/providers.mjs";

export function mergeAuth(destPath, overlayPath, options = {}) {
  const skipOauth = Boolean(options.skipOauth);
  if (!exists(overlayPath)) {
    console.log("  Skipping auth.json merge; overlay not found.");
    return;
  }
  const dest = readJsonObject(destPath, {});
  const overlay = readJsonObject(overlayPath);
  const applied = {};
  const skippedOauth = [];
  for (const [key, value] of Object.entries(overlay)) {
    if (skipOauth && isOauthEntry(value)) {
      skippedOauth.push(key);
      continue;
    }
    applied[key] = value;
  }
  const merged = { ...dest, ...applied };
  const destKeys = Object.keys(dest);
  const appliedKeys = Object.keys(applied);
  const added = appliedKeys.filter((key) => !Object.hasOwn(dest, key)).sort();
  const overridden = appliedKeys.filter((key) => Object.hasOwn(dest, key)).sort();
  const kept = destKeys.filter((key) => !Object.hasOwn(applied, key)).sort();
  writeAtomic(destPath, `${JSON.stringify(merged, null, 2)}\n`, 0o600);
  console.log(`  Merged auth.json -> ${destPath}`);
  if (added.length) console.log(`  Added: ${added.join(", ")}`);
  if (overridden.length) console.log(`  Overrode: ${overridden.join(", ")}`);
  if (kept.length) console.log(`  Kept: ${kept.join(", ")}`);
  if (skippedOauth.length) console.log(`  Skipped oauth (home-only install): ${skippedOauth.sort().join(", ")}`);
  if (!added.length && !overridden.length) console.log("  No incoming provider keys to apply.");
}
