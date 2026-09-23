import { basename } from "node:path";

const BRANCH_READ_FLAGS = new Set([
	"-a", "-r", "-v", "-vv", "-l", "--list", "--show-current", "--contains", "--merged", "--no-merged",
]);

const REMOTE_READ_SUBCOMMANDS = new Set(["show", "get-url"]);
const STASH_READ_SUBCOMMANDS = new Set(["list", "show"]);
const CONFIG_READ_FLAGS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);

const READ_ONLY_SUBCOMMANDS = new Set([
	"status", "diff", "log", "show", "blame", "rev-parse", "ls-files", "ls-tree", "cat-file",
	"describe", "shortlog", "version", "help", "grep", "check-ignore", "check-attr", "name-rev",
	"rev-list", "merge-base", "for-each-ref", "count-objects", "whatchanged", "annotate",
	"symbolic-ref", "var", "hash-object",
]);

export function unwrapGitTokens(tokens: string[]): string[] | null {
	if (basename(tokens[0] ?? "") !== "git") return null;
	const out: string[] = ["git"];
	let i = 1;
	while (i < tokens.length) {
		const token = tokens[i];
		if (token === "-C" || token === "--git-dir" || token === "--work-tree" || token === "-c") {
			i += 2;
			continue;
		}
		if (token.startsWith("--git-dir=") || token.startsWith("--work-tree=")) {
			i += 1;
			continue;
		}
		if (token.startsWith("-")) {
			i += 1;
			continue;
		}
		out.push(...tokens.slice(i));
		return out;
	}
	return out;
}

/** True when this git invocation only reads repository state. */
export function isKnownReadOnlyGit(tokens: string[]): boolean {
	const unwrapped = unwrapGitTokens(tokens);
	if (!unwrapped || unwrapped.length < 2) return false;
	const [subcommand, ...args] = unwrapped.slice(1);

	if (READ_ONLY_SUBCOMMANDS.has(subcommand)) return true;

	if (subcommand === "branch") {
		if (args.some((arg) =>
			arg === "-d" || arg === "-D" || arg === "-m" || arg === "-c" || arg === "-f" ||
			arg === "--delete" || arg === "--move" || arg === "--copy" || arg === "--force"
		)) {
			return false;
		}
		if (args.some((arg) => !arg.startsWith("-"))) return false;
		return args.every((arg) => BRANCH_READ_FLAGS.has(arg));
	}

	if (subcommand === "stash") {
		if (args.length === 0) return false;
		if (!STASH_READ_SUBCOMMANDS.has(args[0])) return false;
		if (args[0] === "list") return args.slice(1).every((arg) => arg.startsWith("-"));
		if (args[0] === "show") {
			return args.slice(1).every((arg) => arg === "-p" || arg === "--patch" || arg.startsWith("-") || /^stash@/i.test(arg));
		}
		return false;
	}

	if (subcommand === "remote") {
		if (args.length === 0 || args[0] === "-v" || args[0] === "--verbose") {
			return args.every((arg) => arg === "-v" || arg === "--verbose");
		}
		return REMOTE_READ_SUBCOMMANDS.has(args[0]);
	}

	if (subcommand === "config") {
		if (args.some((arg) => arg === "--unset" || arg === "--unset-all" || arg === "--add" || arg === "--remove-section")) {
			return false;
		}
		return args.some((arg) => CONFIG_READ_FLAGS.has(arg));
	}

	if (subcommand === "tag") {
		if (args.some((arg) =>
			arg === "-d" || arg === "--delete" || arg === "-f" || arg === "--force" ||
			arg === "-a" || arg === "-m" || arg === "-s" || arg === "-u"
		)) {
			return false;
		}
		if (args.some((arg) => arg === "-l" || arg === "--list" || arg.startsWith("--list="))) return true;
		return args.length === 0;
	}

	return false;
}
