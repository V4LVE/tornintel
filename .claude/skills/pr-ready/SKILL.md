---
name: pr-ready
description: Get the current tornintel branch ready for a pull request in one pass - run the checks, audit authorization on mutating API routes, check docs and draft the PR description (plus a commit message for uncommitted work). Use when the user asks for a PR description, asks if the branch is ready, or wants to open or prepare a PR.
---

# PR ready

Do every step, then report once. Never push, commit or open the PR unless the user explicitly asks.

## 1. Scope

- Base is `main`. Run `git diff main...HEAD --stat`, `git log --oneline main..HEAD`, `git status --short` and `git diff --stat`.
- The PR covers branch commits plus uncommitted changes. Ignore line-ending-only files (`git diff --ignore-cr-at-eol --stat`).

## 2. Checks (from AGENTS.md)

Run `npm test`, `npx tsc --noEmit`, `npm run lint` and `npx prettier --check --end-of-line auto <changed files>`.

- Known noise: 10 drizzle-orm errors from tsc and 2 eslint errors in `src/lib/travel.integration.test.ts`. Report only failures beyond that, with file and line.
- Prettier: check and fix only files changed on the branch (`git diff --name-only main...HEAD` plus uncommitted ones, `.ts/.tsx/.css/.md` that still exist). Never run `npm run format` or `prettier --write .`.
- Do not start a dev server; the user usually runs one on port 3000.

## 3. Authorization audit

For every changed file under `src/routes/api/` with a POST, PUT, PATCH or DELETE handler, and every changed `.server.ts` that writes to a table (`.insert(`, `.update(`, `.delete(`, `repository.save`):

- List each mutation and who may do it: anyone with a key, the owner of the record, or a trusted editor (`isLevellingEditor`-style check from env config).
- Flag as blocking any change to data shared between users (`levelling_list_changes`, `shared_fair_fight_observations`, `faction_member_travel`, any new table) that is gated only by identity (a valid key) without a permission check. Undoing an editor's action counts as a mutation too (see the restore check in `levelling-list.ts`).
- The actor's identity and stored player data must come from Torn, never from the request body.
- Error codes: 401 missing key, 400 validation, 403 not allowed, 404/409 lookups, 502 Torn/FF Scouter failures, 503 without `DATABASE_URL`. Errors are `Response.json({ error: 'Full sentence.' })` with `Cache-Control: no-store`.
- Tests: each permission rule needs a test that asserts 403 for an unauthorized caller (pattern: `src/lib/levelling/levelling-list.test.ts`). Name missing tests.
- Keys: no API key in logs (`console.*`), the database, cache keys or URLs other than the Torn/FF Scouter call itself.

## 4. Docs

If routes, env vars (`.env.example`), tables or migrations, localStorage keys, pages or flows changed, check `README.md` and `AGENTS.md` describe them. Report what is out of date; edit only if the user asks.

## 5. Report

1. Check results and blocking issues first.
2. The PR description in one fenced block:

```markdown
## Summary

<1-3 sentences: what and why>

## Changes

- <grouped by feature/page>

## Testing done

- npm test: <pass/fail, counts>
- tsc / lint / prettier: <result, noting known noise>
- <manual checks, if any>

## Security / permissions

- `<METHOD> /api/<route>` <action>: <who may do it, how it is checked, test>
- <or "No mutating routes changed.">
```

End it with the PR attribution line the session provides, if any.

3. If there are uncommitted changes, a commit message in the `commit` skill style: past tense, capitalized subject without prefix, at most 72 characters, blank line, short bullets.
