import { die, SetupAbort } from "../errors.mjs";
import { REPO_AGENT, REPO_ROOT } from "../paths.mjs";
import {
  loadCapabilitySources,
  planCapabilityEdits,
  describeCapabilityPlan,
  resolveCapabilityModels,
  resolveCapabilityTargets,
} from "./capabilities.mjs";
import { collectProviders } from "./collect.mjs";
import {
  describeDeciderPlan,
  loadDecidersRegistry,
  resolveDeciderTargets,
} from "./deciders.mjs";
import { loadSetupInputs } from "./inputs.mjs";
import { describePersistSummary, persistSetup, printPostSetupHints } from "./persist.mjs";
import { orderProviders } from "./providers.mjs";
import { createPrompter, isInteractive } from "./prompts.mjs";
import { setupRepoGate } from "./branch-gate.mjs";
import {
  buildUserProfile,
  removeLegacyProfilePatch,
  writeUserProfile,
} from "./user-profile.mjs";
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
  1. Reads repo .pi/agent (settings, models, auth, deciders)
  2. Asks which providers to enable, default model, thinking level,
     decision models, and model plus reasoning effort for each capability and timeline
  3. Writes API keys to untracked .pi/agent/auth.json
  4. Writes personalization to untracked userprofile.json at the repo root

Tracked .pi/agent files are never modified, so a dirty worktree is fine.
Setup needs no branch and no clean checkout.

Does not install. Run make install afterward; that merges userprofile.json
onto repo .pi/agent in a temp staging dir, then copies to ~/.pi.
userprofile.json is plain JSON and safe to edit by hand; re-run make setup
anytime to regenerate it.

Enabling claude-code-sdk also requires an OpenRouter API key: Claude sometimes
emits broken tool XML; Morph (morph/morph-v3-fast) repairs it so Pi can run
tools. Needed even if you decline openrouter chat models.

Needs a TTY. Never writes ~/.pi.
A bad or stale userprofile.json never breaks install: invalid sections warn
and fall back to repo defaults.`);
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
  let profileInfo = null;
  const prompter = createPrompter();
  try {
    const wantClaude = await prompter.askYesNo(
      "Do you have Claude Code / want claude-code-sdk models?",
    );
    console.log(`Phase 1: claude-code-sdk=${wantClaude ? "yes" : "no"}`);

    staged = await collectProviders({
      order,
      auth: inputs.auth,
      models: inputs.models,
      wantClaude,
      prompter,
    });
    console.log(describeStaged(staged, order));

    const settingsPlan = planSettings(inputs.settings, staged, order);
    await promptDefaultModel({ settings: inputs.settings, plan: settingsPlan, order, prompter });
    await promptThinkingLevel({ settings: inputs.settings, plan: settingsPlan, models: inputs.models, prompter });
    console.log(describeSettingsPlan(settingsPlan, inputs.settings));

    const resolvedCaps = resolveCapabilityModels(settingsPlan.kept, order);
    const capTargets = await resolveCapabilityTargets({
      kept: settingsPlan.kept,
      order,
      resolved: resolvedCaps,
      sources: capSources,
      models: inputs.models,
      prompter,
    });
    const capEdits = planCapabilityEdits(capSources, capTargets);
    console.log(describeCapabilityPlan(capTargets, capEdits));

    let deciderPlan = null;
    if (deciderRegistry) {
      deciderPlan = await resolveDeciderTargets({ registry: deciderRegistry, auth: inputs.auth, prompter });
      console.log(describeDeciderPlan(deciderPlan));
      for (const [provider, key] of deciderPlan.keys) staged.apiKeys.set(provider, key);
    } else {
      console.log("Phase 5: deciders.json missing; skipping decision-model setup.");
    }

    const report = persistSetup({
      agentDir: REPO_AGENT,
      staged,
      settingsText: inputs.settingsText,
      decidersText: inputs.decidersText,
      capEdits,
    });

    const auth = { ...(inputs.auth ?? {}) };
    for (const [provider, key] of staged.apiKeys) auth[provider] = { type: "api_key", key };

    profileInfo = writeUserProfile({
      profile: buildUserProfile({ settingsPlan, deciderPlan, capTargets, auth }),
    });
    removeLegacyProfilePatch();
    console.log(
      `Wrote ${profileInfo.path} (${profileInfo.sections.join(", ")}; ${profileInfo.bytes} bytes). Tracked .pi/agent untouched; auth.json kept.`,
    );

    console.log(describePersistSummary({ gate, staged, order, capTargets, deciderPlan, report, profileInfo }));
  } finally {
    prompter.close();
  }

  if (staged) printPostSetupHints(staged);
}
