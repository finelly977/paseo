# AGENTS.md — Fork working copy

This checkout is a **downstream fork** of [getpaseo/paseo](https://github.com/getpaseo/paseo), not a clean upstream tree.

- **Fork (product line):** [finelly977/paseo](https://github.com/finelly977/paseo) — `origin`
- **Upstream (author):** [getpaseo/paseo](https://github.com/getpaseo/paseo) — `upstream` (fetch only; push is disabled)

The owner uses this repo for **second-party development (二开)** and for **selectively merging useful upstream updates**. Private product changes live on the fork; upstream is a source of optional improvements, not the default push target.

Product architecture, package map, coding rules, and critical operational constraints still live in [CLAUDE.md](CLAUDE.md) and `docs/`. Follow those for day-to-day implementation work. This file only covers **fork identity and upstream sync policy**.

## Remotes (expected)

| Remote     | URL                                       | Role                                 |
| ---------- | ----------------------------------------- | ------------------------------------ |
| `origin`   | `https://github.com/finelly977/paseo.git` | Default push/pull for all local work |
| `upstream` | `https://github.com/getpaseo/paseo.git`   | Read-only source of author releases  |

Do not re-point `origin` at the author repo. Do not push to `upstream`.

## Upstream sync policy (critical)

When the user asks to **check, review, sync, merge, or pull the author's latest** (e.g. “合作者最新版”, “同步上游”, “看最新更新”, “merge upstream”):

1. **Default scope = latest published release only**
   - Use the newest **GitHub Release / git tag** on upstream, including **pre-releases and beta** tags (e.g. `v0.2.0-beta.3`).
   - Prefer `gh release list --repo getpaseo/paseo` and/or `git fetch upstream --tags`, then resolve the latest published tag (stable or beta, whichever is newest by release time unless the user specifies stable-only).
   - Diff / merge / cherry-pick against that **tag** (or the commit the release points at), not against floating branch tips.

2. **Do not use unpublished WIP unless explicitly requested**
   - Do **not** treat `upstream/main`, open PR branches, or untagged HEAD as “latest” by default.
   - Half-finished, unreleased author work is out of scope for routine sync.
   - Only use unreleased `upstream/main` (or a named branch/PR) when the user **clearly** asks for it — e.g. names `main`, “未发布”, “HEAD”, a branch name, or a PR number.

3. **Merge is selective**
   - Bring over changes that are useful and compatible with local 二开.
   - Do not blindly overwrite fork-specific behavior (tab close layout-only, import-session UX, local packaging, etc.) without calling that out.
   - Prefer small, reviewable merges or cherry-picks over a giant dump of author history.

4. **After syncing**
   - Keep `origin` as the fork; push results to `origin` only.
   - Report which **release tag** was used, what landed, and what was skipped (and why).

### Quick commands (published release default)

```bash
git fetch upstream --tags
gh release list --repo getpaseo/paseo --limit 10
# resolve newest published tag (incl. beta), then e.g.:
git log --oneline HEAD..vX.Y.Z
git merge vX.Y.Z
# or cherry-pick specific commits after reviewing the tag range
git push origin HEAD
```

### Explicit unreleased sync (only if user asks)

```bash
git fetch upstream
git log --oneline HEAD..upstream/main
# merge/cherry-pick only after user opted into unreleased main
```

## Day-to-day development

- Default branch for local product work: `main` tracking `origin/main`.
- Feature work: short-lived branches on the fork (`feat/…`, `fix/…`), PR or merge into fork `main`.
- Upstream contribution (optional): branch from a published upstream tag or from `upstream/main` only for a clean PR back to the author; do not mix private 二开 into those PRs.

## What this is not

- Not a replacement for [CLAUDE.md](CLAUDE.md) product rules.
- Not permission to publish to npm/GitHub releases of the upstream project.
- Not a mandate to track author `main` continuously.
