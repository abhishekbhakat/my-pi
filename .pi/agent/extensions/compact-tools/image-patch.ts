import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { NO_TUI_IMAGE_EXTENSIONS } from "./constants";

function contentBlocks(result: any): any[] {
	const content = result?.content ?? result?.partialResult?.content;
	return Array.isArray(content) ? content : [];
}

function fileExtension(path: string): string {
	const base = path.split(/[\\/]/).pop() ?? path;
	const dot = base.lastIndexOf(".");
	if (dot <= 0 || dot === base.length - 1) return "";
	return base.slice(dot + 1).toLowerCase();
}

function pathFromToolArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	if (typeof record.path === "string") return record.path;
	if (typeof record.file_path === "string") return record.file_path;
	return "";
}

function mimeToExtension(mimeType: unknown): string {
	if (typeof mimeType !== "string") return "";
	const subtype = mimeType.toLowerCase().split(";")[0]?.split("/")[1] ?? "";
	if (subtype === "jpeg") return "jpg";
	if (subtype === "svg+xml") return "svg";
	if (subtype === "x-icon" || subtype === "vnd.microsoft.icon") return "ico";
	return subtype;
}

function shouldHideInlineImage(toolName: string | undefined, args: unknown, result: any): boolean {
	if (toolName !== "read") return false;
	const pathExt = fileExtension(pathFromToolArgs(args));
	if (pathExt && NO_TUI_IMAGE_EXTENSIONS.has(pathExt)) return true;
	for (const item of contentBlocks(result)) {
		if (item?.type !== "image") continue;
		const mimeExt = mimeToExtension(item.mimeType);
		if (mimeExt && NO_TUI_IMAGE_EXTENSIONS.has(mimeExt)) return true;
	}
	return false;
}

function withoutImages(content: any): any[] | undefined {
	if (!Array.isArray(content)) return undefined;
	if (!content.some((item: any) => item?.type === "image")) return undefined;
	return content.filter((item: any) => item?.type !== "image");
}

/** UI-only: drop image blocks so ToolExecutionComponent does not reserve image rows. Model still gets full content from the agent path. */
function stripImagesForDisplay(result: any): any {
	if (!result || typeof result !== "object") return result;
	const content = withoutImages(result.content);
	const partialContent = withoutImages(result.partialResult?.content);
	if (!content && !partialContent) return result;
	const next = { ...result };
	if (content) next.content = content;
	if (partialContent) {
		next.partialResult = {
			...result.partialResult,
			content: partialContent,
		};
	}
	return next;
}

const UPDATE_RESULT_PATCHED = Symbol.for("compact-tools.updateResultPatched");

export function patchToolExecutionNoInlineImages(): void {
	const proto = ToolExecutionComponent.prototype as ToolExecutionComponent & {
		[UPDATE_RESULT_PATCHED]?: boolean;
		toolName?: string;
		args?: unknown;
		updateResult(result: any, isPartial?: boolean): void;
	};
	if (proto[UPDATE_RESULT_PATCHED]) return;
	proto[UPDATE_RESULT_PATCHED] = true;
	const original = proto.updateResult;
	proto.updateResult = function (this: typeof proto, result: any, isPartial?: boolean) {
		const next = shouldHideInlineImage(this.toolName, this.args, result)
			? stripImagesForDisplay(result)
			: result;
		return original.call(this, next, isPartial);
	};
}
