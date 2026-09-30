import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { die } from "../errors.mjs";
import { exists } from "../fs/read-write.mjs";
import { copyDirReplace, rmTree } from "../fs/tree.mjs";
import { HOME_AGENT, INSTALL_ROOT, REPO_AGENT, REPO_ROOT } from "../paths.mjs";
import { ensureBunPiCli, extensionInstallSpec, updatePiAndExtensions } from "../toolchain/bun-cli.mjs";
import { run } from "../toolchain/run.mjs";
import { mergeAuth } from "./merge-auth.mjs";
import { applySparseCheckouts, normalizeProxyOrigin, patchModelsProxy } from "./proxy.mjs";

export function install(flags) {
  if (!exists(REPO_AGENT)) die(`Source directory not found: ${REPO_AGENT}`);
  if (!flags.configOnly) ensureBunPiCli();
  console.log(`Copying .pi/agent -> ${HOME_AGENT}\n`);
  console.log("  Overwriting protected files.\n");
  fs.mkdirSync(HOME_AGENT, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const [label, name] of [["extensions", "extensions"], ["skills", "skills"], ["themes", "themes"]]) {
    if (label === "skills") applySparseCheckouts(path.join(REPO_AGENT, "skills"));
    if (label === "extensions") {
      console.log("[extensions]");
      const extStats = copyDirReplace(path.join(REPO_AGENT, name), path.join(HOME_AGENT, name));
      if (extStats) {
        console.log(`  Mirrored ${extStats.files} files (${extStats.unchanged} unchanged), removed ${extStats.removed} orphans in ${extStats.ms}ms`);
        console.log("  Skipped: node_modules, .git (preserved on live if present)");
        copied += 1;
      }
      console.log("");
      const extDir = path.join(HOME_AGENT, "extensions");
      if (exists(path.join(extDir, "package.json"))) {
        const spec = extensionInstallSpec();
        console.log(`[extensions ${spec.cmd}]`);
        const lock = path.join(extDir, "package-lock.json");
        const nm = path.join(extDir, "node_modules");
        console.log(`  package-lock.json: ${exists(lock) ? "yes" : "missing (full resolve)"}`);
        console.log(`  node_modules: ${exists(nm) ? "preserved" : "absent (cold install)"}`);
        console.log(`  starting ${spec.cmd} install (output below)...`);
        const result = run(spec.cmd, spec.args, extDir, {
          stdio: "inherit",
          label: `${spec.cmd} install`,
        });
        if (result.status === 0) console.log(`  ${spec.cmd} install complete.\n`);
        else console.log(`  WARNING: ${spec.cmd} install failed (status ${result.status ?? "unknown"}).\n`);
      }
      continue;
    }
    console.log(`[${label}]`);
    const stats = copyDirReplace(path.join(REPO_AGENT, name), path.join(HOME_AGENT, name));
    if (stats) {
      console.log(`  Mirrored ${stats.files} files (${stats.unchanged} unchanged), removed ${stats.removed} orphans in ${stats.ms}ms`);
      console.log("  Skipped: node_modules, .git");
      copied += 1;
    }
    console.log("");
  }
  console.log("[root files]");
  for (const file of INSTALL_ROOT) {
    const src = path.join(REPO_AGENT, file);
    if (!exists(src)) continue;
    fs.copyFileSync(src, path.join(HOME_AGENT, file));
    console.log(`  Copied ${file}`);
    copied += 1;
  }
  console.log("\n[bin]");
  const binDir = path.join(HOME_AGENT, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ["tf", "ssm-server"]) {
    const src = path.join(REPO_ROOT, "scripts", name === "ssm-server" ? "ssm-server.mjs" : name);
    if (!exists(src)) continue;
    const dst = path.join(binDir, name);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
    console.log(`  Copied ${name} -> ${dst}`);
    copied += 1;
  }
  console.log("\n[auth.json]");
  // api_key both ways; oauth only home -> repo (sync). Install never push oauth live.
  mergeAuth(path.join(HOME_AGENT, "auth.json"), path.join(REPO_AGENT, "auth.json"), { skipOauth: true });
  if (flags.host) {
    console.log("\n[models proxy]");
    patchModelsProxy(path.join(HOME_AGENT, "models.json"), normalizeProxyOrigin(flags.host));
  }
  const agentsSrc = path.join(REPO_ROOT, ".pi", "agents");
  if (exists(agentsSrc)) {
    const agentsDst = path.join(os.homedir(), ".pi", "agents");
    console.log("\n[agents]");
    rmTree(agentsDst);
    fs.mkdirSync(agentsDst, { recursive: true });
    for (const file of fs.readdirSync(agentsSrc).filter((name) => name.endsWith(".md"))) {
      fs.copyFileSync(path.join(agentsSrc, file), path.join(agentsDst, file));
    }
    console.log("  Done.");
  }
  console.log(`\n=============================\n Copy complete.\n Copied: ${copied}\n Skipped: ${skipped}\n=============================\n`);
  if (!flags.configOnly) updatePiAndExtensions();
  console.log("Run /reload in pi to pick up changes.");
}
