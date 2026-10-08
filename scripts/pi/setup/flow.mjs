import { die, SetupAbort } from "../errors.mjs";
import { REPO_AGENT, REPO_ROOT, PROFILE_PATCH } from "../paths.mjs";
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
  collectSecretsFromStaged,
  restoreAgentTracked,
  setupRepoGate,
  writeProfilePatch,
} from "./profile-patch.mjs";
import {
  describeSettingsPlan,
  describeStaged,
  planSettings,
  promptDefaultModel,
  promptThinkingLevel,
} from "./settings-plan.mjs";
import { probeClaude, updateClaude } from "../toolchain/claude.mjs";

export function parseSetupArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      printSetupHelp();
      process.exit(0);
    } else if (arg === "--create-branch") {
      // Kept so old scripts do not die; branching removed.
      const name = argv[i + 1];
      if (name && !name.startsWith("-")) i += 1;
      console.log("WARNING: --create-branch ignored; setup no longer keeps a git branch.");
    } else {
      die(`Unknown setup option ${arg}`);
    }
  }
  return flags;
}

export function printSetupHelp() {
  console.log(`Usage:
  node scripts/pi.mjs setup
  make setup

No git branch is created. Setup:
  1. Refuses if tracked .pi/agent files are dirty (auth.json ignored)
  2. Writes personalized files under .pi/agent
  3. Saves a diff as untracked userprofile.patch at the repo root
  4. Restores tracked .pi/agent files to HEAD (auth.json stays)

Does not install. Run make install afterward; that applies userprofile.patch
in a temp staging dir, then copies to ~/.pi.

Enabling claude-code-cli also requires an OpenRouter API key: Claude sometimes
emits broken tool XML; Morph (morph/morph-v3-fast) repairs it so Pi can run
tools. Needed even if you decline openrouter chat models.

Needs a TTY. Never writes ~/.pi.
If install cannot apply userprofile.patch, run make setup again.`);
}

export async function setup(_flags = {}) {
  if (!isInteractive()) throw new SetupAbort("setup needs an interactive terminal (TTY).");
  const inputs = loadSetupInputs(REPO_AGENT);
  const order = orderProviders(inputs.settings.enabledModels);
  const capSources = loadCapabilitySources(REPO_AGENT);
  const deciderRegistry = loadDecidersRegistry(REPO_AGENT);

  const gate = setupRepoGate(REPO_ROOT);
  console.log(
    gate.branch
      ? `On branch ${gate.branch} (no new branch). base=${gate.baseSha.slice(0, 12)}`
      : `Detached HEAD (no new branch). base=${gate.baseSha.slice(0, 12)}`,
  );

  const claude = probeClaude();
  console.log(claude.found ? `Claude Code CLI: ${claude.version}` : "Claude Code CLI: not found on PATH");
  if (claude.found) {
    const upd = updateClaude();
    if (upd.ok) console.log(`Claude update: ran ${upd.path}`);
    else console.log(`WARNING: Claude update failed (${upd.detail}); continuing.`);
  }

  let staged = null;
  let patchInfo = null;
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

    const settingsPlan = planSettings(inputs.settings, staged, order);
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

    patchInfo = writeProfilePatch({
      root: REPO_ROOT,
      baseSha: gate.baseSha,
      branch: gate.branch,
      secrets: collectSecretsFromStaged(staged),
      patchPath: PROFILE_PATCH,
    });
    restoreAgentTracked(REPO_ROOT);
    console.log(
      `Wrote ${PROFILE_PATCH} (${patchInfo.hunks} hunks). Restored tracked .pi/agent to HEAD; auth.json kept.`,
    );

    console.log(describePersistSummary({ gate, staged, order, capTargets, deciderPlan, report, patchInfo }));
  } finally {
    prompter.close();
  }

  if (staged) printPostSetupHints(staged);
}
