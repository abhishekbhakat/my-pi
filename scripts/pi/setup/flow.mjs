import { die, SetupAbort } from "../errors.mjs";
import { REPO_AGENT, REPO_ROOT } from "../paths.mjs";
import { autoBranchName, branchGate } from "./branch-gate.mjs";
import {
  loadCapabilitySources,
  planCapabilityEdits,
  describeCapabilityPlan,
  resolveCapabilityModels,
  resolveCapabilityTargets,
} from "./capabilities.mjs";
import { collectProviders } from "./collect.mjs";
import {
  applyDeciderPlan,
  describeDeciderPlan,
  loadDecidersRegistry,
  resolveDeciderTargets,
} from "./deciders.mjs";
import { loadSetupInputs } from "./inputs.mjs";
import { describePersistSummary, persistSetup, printPostSetupHints } from "./persist.mjs";
import { orderProviders } from "./providers.mjs";
import { createPrompter, isInteractive } from "./prompts.mjs";
import {
  describeSettingsPlan,
  describeStaged,
  planSettings,
  promptDefaultModel,
  promptThinkingLevel,
} from "./settings-plan.mjs";
import { probeClaude, updateClaude } from "../toolchain/claude.mjs";
import { install } from "../transfer/install.mjs";

export function parseSetupArgs(argv) {
  const flags = { createBranch: null, createBranchGiven: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      printSetupHelp();
      process.exit(0);
    } else if (arg === "--create-branch") {
      const name = argv[i + 1];
      if (!name || name.startsWith("-")) {
        flags.createBranch = autoBranchName();
      } else {
        i += 1;
        flags.createBranch = name;
      }
      if (flags.createBranchGiven) die("--create-branch given more than once.");
      flags.createBranchGiven = true;
    } else {
      die(`Unknown setup option ${arg}`);
    }
  }
  return flags;
}

export function printSetupHelp() {
  console.log(`Usage:
  node scripts/pi.mjs setup [--create-branch [NAME]]
  make setup

On main/master/detached HEAD, setup auto-creates a local branch pi-install-<ddmmyyyy>
(-2, -3... if taken). --create-branch NAME pins a specific branch name.

--create-branch [NAME]  Pin branch name; bare flag or plain make setup auto-generates.
--help                  Show this help

Also asks for the default model and its thinking level (Enter keeps the current
choice; a single enabled model is used without asking).

Needs a TTY. Writes only repo .pi/agent files; never ~/.pi except via optional install.`);
}

export async function setup(flags) {
  if (!isInteractive()) throw new SetupAbort("setup needs an interactive terminal (TTY).");
  // Load before any git write so a bad JSON never leaves an orphan branch.
  const inputs = loadSetupInputs(REPO_AGENT);
  const order = orderProviders(inputs.settings.enabledModels);
  const capSources = loadCapabilitySources(REPO_AGENT);
  const deciderRegistry = loadDecidersRegistry(REPO_AGENT);

  const gate = branchGate(REPO_ROOT, flags.createBranch ?? "auto");
  console.log(gate.created ? `Created branch ${gate.branch}.` : `On branch ${gate.branch}.`);

  const claude = probeClaude();
  console.log(claude.found ? `Claude Code CLI: ${claude.version}` : "Claude Code CLI: not found on PATH");
  if (claude.found) {
    const upd = updateClaude();
    if (upd.ok) console.log(`Claude update: ran ${upd.path}`);
    else console.log(`WARNING: Claude update failed (${upd.detail}); continuing.`);
  }

  let runInstall = false;
  let staged = null;
  const prompter = createPrompter();
  try {
    const wantClaude = await prompter.askYesNo(
      "Do you have Claude Code CLI / want claude-code-cli models?",
    );
    const wantCodex = await prompter.askYesNo(
      "Do you have a Codex subscription (openai-codex oauth)?",
    );
    console.log(
      `Phase 1: claude-code-cli=${wantClaude ? "yes" : "no"}, openai-codex=${wantCodex ? "yes" : "no"}`,
    );

    staged = await collectProviders({
      order,
      auth: inputs.auth,
      models: inputs.models,
      wantClaude,
      wantCodex,
      prompter,
    });
    console.log(describeStaged(staged, order));

    let settingsPlan;
    try {
      settingsPlan = planSettings(inputs.settings, staged, order);
    } catch (error) {
      if (error instanceof SetupAbort && error.message === "enable at least one provider" && gate.created) {
        throw new SetupAbort(
          `enable at least one provider (now on branch ${gate.branch}; re-run without --create-branch)`,
        );
      }
      throw error;
    }
    await promptDefaultModel({ settings: inputs.settings, plan: settingsPlan, order, prompter });
    await promptThinkingLevel({ settings: inputs.settings, plan: settingsPlan, prompter });
    console.log(describeSettingsPlan(settingsPlan, inputs.settings));

    const resolvedCaps = resolveCapabilityModels(settingsPlan.kept, order);
    const capTargets = await resolveCapabilityTargets({
      kept: settingsPlan.kept,
      order,
      resolved: resolvedCaps,
      prompter,
    });
    const capEdits = planCapabilityEdits(capSources, capTargets);
    console.log(describeCapabilityPlan(capTargets, capEdits));

    let deciderPlan = null;
    let deciderContents = null;
    if (deciderRegistry) {
      deciderPlan = await resolveDeciderTargets({ registry: deciderRegistry, auth: inputs.auth, prompter });
      console.log(describeDeciderPlan(deciderPlan));
      for (const [provider, key] of deciderPlan.keys) staged.apiKeys.set(provider, key);
      deciderContents = applyDeciderPlan(deciderRegistry, deciderPlan);
    } else {
      console.log("Phase 5: deciders.json missing; skipping decision-model setup.");
    }

    const report = persistSetup({
      agentDir: REPO_AGENT,
      staged,
      settingsPlan,
      settingsText: inputs.settingsText,
      capEdits,
      deciderContents,
    });
    console.log(describePersistSummary({ gate, staged, order, capTargets, deciderPlan, report }));
    try {
      runInstall = await prompter.askYesNo("Apply config install now (repo .pi/agent -> ~/.pi/agent)?");
    } catch (error) {
      if (error instanceof SetupAbort && error.exitCode === 130) {
        throw new SetupAbort("files already written; install skipped", 130);
      }
      throw error;
    }
  } finally {
    prompter.close();
  }

  if (runInstall) {
    try {
      install({ yes: false, prune: false, host: null, configOnly: true });
    } catch (error) {
      console.log(`WARNING: install failed: ${error?.message ?? error}`);
    }
  }
  if (staged) printPostSetupHints(staged, runInstall);
}
