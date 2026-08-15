---
name: upload-parity-experiments
description: Create or reuse Hugging Face dataset PRs for `harborframework/parity-experiments` and upload Harbor parity/oracle result folders efficient with sparse checkout, raw git pushes, and Git LFS.
---

# Upload Parity Experiments

Use this skill to publish Harbor parity experiment outputs to shared Hugging Face dataset and capture resulting discussion URL for adapter `parity_pr` field.

## Why This Skill Exist

- `hf upload-large-folder` can be slow or unreliable for large parity bundles because it push through Hub API commit loop.
- Normal git clone of `harborframework/parity-experiments` is too expensive because dataset is very large.
- Hugging Face dataset PR refs are different from GitHub PR refs and are easy to misuse.
- Files larger than 10 MiB must be Git LFS-tracked before push.

This skill avoid full clone by fetch only target PR ref with `--depth 1 --filter=blob:none` and check out only paths needed for current adapter.

## Prereqs

- Ensure Hugging Face authentication is available with discussion-write permission. Either classic `write` token or fine-grained token with global `discussion.write` enabled at <https://huggingface.co/settings/tokens>. Read-only or narrowly-scoped token will cause `create_pr.py` to fail with HTTP 403.
- Keep target dataset fixed to `harborframework/parity-experiments` unless user explicit ask for another repo.
- Accept any local upload source that already contain final files user want to publish.

## Preferred Workflow

1. Create or reuse dataset PR.
2. Prepare sparse local worktree for that PR ref.
3. Copy local parity results into sparse checkout.
4. Ensure every file larger than 10 MiB is Git LFS-tracked before commit.
5. Push direct to PR ref with raw `git push`.
6. Share discussion URL and record it as adapter `parity_pr`.

For large parity bundles, prefer raw git over `hf upload-large-folder`. Raw git path is material faster and more reliable because it avoid API-side commit loop and do not require clone entire parity dataset.

## 1. Create Or Reuse Dataset PR

If user already have parity PR number, reuse it.

Otherwise, create one with bundled helper:

```bash
uv run python scripts/create_pr.py create-pr \
  --title "Add parity experiments for <adapter_name>" \
  --description-file /path/to/pr-description.md
```

Script print JSON including:

- `pr_number`
- `discussion_url`
- `repo_id`

## 2. Prepare Sparse PR Checkout

```bash
mkdir -p /tmp/parity-experiments-pr<number>
cd /tmp/parity-experiments-pr<number>

git init
git remote add origin git@hf.co:datasets/harborframework/parity-experiments
git config core.sparseCheckout true
git sparse-checkout init --cone
git sparse-checkout set adapters/<adapter_name>

git fetch --depth 1 --filter=blob:none origin refs/pr/<number>:pr/<number>
git checkout pr/<number>
```

This fetch only PR ref and requested paths instead of clone full dataset repo.

## 3. Copy Local Results

If local folder already contain final repo-root layout, copy it as-is.

If local folder only contain adapter subtree, copy it into `adapters/<adapter_name>/`:

```bash
rsync -a --delete \
  --exclude '.git' \
  --exclude '.cache' \
  --exclude '.DS_Store' \
  /path/to/local-folder/ \
  adapters/<adapter_name>/
```

## 4. Ensure Large Files Use Git LFS

Repo-root `.gitattributes` already LFS-track common binary, model, archive, and media extensions (`*.bin`, `*.parquet`, `*.safetensors`, images, audio, video, `*.log`, `*.txt`, etc.). Most parity outputs are covered automatic and need no manual action. Scan sparse checkout for files larger than 10 MiB to catch anything that slip through:

```bash
python - <<'PY'
from pathlib import Path

for path in sorted(Path(".").rglob("*")):
    if path.is_file() and ".git" not in path.parts and path.stat().st_size > 10 * 1024 * 1024:
        print(path)
PY
```

If any file is flagged and is not already covered by root, write LFS rule to `adapters/<adapter_name>/.gitattributes` — never to repo-root `.gitattributes`, which is shared merge-conflict hotspot. Run `git lfs track` inside adapter directory so rule is written with relative pattern:

```bash
(cd adapters/<adapter_name> && git lfs track "<pattern>")
git add adapters/<adapter_name>/.gitattributes
```

Git LFS honor nested `.gitattributes` files, so rules added this way apply only to that adapter and never collide with other in-flight parity PRs.

## 5. Commit And Push

```bash
find . -name .DS_Store -delete
git add adapters/<adapter_name>
git commit -m "Add parity experiment artifacts for <adapter_name>"
GIT_SSH_COMMAND='ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10' \
  git push origin pr/<number>:refs/pr/<number>
```

## 6. Record Discussion URL

Use this discussion URL in `parity_experiment.json`:

```text
https://huggingface.co/datasets/harborframework/parity-experiments/discussions/<number>
```

## Monitoring And Retry

When raw `git push` is running, check live output first. Large pushes often spend long time in:

- `git-lfs pre-push`
- single-object LFS uploads
- packfile compression

Useful checks:

```bash
git ls-remote git@hf.co:datasets/harborframework/parity-experiments refs/pr/<number>
```

```bash
ps -p <pid> -o pid=,etime=,command=
```

If push exit early:

- rerun exact same `git push` command first
- if Hugging Face reject file larger than 10 MiB, add needed `git lfs track` rules, re-add file, and retry
- if connection broke mid-push, rerun same push command before change anything else

## Fallback

Use `hf upload-large-folder` only as fallback when raw git is unavailable or user explicit ask for it.

Create PR with bundled helper and upload to PR revision:

```bash
hf upload-large-folder harborframework/parity-experiments \
  <local-folder> \
  --repo-type dataset \
  --revision refs/pr/<pr-number> \
  --exclude ".DS_Store" \
  --exclude "**/.DS_Store" \
  --num-workers 8
```

## Guardrails

- Do not upload Harbor repo itself by accident. Upload only intended local results folder.
- Do not fall back to full clone of `harborframework/parity-experiments`.
- Do not modify repo-root `.gitattributes`. Put any adapter-specific LFS rules in `adapters/<adapter_name>/.gitattributes` instead.
- Always remove or exclude `.DS_Store`.
- Before push, make sure every file larger than 10 MiB is LFS-tracked.
- If user already have parity PR number, reuse it instead of create another one.
