import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

export interface AgentDef {
	name: string;
	description: string;
	tools: string;
	model: string;
	systemPrompt: string;
	file: string;
}

let cachedAgents: Map<string, AgentDef> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

export function parseAgentFile(filePath: string): AgentDef | null {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;

		const frontmatter: Record<string, string> = {};
		for (const line of match[1].split("\n")) {
			const idx = line.indexOf(":");
			if (idx > 0) {
				frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
			}
		}

		if (!frontmatter.name) return null;

		return {
			name: frontmatter.name,
			description: frontmatter.description || "",
			tools: frontmatter.tools || "read,grep,find,ls",
			model: frontmatter.model || "openrouter/google/gemini-3-flash-preview",
			systemPrompt: match[2].trim(),
			file: filePath,
		};
	} catch {
		return null;
	}
}

export function loadAllAgents(): Map<string, AgentDef> {
	const now = Date.now();
	if (cachedAgents && now - cacheTime < CACHE_TTL) {
		return cachedAgents;
	}

	const agentsDir = path.join(homedir(), ".pi", "agents");
	const agents = new Map<string, AgentDef>();

	if (!fs.existsSync(agentsDir)) return agents;

	try {
		for (const file of fs.readdirSync(agentsDir)) {
			if (!file.endsWith(".md")) continue;
			const fullPath = path.join(agentsDir, file);
			const def = parseAgentFile(fullPath);
			if (def) {
				agents.set(def.name.toLowerCase(), def);
			}
		}
	} catch {}

	cachedAgents = agents;
	cacheTime = now;
	return agents;
}

export function loadAgent(agentName: string): AgentDef | null {
	const agents = loadAllAgents();
	return agents.get(agentName.toLowerCase()) || null;
}

export function clearAgentCache(): void {
	cachedAgents = null;
	cacheTime = 0;
}
