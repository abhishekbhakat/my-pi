#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { die, SetupAbort } from "./pi/errors.mjs";
import { parseSetupArgs, printSetupHelp, setup } from "./pi/setup/flow.mjs";
import { install } from "./pi/transfer/install.mjs";
import { sync } from "./pi/transfer/sync.mjs";

// Public surface consumed by tests/setup and any embedding caller.
export { SetupAbort } from "./pi/errors.mjs";
export { loadSetupInputs } from "./pi/setup/inputs.mjs";
export {
  CAPABILITY_PREFERRED,
  PROVIDER_PRIORITY,
  classifyProvider,
  filterEnabledModels,
  orderProviders,
  providerBaseUrl,
  resolveDefaults,
} from "./pi/setup/providers.mjs";
export { collectProviders } from "./pi/setup/collect.mjs";
export {
  loadCapabilitySources,
  planCapabilityEdits,
  resolveCapabilityModels,
  resolveCapabilityTargets,
} from "./pi/setup/capabilities.mjs";
export { createPrompter, isInteractive, parsePick, parseYesNo } from "./pi/setup/prompts.mjs";
export { describeSettingsPlan, describeStaged, planSettings } from "./pi/setup/settings-plan.mjs";
export { persistSetup } from "./pi/setup/persist.mjs";
export { branchGate } from "./pi/setup/branch-gate.mjs";
export { probeClaude, updateClaude } from "./pi/toolchain/claude.mjs";

function parseArgs(argv) {
  const flags = { yes: false, prune: false, host: null, configOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-y") flags.yes = true;
    else if (arg === "-p" || arg === "--prune" || arg === "-Prune") flags.prune = true;
    else if (arg === "--config-only") flags.configOnly = true;
    else if (arg === "-h") {
      flags.host = argv[i + 1];
      i += 1;
      if (!flags.host) die("-h requires a non-empty host.");
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      die(`Unknown option ${arg}`);
    }
  }
  return flags;
}

function printHelp() {
  console.log(`my-pi config CLI

Usage:
  node scripts/pi.mjs install [--config-only] [-h HOST]
  node scripts/pi.mjs sync [-p]
  node scripts/pi.mjs setup [--create-branch NAME] [--help]
  node scripts/pi.mjs help

install  Copy repo .pi/agent -> ~/.pi/agent.
         Default also manages the bun pi CLI (npm global removed, bun install -g if
         missing) and runs \`pi update\` + \`pi update --extensions\`.
         --config-only skips all CLI steps; used after the Rust pi is built
         (see make install / make config-install).
sync     Copy live ~/.pi/agent -> repo .pi/agent
setup    Interactive provider/auth bootstrap on a local branch (see setup --help)

--config-only  Config copy only; no bun CLI setup, no pi update
-h HOST  Set models.json proxy origin on install
-p       Prune repo files missing from live on sync
-y       Accepted, unused (protected files always overwritten)

auth.json: api_key merge both ways (incoming override, dest-only stay).
  oauth (type=oauth) flows home -> repo on sync only; install never overwrites live oauth.`);
}

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    printHelp();
    process.exit(0);
  }
  if (command === "setup") {
    const setupFlags = parseSetupArgs(rest);
    setup(setupFlags).then(
      () => process.exit(0),
      (error) => {
        if (!(error instanceof SetupAbort)) throw error;
        console.error(`ERROR: ${error.message}`);
        process.exit(error.exitCode);
      },
    );
    return;
  }
  const flags = parseArgs(rest);
  if (command === "install") install(flags);
  else if (command === "sync") sync(flags);
  else die(`Unknown command ${command}. Use install, sync, setup, or help.`);
}

if (isMain()) main(process.argv.slice(2));
