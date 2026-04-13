export interface CapabilityDef {
	name: string;
	toolName: string;
	label: string;
	description: string;
	model: string;
	systemPrompt: string;
	file: string;
	promptSnippet?: string;
	promptGuidelines: string[];
	includeConversation: boolean;
	includeTree: boolean;
	includeGitStatus: boolean;
	includeGitDiff: boolean;
	includeChangedFiles: boolean;
	maxConversationChars: number;
	maxTreeChars: number;
	maxGitDiffChars: number;
	maxFiles: number;
	maxFileChars: number;
	reasoningEffort?: string;
}

export interface CapabilityToolInput {
	task: string;
	paths?: string[];
	includeConversation?: boolean;
	includeTree?: boolean;
	includeDiff?: boolean;
}

export interface CapabilityContextSection {
	title: string;
	content: string;
}

export interface CapabilityContextBundle {
	sections: CapabilityContextSection[];
	autoPaths: string[];
}
