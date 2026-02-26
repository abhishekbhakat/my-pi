---
name: commit-message
description: Generate a concise one-liner commit message by analyzing staged changes and recent git history. Use when the user wants a commit message suggestion before committing.
user-invocable: true
disable-model-invocation: false
---

# Commit Message Generator

## Overview

Generate a concise, meaningful one-liner commit message by inspecting the staged diff and recent commit history. Sometimes staged files relate to a prior commit, so the previous commit is also reviewed for context.

## Workflow

### Step 1: Gather Context

Run these commands to collect the necessary information:

```bash
# Get the last commit message and diff for context
git log -1 --format="%h %s" && echo "---" && git diff HEAD~1 --stat

# Get the staged diff (what will be committed)
git diff --staged
```

### Step 2: Analyze the Changes

- Read the staged diff to understand **what** changed.
- Read the last commit (`git log -1`) to understand if the staged changes are a continuation, fix, or follow-up to the previous commit.
- If staged files overlap with files in the last commit, treat the changes as related and reflect that in the message.

### Step 3: Generate the Message

Compose a **single-line** commit message following these rules:

- **Format:** `<type>: <concise description>`
- **Types:** `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`, `ci`, `build`
- **Length:** Under 72 characters
- **Tone:** Imperative mood ("add", "fix", "update", not "added", "fixed", "updated")
- **No period** at the end

### Step 4: Output

Print only the suggested commit message — nothing else. No explanation, no alternatives.

## Examples

```
feat: add retry logic to API client
fix: correct off-by-one error in pagination
refactor: extract auth middleware into separate module
docs: update README with new installation steps
chore: bump dependencies to latest versions
```

## Tips

- If the staged diff is empty, inform the user: "No staged changes found. Stage files with `git add` first."
- If the staged changes clearly extend the previous commit (same files, same feature), phrase the message as a continuation rather than a new change.
- Keep it specific — avoid vague messages like "update code" or "fix stuff".
