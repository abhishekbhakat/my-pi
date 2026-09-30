import fs from "node:fs";
import path from "node:path";
import { die } from "../errors.mjs";
import { exists } from "../fs/read-write.mjs";
import { run } from "../toolchain/run.mjs";

export function normalizeProxyOrigin(host) {
  let origin = host.trim();
  if (!origin || /[\s"\\]/.test(origin)) die("Proxy host must not contain whitespace, quotes, or backslashes.");
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  if (origin.endsWith("/v1")) {
    origin = origin.slice(0, -3);
    while (origin.endsWith("/")) origin = origin.slice(0, -1);
  }
  if (origin.startsWith("http://") || origin.startsWith("https://")) return origin;
  return origin.includes(":") ? `http://${origin}` : `http://${origin}:8383`;
}

export function patchModelsProxy(modelsFile, origin) {
  if (!exists(modelsFile)) {
    console.log("  Skipping proxy update; models.json not found.");
    return;
  }
  const text = fs.readFileSync(modelsFile, "utf8").replace(
    /"baseUrl"\s*:\s*"[^"]*"/g,
    (match) => `"baseUrl": "${origin}${match.endsWith('/v1"') ? "/v1" : ""}"`,
  );
  fs.writeFileSync(modelsFile, text);
  console.log(`  Updated models.json proxy origin to ${origin}.`);
}

export function applySparseCheckouts(skillsDir) {
  if (!exists(skillsDir) || run("git", ["--version"], undefined).status !== 0) return;
  const configs = fs.readdirSync(skillsDir).filter((name) => name.endsWith(".sparse-checkout"));
  for (const name of configs) {
    const base = name.replace(/\.sparse-checkout$/, "");
    const submod = path.join(skillsDir, base);
    if (!exists(submod)) {
      console.log(`[sparse-checkout] Skipping ${base}: directory missing`);
      continue;
    }
    if (!exists(path.join(submod, ".git"))) {
      console.log(`[sparse-checkout] Skipping ${base}: not a git checkout`);
      continue;
    }
    const paths = fs.readFileSync(path.join(skillsDir, name), "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean);
    if (!paths.length) {
      console.log(`[sparse-checkout] Skipping ${base}: no paths in ${name}`);
      continue;
    }
    console.log(`[sparse-checkout] ${base}: ${paths.join(" ")}`);
    const init = run("git", ["sparse-checkout", "init", "--cone"], submod);
    const set = run("git", ["sparse-checkout", "set", ...paths], submod);
    console.log(init.status === 0 && set.status === 0 ? "  Applied." : `  WARNING: sparse-checkout failed for ${base}.`);
  }
  if (configs.length) console.log("");
}
