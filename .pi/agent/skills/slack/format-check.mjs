/**
 * Readability gate for outgoing Slack messages. Two layers:
 * 1. Deterministic lint for formatting bugs that never render right.
 * 2. Decider model (deciders.json role "guard") judges line breaks,
 *    Slack mrkdwn usage, and ADHD-friendly structure.
 * A message passes only when every lint rule and every decider question pass.
 * Decider outage fails open with a warning so Slack stays usable.
 */
const { askDeciders } = await import(
  new URL("../../extensions/shared/deciders/index.ts", import.meta.url).href
);

const ROLE = "guard";
const TIMEOUT_MS = 15_000;
const PASS_THRESHOLD = 0.5;
const MAX_STATE_CHARS = 6_000;

const RULES = [
  "Slack mrkdwn: bold *text*, italic _text_, strike ~text~, inline `code`,",
  "code blocks in triple backticks with optional language, quote > text,",
  "links <url|label> or <url>, bullets - or •, sub-bullets ◦, numbered 1.",
  "Native tables use | header | rows with a | --- | separator line.",
  "Markdown # headings and ![alt](url) images do not render in Slack.",
].join(" ");

const QUESTIONS = {
  line_breaks_ok: {
    type: "noul",
    instructions: [
      "Does `message` use line breaks well for a Slack reader?",
      "Separate ideas, list items, table rows, and code blocks sit on their own lines.",
      "Blank lines split distinct sections. No paragraph runs past about four sentences.",
      "A short single-point message on one line passes; structure is only needed for multiple points.",
    ].join(" "),
    criteria: {
      true: "Line breaks separate each idea, list item, and block; no wall of text; short one-point messages also pass.",
      false: "Multiple points are crammed into one paragraph, list items run together on one line, or a long block has no breaks.",
    },
  },
  markdown_ok: {
    type: "noul",
    instructions: [
      "Does `message` use Slack formatting from `formatting_rules` correctly and consistently?",
      "Check for unclosed or mismatched markers, lists without a marker per item, commands or",
      "multi-line values outside code blocks, and syntax Slack will not render.",
      "Plain text with no formatting passes when it is short and needs none.",
    ].join(" "),
    criteria: {
      true: "Formatting follows formatting_rules, markers are balanced, code and commands are in code formatting, or no formatting is needed.",
      false: "Formatting is broken, inconsistent, unsupported by Slack, or missing where lists, code, or emphasis clearly need it.",
    },
  },
  adhd_readable: {
    type: "noul",
    instructions: [
      "Can a reader with ADHD act on `message` quickly?",
      "The main point or ask comes first. Chunks are short. Lists hold one fact per item.",
      "Key terms or the ask are easy to spot. No filler preamble or long run-on sentences.",
    ].join(" "),
    criteria: {
      true: "Point first, short scannable chunks, clear ask or result, little filler.",
      false: "Point buried, dense or rambling text, unclear ask, or too much to scan before the key fact.",
    },
  },
};

const HINTS = {
  line_breaks_ok: "Put each idea, list item, and code block on its own line. Split long paragraphs.",
  markdown_ok: "Use Slack mrkdwn (*bold*, - bullets, ``` blocks). Close every marker.",
  adhd_readable: "Lead with the point or ask. Cut filler. Use short bullets, one fact each.",
};

/** Strip fenced code so lint rules skip code content. */
function prose(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}

export function lintMessage(text) {
  const problems = [];
  const fences = (text.match(/```/g) ?? []).length;
  if (fences % 2 !== 0) problems.push("Unclosed ``` code block.");
  const outside = fences % 2 === 0 ? prose(text) : text;
  if (/\\n/.test(outside)) {
    problems.push("Literal \\n found. Put real newlines inside one quoted shell argument.");
  }
  if (/^#{1,6}\s/m.test(outside)) {
    problems.push("Markdown # heading found. Slack does not render it; use a *bold* line.");
  }
  if (/!\[[^\]]*\]\([^)]*\)/.test(outside)) {
    problems.push("Markdown image ![alt](url) found. Slack does not render it; send the URL.");
  }
  return problems;
}

function noulScore(answer) {
  if (!answer || typeof answer !== "object") return undefined;
  const value = answer.noul ?? answer.probability;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Returns { ok: true } or { ok: false, problems: string[] }.
 * Adds { warning } when the decider could not run and the check failed open.
 */
export async function checkMessage(text, options = {}) {
  const problems = lintMessage(text);
  if (problems.length) return { ok: false, problems };

  const state = {
    platform: "Slack",
    formatting_rules: RULES,
    message: text.slice(0, MAX_STATE_CHARS),
  };
  let result;
  try {
    result = await askDeciders(ROLE, state, QUESTIONS, { timeoutMs: TIMEOUT_MS, fetcher: options.fetcher });
  } catch (error) {
    return { ok: true, warning: `format check skipped: ${error?.message ?? "decider error"}` };
  }
  if (!result.ok) return { ok: true, warning: `format check skipped: ${result.message}` };

  const failed = [];
  for (const id of Object.keys(QUESTIONS)) {
    const score = noulScore(result.answers?.[id]);
    if (score === undefined) {
      return { ok: true, warning: `format check skipped: ${result.model} gave no answer for ${id}` };
    }
    if (score < PASS_THRESHOLD) failed.push(`${id} (${score.toFixed(2)}): ${HINTS[id]}`);
  }
  if (failed.length) return { ok: false, problems: failed, model: result.model };
  return { ok: true, model: result.model };
}
