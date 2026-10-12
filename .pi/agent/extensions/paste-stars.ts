/**
 * Paste Stars — bracketed pastes land as a marker of stars, one per pasted
 * character, so the terminal visibly confirms the paste arrived.
 *
 * The editor's stock behavior inserts small pastes (< 10 lines, < 1000 chars)
 * as plain text and large ones as a `[paste #N +X lines]` marker. On terminals
 * where a paste seems to show nothing, there is no feedback at all. This
 * extension makes every paste show stars of the same length as the pasted
 * content; the real text stays in the editor's paste store and expands on
 * submit, exactly like the stock large-paste markers.
 *
 * Known limit: the stars marker is not an atomic segment to the stock
 * segmentation (its regex knows the stock formats only), so walking the cursor
 * into the stars and deleting part of them can leave literal stars in the
 * submitted message. Undo (Ctrl+Z) removes the whole marker cleanly.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Pastes longer than this keep the stock `[paste #N +N lines]` marker. */
const STAR_CAP = 1000;

export default function pasteStars(pi: ExtensionAPI) {
	pi.ui.setEditorComponent((tui, theme, keybindings) => {
		const editor = new CustomEditor(tui, theme, keybindings);
		const self = editor as unknown as {
			handlePaste(text: string): void;
			expandPasteMarkers(text: string): string;
			cancelAutocomplete(): void;
			exitHistoryBrowsing(): void;
			pushUndoSnapshot(): void;
			insertTextAtCursorInternal(text: string): void;
			pastes: Map<number, string>;
			pasteCounter: number;
		};

		const baseHandlePaste = self.handlePaste.bind(editor);
		const baseExpandPasteMarkers = self.expandPasteMarkers.bind(editor);

		// Same clean as the stock editor: normalize line endings, expand tabs,
		// drop non-printable characters except newlines.
		const clean = (text: string): string =>
			text
				.replace(/\r\n?/g, "\n")
				.replace(/\t/g, "    ")
				.split("")
				.filter((c) => c === "\n" || c.charCodeAt(0) >= 32)
				.join("");

		self.handlePaste = (pastedText: string): void => {
			const cleaned = clean(pastedText);
			if (!cleaned) return;
			if (cleaned.length > STAR_CAP) {
				baseHandlePaste(pastedText);
				return;
			}
			self.cancelAutocomplete();
			self.exitHistoryBrowsing();
			self.pushUndoSnapshot();
			self.pasteCounter += 1;
			self.pastes.set(self.pasteCounter, cleaned);
			self.insertTextAtCursorInternal(
				`[paste #${self.pasteCounter} ${"*".repeat(cleaned.length)}]`,
			);
		};

		self.expandPasteMarkers = (text: string): string => {
			let result = baseExpandPasteMarkers(text);
			for (const [id, content] of self.pastes) {
				const stars = new RegExp(`\\[paste #${id} \\*+\\]`, "g");
				result = result.replace(stars, () => content);
			}
			return result;
		};

		return editor;
	});
}
