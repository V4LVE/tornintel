---
name: merge-main
description: Bring the current tornintel feature branch up to date by merging the newest origin/main (or another named branch) into it, resolve every conflict by intent, verify and commit the merge. Use when the user asks to "merge main", "get the newest from main", "update the branch", "fix the merge" or "resolve merge conflicts".
user-invocable: true
disable-model-invocation: true
---

Merge the newest source branch into the current feature branch, resolve conflicts, verify, and finish with a merge commit. The PR into `main` then shows only the branch's own work, and conflicts are resolved here instead of in the GitHub UI.

Arguments (optional): `$ARGUMENTS` is the branch to merge IN. Default: `origin/main`. For stacked branches (for example `chore/insights-improvements` on top of `feature-pagnation-filter`), pass the parent branch, e.g. `origin/feature-pagnation-filter`. Below, `<SOURCE>` is that branch and `<BRANCH>` is the current branch.

## How to run this

The user runs `/merge-main` once and expects it done end to end: fetch, merge, resolve, verify, commit. Do not stop between steps. Only ask when something is genuinely ambiguous (a semantic conflict where either choice loses real behaviour) or when work could be lost (Step 0). Report at the end.

If this session runs in a worktree the Claude desktop app created, use the `sync_with_base_branch` tool for the fetch and merge instead of `git merge`, then continue with Step 3 for any conflicts it reports.

## Environment

The shells are PowerShell 5.1 (primary) and Git Bash. In PowerShell: no `&&`/`||`, capture output in variables (`$mb = git merge-base HEAD <SOURCE>`), do not redirect a native exe's stderr (`2>&1` flips `$?` even on success); read `$LASTEXITCODE` instead. Use the Grep and Glob tools for searching, not shell pipelines.

## The mindset that matters most

A conflict is not "left or right". It is two independent edits to the same region; reconstruct the code as if both authors had edited one after the other. Picking a side is only correct when one side genuinely supersedes the other. Read both sides' intent (diff against the merge base) before editing. A wrong resolution is expensive and hard to spot later.

During `git merge <SOURCE>`: **ours** = `<BRANCH>` (the feature work), **theirs** = `<SOURCE>` (usually main).

---

## Step 0 - Safe starting point

```powershell
git fetch origin
git branch --show-current
git status --short
```

- **On `main`: stop.** Never merge into `main` locally; pushing `main` deploys to production through Coolify. Ask which feature branch to use.
- **Dirty working tree: stop** and list what is uncommitted. Ask whether to commit it first (preferred) or stash it. Never `git stash` while `npm run dev` runs: it regenerates `src/routeTree.gen.ts` and blocks `git stash pop` (recover with `git checkout -- src/routeTree.gen.ts`, then pop again).
- **Local vs. its own remote:** `git rev-list --left-right --count HEAD...origin/<BRANCH>` (skip if the branch was never pushed).
  - `0 N`: behind only, fast-forward first with `git merge --ff-only origin/<BRANCH>`.
  - `N 0` or `0 0`: fine.
  - `N M`: diverged from its own remote. Stop and ask; someone else pushed to the branch.

Never delete, reset or force-recreate the user's feature branch: it may hold unpushed commits.

## Step 1 - Direction check

```powershell
git rev-list --left-right --count HEAD...<SOURCE>
```

Right side 0 means nothing new to merge: say so and stop. Left side 0 means the branch has no own work (a fast-forward will happen), so confirm that is expected.

## Step 2 - Start the merge

```powershell
git merge <SOURCE> --no-edit
git status --short
git diff --name-only --diff-filter=U
```

No conflicts: go to Step 6 anyway (a clean merge can still break). Prefixes: `UU` both modified, `AA` both added, `UD`/`DU` modify/delete (the dangerous ones, Step 5).

## Step 3 - Understand each conflict before editing

```powershell
$mb = git merge-base HEAD <SOURCE>
git diff --stat $mb HEAD     -- <file>   # what the feature branch changed
git diff --stat $mb <SOURCE> -- <file>   # what the source changed
```

The size asymmetry decides the strategy:

- **Both small / non-overlapping:** hand-merge, keep both edits.
- **One tiny, one large restructure:** start from the large version (`git checkout --ours|--theirs -- <file>`), then re-apply the tiny change by hand.
- **Both large:** read both full diffs and rebuild section by section.

Read the real diff before deciding, then resolve with Read and Edit.

## Step 4 - Content conflicts, with tornintel's recurring cases

General shapes:

- **Member added on one side only** (import, function, type field, list entry): keep it.
- **Both sides added distinct members:** keep all of them; fix commas and keep import groups sorted.
- **Same line edited differently:** take the forward intent; check `git log -1 <sha> -- <file>` if unsure.
- **One side reformatted, the other changed behaviour:** keep the reformat, re-apply the behaviour change.

Files with their own rules:

