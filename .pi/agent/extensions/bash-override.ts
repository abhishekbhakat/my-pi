import type { ExtensionAPI, BashToolDetails } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createBashTool } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const originalBash = createBashTool(cwd);

  pi.registerTool({
    name: "bash",
    label: "Bash",
    description: "Execute bash commands (`tree --gitignore`, `ls`, `rg`,  etc.)",
    promptSnippet: "Execute shell commands",
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return originalBash.execute(toolCallId, params, signal, onUpdate);
    },
  });
}
