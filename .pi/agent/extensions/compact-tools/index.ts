/**
 * Compact tool cards for Pi built-ins.
 *
 * Restyles read / write / edit / bash / grep / find / ls with tidy-style
 * two-line blocks. Execution stays native. Expand (ctrl+o) shows full detail.
 *
 *   ┊ ✓ $ bash
 *   ┊     rg -n foo src → done in 1s
 *
 *   ┊ ✓ > read
 *   ┊     ~/proj/a.ts → 42 lines
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { patchToolExecutionNoInlineImages } from "./image-patch";
import { registerCompactTools } from "./tools";

export default function (pi: ExtensionAPI) {
	patchToolExecutionNoInlineImages();
	registerCompactTools(pi);
}
