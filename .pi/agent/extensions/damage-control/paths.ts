import * as os from "node:os";
import * as path from "node:path";

export const PROTECTED_ROOTS = [
	"/",
	"/etc",
	"/usr",
	"/bin",
	"/sbin",
	"/boot",
	"/root",
	"/System",
	"/Library",
	path.join(os.homedir(), ".pi"),
	path.join(os.homedir(), ".ssh"),
	path.join(os.homedir(), ".gnupg"),
	path.join(os.homedir(), ".aws"),
	path.join(os.homedir(), ".kube"),
	path.join(os.homedir(), ".azure"),
	path.join(os.homedir(), ".docker"),
	path.join(os.homedir(), ".config", "gcloud"),
];

const SENSITIVE_BASENAME = /^(?:\.env(?:\..+)?|.*(?:-credentials|serviceAccount|service-account|secret)\.json|firebase-adminsdk.*\.json|serviceAccountKey\.json|kubeconfig|\.netrc|\.npmrc|\.pypirc|\.git-credentials)$/i;
const SENSITIVE_EXTENSION = /\.(?:pem|key|p12|pfx|tfstate|tfstate\.backup)$/i;
const SENSITIVE_LOCK = /^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Cargo\.lock|go\.sum|flake\.lock|bun\.lockb|uv\.lock|npm-shrinkwrap\.json)$/;
const SENSITIVE_HISTORY = /^(?:\.bash_history|\.zsh_history|\.node_repl_history|\.bashrc|\.zshrc|\.profile|\.bash_profile)$/;

/** Resolve a shell path argument. For globs, resolve the literal prefix before the first wildcard. */
export function resolveTarget(raw: string, cwd: string): string | null {
	let target = raw.startsWith("of=") ? raw.slice(3) : raw;
	if (!target || target.startsWith("-")) return null;
	if (target === "~" || target === "$HOME" || target === "${HOME}") target = os.homedir();
	else if (target.startsWith("~/")) target = path.join(os.homedir(), target.slice(2));
	else if (target.startsWith("$HOME/")) target = path.join(os.homedir(), target.slice(6));
	else if (target.startsWith("${HOME}/")) target = path.join(os.homedir(), target.slice(8));
	else if (target.includes("$") || /[`()]/.test(target)) return null;

	const wild = target.search(/[*?[]/);
	if (wild === 0) return null;
	if (wild > 0) {
		const slash = target.lastIndexOf("/", wild);
		target = slash >= 0 ? target.slice(0, slash + 1) : target.slice(0, wild);
		if (!target) return null;
	}
	return path.resolve(cwd, target);
}

export function protectedPathReason(raw: string, cwd: string): string | null {
	const target = resolveTarget(raw, cwd);
	if (!target) return null;
	if (target === os.homedir()) return "home directory is protected";
	if (target.split(path.sep).includes(".git")) return "Git metadata is protected";
	for (const root of PROTECTED_ROOTS) {
		if (target === root || (root !== "/" && target.startsWith(root + path.sep))) {
			return `protected path: ${root}`;
		}
	}
	return null;
}

export function sensitiveWriteReason(raw: string, cwd: string): string | null {
	const protectedReason = protectedPathReason(raw, cwd);
	if (protectedReason) return protectedReason;

	const target = resolveTarget(raw, cwd);
	if (!target) return null;
	const base = path.basename(target);
	if (SENSITIVE_BASENAME.test(base)) return `sensitive file: ${base}`;
	if (SENSITIVE_EXTENSION.test(base)) return `sensitive file: ${base}`;
	if (SENSITIVE_LOCK.test(base)) return `lockfile is write-protected: ${base}`;
	if (SENSITIVE_HISTORY.test(base)) return `shell history/profile is write-protected: ${base}`;
	if (base === "dump.sql" || base === "backup.sql" || base.endsWith(".dump")) {
		return `database dump is write-protected: ${base}`;
	}
	return null;
}
