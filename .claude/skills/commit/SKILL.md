---
name: commit
description: Write a commit message for the current tornintel changes in the repo's own style. Use whenever the user asks for a commit message, asks what to commit, or asks to commit, even in the middle of other work.
---

# Commit message

## Answer right away

If other work is in progress (a refactor, a failing check, a multi-step plan), pause it, write the message for the changes as they are now, then say what you were doing and continue. Never defer the request to the end of the task, and never drop it.

## 1. Collect the changes

1. `git diff --staged --stat` and `git diff --staged`. If something is staged, describe only that.
2. Otherwise `git diff --stat`, `git diff` and `git status --short` (read untracked `??` files too).
3. The working copy is CRLF with autocrlf. When a file looks fully rewritten, compare with `git diff --ignore-cr-at-eol --stat` and `git diff -w --stat`. Leave out files whose only changes are line endings or whitespace, and mention them separately (they are usually noise to revert, not to commit).
4. `src/routeTree.gen.ts` and `package-lock.json` changes are often side effects of the dev server or a build. Mention them only when routes or dependencies really changed.

## 2. Match the repo style

Run `git log --oneline -15`. Recent subjects look like:

- `Moved shared types and DTOs into src/models`
- `Added shared search, filters, sorting and pagination to tables`

Rules:

- Subject: past tense, capitalized, no period, no `feat:`/`fix:` prefix, at most 72 characters. Name the feature or page (levelling list, war hospital, payouts, war deals), not the file.
- Blank line, then 2 to 6 short `- ` bullets: what changed and why. Call out permission changes, new env vars, new tables or migrations, and changed API responses (DTOs in `src/models/`).
- No bullets for trivia (formatting, renamed locals) unless that is the whole change.

## 3. Split unrelated changes

If the diff mixes unrelated work (for example a levelling fix plus a CSS tweak on payouts plus a migration), propose separate commits. For each: the subject, the bullets and the exact files (`git add <paths>`). Keep a migration in `drizzle/` with the `src/db/schema.ts` change that produced it, and a test with the code it covers.

## 4. Output

Put each message in its own fenced code block so it can be copied as is.

Only run `git commit` when the user explicitly asked to commit, not just for a message. In that case:

- Stage only the files that belong to that message.
- End the message with the Co-Authored-By trailer the session provides, after a blank line.
- Pass the message with a here-string or `-F <file>` in the scratchpad, never with `--no-verify`.
- Do not push.
