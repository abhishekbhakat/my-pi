import { spawnSync } from "node:child_process";

export function runTool(cmd, args, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const stdio = options.stdio ?? ["ignore", "pipe", "pipe"];
  try {
    return spawnSync(cmd, args, {
      encoding: "utf8",
      stdio,
      timeout,
      shell: process.platform === "win32",
      env: options.env ?? process.env,
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error?.message ?? error), error };
  }
}

export function run(cmd, args, cwd, options = {}) {
  const stdio = options.stdio ?? "ignore";
  const label = options.label;
  if (label) {
    console.log(`  $ ${cmd} ${args.join(" ")}`);
    console.log(`  cwd: ${cwd}`);
  }
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd, stdio, shell: process.platform === "win32" });
  if (label) {
    const ms = Date.now() - started;
    if (result.error) console.log(`  ${label} error after ${ms}ms: ${result.error.message}`);
    else console.log(`  ${label} exited ${result.status} in ${ms}ms`);
  }
  return result;
}

export function commandOnPath(name) {
  const result = spawnSync(name, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return !result.error && result.status === 0;
}
