import { SetupAbort } from "../errors.mjs";

export function isInteractive(input = process.stdin, output = process.stdout) {
  return Boolean(input && input.isTTY && output && output.isTTY);
}

export function parseYesNo(answer) {
  const value = String(answer ?? "").trim();
  return value === "y" || value === "Y" || value === "yes";
}

export function parsePick(answer, count, defaultIndex) {
  const value = String(answer ?? "").trim();
  if (value === "") return defaultIndex;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < 1 || n > count) return null;
  return n - 1;
}

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let buffer = "";
  let mode = "idle"; // idle | line | secret
  let resolveWait = null;
  let rejectWait = null;
  let secretChars = [];
  let closed = false;
  let wasRaw = false;

  function write(text) {
    if (output && typeof output.write === "function") output.write(text);
  }

  function setRaw(enabled) {
    if (typeof input.setRawMode === "function") {
      try {
        input.setRawMode(enabled);
      } catch {
        // ignore streams that advertise setRawMode but reject it
      }
    }
  }

  function finishWait(ok, value) {
    const res = resolveWait;
    const rej = rejectWait;
    resolveWait = null;
    rejectWait = null;
    mode = "idle";
    if (ok) res?.(value);
    else rej?.(value);
  }

  function takeLine() {
    const nl = buffer.search(/\r\n|\n|\r/);
    if (nl < 0) return null;
    const match = buffer.slice(nl).match(/^\r\n|\n|\r/)?.[0] ?? "\n";
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + match.length);
    return line;
  }

  function onData(chunk) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (mode === "line") {
      buffer += text;
      const line = takeLine();
      if (line !== null) finishWait(true, line);
      return;
    }
    if (mode !== "secret") {
      buffer += text;
      return;
    }
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      if (ch === "\r" || ch === "\n") {
        let rest = i + 1;
        if (ch === "\r" && text[rest] === "\n") rest += 1;
        const leftover = text.slice(rest);
        if (leftover) buffer = leftover + buffer;
        write("\r\n");
        const value = secretChars.join("");
        secretChars = [];
        setRaw(false);
        finishWait(true, value.trim());
        return;
      }
      if (ch === "\u0003") {
        secretChars = [];
        setRaw(false);
        write("\r\n");
        finishWait(false, new SetupAbort("cancelled", 130));
        return;
      }
      if (ch === "\u007f" || ch === "\b") {
        secretChars.pop();
        continue;
      }
      if (ch === "\u001b") {
        // drop CSI / short escape sequences
        i += 1;
        while (i < text.length) {
          const c = text[i];
          if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "~") break;
          i += 1;
        }
        continue;
      }
      if (code < 0x20) continue;
      secretChars.push(ch);
    }
  }

  function onEnd() {
    if (mode === "idle") return;
    setRaw(false);
    finishWait(false, new SetupAbort("input closed"));
  }

  input.on("data", onData);
  input.on("end", onEnd);
  input.on("error", onEnd);
  if (typeof input.resume === "function") input.resume();

  function waitLine(promptText) {
    if (closed) return Promise.reject(new SetupAbort("prompter closed"));
    write(promptText);
    return new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
      mode = "line";
      const line = takeLine();
      if (line !== null) finishWait(true, line);
    });
  }

  async function askYesNo(question) {
    const answer = await waitLine(`${question} [y/N] `);
    return parseYesNo(answer);
  }

  async function askSecret(label) {
    if (closed) throw new SetupAbort("prompter closed");
    wasRaw = Boolean(input.isRaw);
    setRaw(true);
    write(`${label}`);
    secretChars = [];
    try {
      return await new Promise((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
        mode = "secret";
        if (buffer) {
          const pending = buffer;
          buffer = "";
          onData(pending);
        }
      });
    } finally {
      setRaw(wasRaw);
    }
  }

  async function askPick(label, choices, defaultIndex = 0, options = {}) {
    const count = choices.length;
    if (!count) throw new SetupAbort("askPick needs at least one choice");
    const def = Math.min(Math.max(defaultIndex, 0), count - 1);
    const printChoices = options.printChoices !== false;
    write(`${label}\n`);
    if (printChoices) {
      choices.forEach((choice, i) => {
        write(`  ${i + 1}) ${choice}\n`);
      });
    }
    for (;;) {
      const answer = await waitLine(`Pick 1-${count} [default ${def + 1}]: `);
      const picked = parsePick(answer, count, def);
      if (picked !== null) return picked;
      write(`Invalid pick. Enter 1-${count}.\n`);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    setRaw(false);
    input.off?.("data", onData);
    input.off?.("end", onEnd);
    input.off?.("error", onEnd);
    if (typeof input.removeListener === "function") {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onEnd);
    }
    if (typeof input.pause === "function") input.pause();
    if (mode !== "idle") finishWait(false, new SetupAbort("prompter closed"));
  }

  return { askYesNo, askSecret, askPick, close };
}
