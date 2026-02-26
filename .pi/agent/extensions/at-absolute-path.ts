import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolve, join } from "node:path";
import { statSync } from "node:fs";

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    const text = event.text;
    if (!text.includes("@")) return { action: "continue" };

    const cwd = ctx.cwd;

    // Match @"path with spaces" or @path (no spaces)
    const pattern = /@"([^"]+)"|@(\S+)/g;
    let changed = false;
    const result = text.replace(pattern, (match, quoted, unquoted) => {
      const raw = quoted ?? unquoted;
      // Strip @ if already absolute
      if (raw.startsWith("/")) {
        changed = true;
        return raw;
      }

      const candidate = join(cwd, raw);
      try {
        const stats = statSync(candidate);
        changed = true;
        const abs = resolve(candidate);
        const trailingSeparator = raw.match(/[\\/]$/)?.[0];
        if (stats.isDirectory() && trailingSeparator) {
          return `${abs}${trailingSeparator}`;
        }
        return abs;
      } catch {
        return match;
      }
    });

    if (changed) return { action: "transform", text: result };
    return { action: "continue" };
  });
}
