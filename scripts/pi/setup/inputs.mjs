import fs from "node:fs";
import path from "node:path";
import { exists, parseJsonObjectFile } from "../fs/read-write.mjs";
import { SetupAbort } from "../errors.mjs";

export function loadSetupInputs(agentDir) {
  const read = (name, { required, redact }) => {
    const p = path.join(agentDir, name);
    if (!exists(p)) {
      if (required) throw new SetupAbort(`missing ${p}`);
      return {};
    }
    const r = parseJsonObjectFile(p, { redact });
    if (!r.ok) throw new SetupAbort(`${p}: ${r.reason}`);
    return r.data;
  };
  const settings = read("settings.json", { required: true, redact: false });
  const models = read("models.json", { required: false, redact: true });
  const auth = read("auth.json", { required: false, redact: true });
  if (!Array.isArray(settings.enabledModels) || !settings.enabledModels.every((x) => typeof x === "string")) {
    throw new SetupAbort("settings.json enabledModels must be an array of strings");
  }
  const settingsPath = path.join(agentDir, "settings.json");
  const settingsText = fs.readFileSync(settingsPath, "utf8");
  return { settings, models, auth, settingsText };
}
