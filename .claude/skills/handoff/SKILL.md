---
name: handoff
description: Compact the current tornintel conversation into a handoff document that a fresh session can pick up from.
argument-hint: What will the next session be used for?
user-invocable: true
disable-model-invocation: true
---

Imagine your memory is about to be erased. Write the document you would want to read afterwards to carry on exactly where this conversation stopped: what we are doing, why, what is done, what is left and what to watch out for.

If `$ARGUMENTS` is given, it describes what the next session will focus on. Tailor the document to that: lead with what that work needs and cut what it does not.

## 1. Collect the facts first

Do not write from memory alone. Run:

```powershell
git branch --show-current
git status --short
git log --oneline -10
git log --oneline main..HEAD
git diff --stat
```

Also note, if they apply:

- Background agents or tasks still running, and what each was asked to do. A fresh session cannot see them, so say what to check when they finish.
- Whether the user's dev server is running on port 3000 (AGENTS.md: use it instead of starting another).
- The last results of `npm test`, `npx tsc --noEmit`, `npm run lint` and the prettier check. Tsc and lint are clean on a fresh install, so every error counts; `TS7016` for `drizzle-orm` means a broken local install (see AGENTS.md), not a code problem. Only report what you actually ran, and say when it was run.

## 2. Reference, do not copy

Do not repeat what already lives somewhere else. Point to it by path, URL or commit hash:

- AGENTS.md (conventions, architecture, pitfalls): never summarise it, the next session loads it anyway. Mention only rules that were changed or learned in this conversation.
- Commits, diffs, PRs (`https://github.com/V4LVE/tornintel/pull/<n>`), migrations in `drizzle/`, plans and reports: link them.
- Code: reference as `path:line`, not pasted blocks. Only quote a snippet when it is not in any file yet (an idea or a rejected approach).

## 3. Write the document

Save it outside the workspace, in the OS temp directory, so it is never committed:

```powershell
$dir = Join-Path $env:TEMP 'tornintel-handoff'
New-Item -ItemType Directory -Force $dir | Out-Null
# File name: <branch with / replaced by ->-<yyyy-MM-dd-HHmm>.md
```

Use these sections. Leave out a section that has nothing in it, and keep the whole document short enough to read in two minutes.

```markdown
# Handoff: <short title> (<date>)

## Goal

What the user wants and why, in their words where possible. The next session's focus (from the arguments), if given.

## State

- Branch `<branch>` (from `<base>`), committed / uncommitted, pushed or not.
- Done: <bullets with paths or commits>.
- In progress: <exactly where it stopped, the next concrete step>.
- Checks: <last results, and the CI checks on the PR if there is one>.

## Decisions and why

Choices made in this conversation that are not obvious from the code, including rejected options and the reason.

## Open questions and risks

Things waiting on the user, unverified assumptions, anything that could break (migrations not run, a dev database state, a running agent).

## Next steps

Numbered, concrete, in order. The first one should be doable without asking anything.

## Suggested skills

- Repo skills that fit the next steps: `/commit`, `/pr-ready`, `/merge-main` (see `.claude/skills/`).
- TanStack skills: run `npx @tanstack/intent@latest list` and name the ones that match the work (AGENTS.md, Skill Loading).
- Any other available skill that fits, such as `/code-review` or `/security-review` before a PR.

## Start prompt

One paragraph the user can paste into the new session: read this file, then continue with step 1.
```

## 4. Redact

The document must not contain secrets or personal data:

- No Torn API keys, FF Scouter keys, `BETTER_AUTH_SECRET`, `DATABASE_URL` values or anything else from `.env`. Name the variable, never its value.
- No email addresses or real names of people. Torn player and faction IDs are fine when the work needs them (for example a test player), but not lists of players gathered from the API.
- No localStorage contents beyond key names (`tornintel.apiKey`, ...).

Check the finished file for anything that looks like a key (long random strings) before reporting.

## 5. Report

Give the full path of the file and the start prompt in a code block, so the user can paste it into the next session. Do not commit anything.