- **`src/routeTree.gen.ts`** - never hand-merge or hand-edit. Take either side (`git checkout --theirs -- src/routeTree.gen.ts`), resolve everything else, then regenerate with `npx vite build`. Never use `npx tsr generate` (it drops the `@tanstack/react-start` registration). If the user's dev server is running it may regenerate the file by itself.
- **`package-lock.json`** - never hand-merge. Hand-merge `package.json` first (union of dependencies; for the same package on both sides take the higher version), then `git checkout --theirs -- package-lock.json` and `npm install` so the lock file picks up the branch's dependencies.
- **`drizzle/` migrations** - if both sides generated a migration with the same number (`0004_*.sql`, `meta/0004_snapshot.json`, `meta/_journal.json`): the source's migration wins because it may already be deployed. Take the source's journal and snapshots, remove the branch's own conflicting `.sql` and snapshot, hand-merge `src/db/schema.ts`, then regenerate the branch's migration on top with `DATABASE_URL=postgres://u:p@localhost:5432/x npm run db:generate` (it does not connect). Never run `db:migrate` here, and tell the user their local database may have applied the old migration.
- **`src/models/*.ts`** - shared types; keep fields from both sides. If both changed the same DTO, both the API route (`satisfies`) and the page must still type-check against the merged shape.
- **`src/styles.css`** - a new color variable must exist in both `:root` and `:root[data-theme='light']`; never resolve to a raw hex in a rule.
- **`src/lib/levelling/players.json`** - a data snapshot. If both sides changed it, do not union by hand: ask which snapshot to keep.
- **`AGENTS.md` / `README.md`** - tables and lists are a union of both sides' rows.
- **API routes under `src/routes/api/`** - if one side added a permission check (`isLevellingEditor`, 401/403 branches), it must survive even if the other side restructured the handler.

After each file, grep it for `^(<<<<<<<|=======|>>>>>>>)`: nothing may remain.

## Step 5 - Modify/delete conflicts (`UD`/`DU`) - do not lose work

A file deleted on one side and changed on the other usually means the deleting side moved its content (this repo regularly moves code into feature folders and types into `src/models/`).

1. Find why: `git log --oneline --diff-filter=D <SOURCE> -- <file>` (or on `HEAD` if the branch deleted it), and grep for the file's exported symbols to see where they live now.
2. Find what the modifying side added (Step 3 diff).
3. Accept the deletion **and** move the surviving addition into the new home, following that file's conventions (`#/` imports, `import type`, types into `src/models/`). Then `git rm <file>`.

If the modification was itself only a move the deletion already covers, the deletion alone is correct, but verify it.

## Step 6 - Verify, then stage

Sweep the whole tree, not only touched files:

- Grep `src/` for leftover conflict markers.
- Grep for references to anything deleted or renamed, including old import paths (for example a type that moved to `src/models/`).
- Auto-merged files can still be broken: an import may point to a file that moved on the other side.

Always run the checks, even with zero conflicts. A signature change on one side meeting new callers on the other conflicts nowhere and still fails to compile.

```powershell
npm test
npx tsc --noEmit
npm run lint
npx prettier --check --end-of-line auto <files touched by the resolution>
npx vite build
```

- Known noise: the drizzle-orm errors from tsc and 2 eslint errors in `src/lib/travel/travel.integration.test.ts`. Anything else is the merge's fault and must be fixed before committing.
- Prettier only on files you resolved. Never `npm run format` or `prettier --write .`.
- After the build, check `git status`: keep a regenerated `src/routeTree.gen.ts` if routes changed; restore `package-lock.json` with `git checkout -- package-lock.json` unless dependencies changed on purpose.

Then stage:

```powershell
git add -- <each resolved file>
git rm -- <each accepted deletion>
git diff --name-only --diff-filter=U   # must print nothing
```

## Step 7 - Commit the merge

Finishing the merge is the deliverable, so commit it (a merge commit, never amend, never `--no-verify`). The body lists every conflict and how it was resolved. End it with the Co-Authored-By trailer the session provides.

```powershell
git commit -F <scratchpad>\merge-msg.txt
```

```
Merge <SOURCE> into <BRANCH>

Resolved N conflicts:
- <file>: <what was kept and why>
- <file>: union of both sides
- <file>: modify/delete - accepted deletion, moved <X> into <new home>
```

Confirm:

```powershell
git status --short
if (git rev-parse -q --verify MERGE_HEAD) { 'STILL MERGING' } else { 'MERGE COMPLETE' }
```

## Step 8 - Report

Give a short table (file, resolution, reasoning), the check results, and call out non-obvious decisions (moved content, migration renumbering, dependency versions). Offer to push and open or update the PR into `main` (see the `pr-ready` skill). Do not push unless the user asks.

## Abandoning

`git merge --abort` restores the pre-merge state. Use it if Step 1 looks wrong or you need to start over.
