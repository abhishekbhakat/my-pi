import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTool } from "../toolchain/run.mjs";

const PATH_LINE = (binDir) => `export PATH="${binDir}:$PATH"`;

/**
 * Ensure ~/.pi/agent/bin is on the user's PATH, platform-dependent:
 * - win32: [Environment]::SetEnvironmentVariable('Path', ..., 'User') via PowerShell
 * - linux: append export line to ~/.bashrc
 * - darwin: append export line to ~/.zshrc
 *
 * Detection loads the user's real shell config (interactive, login rc files)
 * and checks whether the resolved PATH contains the bin dir. The rc file is
 * only touched when the shell does not resolve it. Never throws.
 */
export function ensureBinInPath(binDir, log = console.log) {
  try {
    if (process.platform === "win32") {
      ensureBinInPathWindows(binDir, log);
    } else {
      ensureBinInPathUnix(binDir, log);
    }
  } catch (error) {
    log(`  WARNING: could not update PATH (${error.message})`);
    log(`  Add ${binDir} to PATH manually.`);
  }
}

function ensureBinInPathUnix(binDir, log) {
  if (shellResolves(binDir)) {
    log(`  PATH already contains ${binDir}`);
    return;
  }
  const rcFile = path.join(os.homedir(), process.platform === "darwin" ? ".zshrc" : ".bashrc");
  const content = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf8") : "";
  if (content.includes(PATH_LINE(binDir))) {
    log(`  ${binDir} already exported in ${rcFile}; not loaded by this shell.`);
    log(`  Run 'source ${rcFile}' or open a new terminal to pick it up.`);
    return;
  }
  fs.writeFileSync(rcFile, `${content}${content.endsWith("\n") || content === "" ? "" : "\n"}${PATH_LINE(binDir)}\n`);
  log(`  Added ${binDir} to PATH via ${rcFile}`);
  log(`  Run 'source ${rcFile}' or open a new terminal to pick it up.`);
}

/** Launch the user's shell as it loads for real (interactive) and check the resolved PATH. */
function shellResolves(binDir) {
  if (process.env.PATH.split(path.delimiter).includes(binDir)) return true;
  const fallback = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  const shell = process.env.SHELL || fallback;
  const result = runTool(shell, ["-l", "-i", "-c", 'printf "%s" "$PATH"'], { timeout: 5_000 });
  if (result.status !== 0 || !result.stdout) return false;
  return result.stdout.split(path.delimiter).includes(binDir);
}

function ensureBinInPathWindows(binDir, log) {
  const ps = [
    `$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')`,
    `if ($userPath -split ';' -contains '${binDir}') { Write-Output 'present' }`,
    `else {`,
    `  [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';${binDir}'), 'User')`,
    `  Write-Output 'added'`,
    `}`,
  ].join(" ");
  const result = runTool("powershell.exe", ["-NoProfile", "-Command", ps]);
  if (result.status !== 0) {
    throw new Error(String(result.stderr || "powershell failed").trim());
  }
  if (String(result.stdout).trim() === "present") {
    log(`  PATH already contains ${binDir}`);
  } else {
    log(`  Added ${binDir} to user PATH`);
    log("  Open a new terminal to pick it up.");
  }
}
