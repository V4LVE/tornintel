# Deep mode - size-proportional agent review

Loaded only when `--deep` is given or the PR is above the Inline tier. Standard mode never needs it: an Inline PR gets zero agents no matter what it touches.

Referenced from `SKILL.md` Step 3D. Replaces Steps 3 and 4.

---

> You have the PR metadata, linked issues, the file list and `--shortstat` from Steps 1-2. The reading is **split**: agents take the three correctness dimensions, and you read the diff yourself for the other six, because `diff-reviewer` refuses style, naming and convention findings by contract and cannot report a missing test at all. 3D.1 says which half is which.

**Agents are predefined** in `.claude/agents/` (brief, output shape and tools live there), so spawn prompts stay short:

- Dimension agents: `subagent_type: diff-reviewer`
- Edge-case enumeration: `subagent_type: edge-case-explorer`

Both are read-only and neither decides anything.

**If the agent type is not found** (agents in `.claude/agents/` are loaded when a session starts, so ones added or changed during the session are missing), spawn `general-purpose` instead and start its prompt with: _"First read `.claude/agents/<name>.md` and act exactly as that agent: read-only, its scope, its output format."_ Then add the usual brief. Mention the fallback in the review's deep-review line.

- `diff-reviewer` reports **only** correctness defects, requirement gaps and regressions, each with a named failing input or state and the wrong result. It returns a numbered list and a one-line verdict. It runs its own read-only git, so give it the **base and head refs**.
- `edge-case-explorer` returns **ranked candidates** with paired assertions (one that holds if the behaviour is intended, one if not) for a **human** to rule on. It has no shell: name the paths and hand it the diff file.

---

## 3D.0 - Produce the diff once, for yourself

```powershell
git diff origin/<base>...origin/pr/<n> > <scratchpad>\pr-<n>.diff
```

Scratchpad, never the repo. `diff-reviewer` does not need this file; it diffs the refs itself, which keeps its half out of your context.

---

## 3D.1 - The review lenses

Lenses, not agents. Every applicable lens is applied; 3D.2 decides how many agents carry them. Drop a lens when its skip condition holds.

| Dimension                             | Brief (rows marked _(yours)_ are the orchestrator's; the rest are agent briefs)                                                                                                                                                                                                                                                                                                                                             | Skip when                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Regression / blast radius**         | Lens A or B from Step 3 for the PR type. Every existing path touched: new guards and early returns, changed behaviour, changed DTOs in `src/models/` and every page that reads them, shared helpers in `src/lib`, `table-view` and `components/`. **Always spawn this one.**                                                                                                                                                | never                                                |
| **Authorization and data integrity**  | Every write to shared data (`levelling_list_changes`, `shared_fair_fight_observations`, `faction_member_travel`, any new table), including writes reached from GET routes through `.server.ts`: is it gated by permission and not just a valid key, is the actor taken from Torn rather than the request body, can a user undo or overwrite another user's change, do the 401/403 paths fire for exactly the right callers. | no API routes, `.server.ts` writes or schema touched |
| **Storage, caches and external APIs** | Behaviour without `DATABASE_URL` (fallback, `warning`, 503 on writes); migrations against existing rows; `fetchTorn` cache keys and `cacheWhen`; FF Scouter's per-IP limits shared by all users and Torn's per-key limit (calls per load and per poll); Torn error codes (key errors 2/10/13/18 must surface, code 6 must not abort a search); keys never logged, stored or used in cache keys.                             | no server code, db or external calls touched         |
| **Architecture and placement**        | _(yours)_ `.server.ts` split and client `import type` only; types in `src/models/`; feature folders and API `(group)` folders; route files export only `Route`; `type` not `interface`; `#/` imports; no hand-edited `routeTree.gen.ts`.                                                                                                                                                                                    | never                                                |
| **Test coverage**                     | _(yours)_ Complex logic (TBS estimation, Fair Fight bounds, payouts, war deals, travel windows, permissions) has `node:test` tests; mocks and env vars restored in `finally`; distinct keys per test. **Missing tests on complex logic = Critical**, raised by you.                                                                                                                                                         | never                                                |
| **Code quality**                      | _(yours)_ Commented-out code, unused exports and locals, comments that do not explain why, logging format, client fetch and `AbortController` discipline.                                                                                                                                                                                                                                                                   | never                                                |
| **Suppressions**                      | _(yours)_ Scan **added** lines for `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `prettier-ignore`. One finding per new suppression (Suggestion; Gap if file-wide), citing the rule and the justification or its absence.                                                                                                                                                                             | no suppression tokens in added lines                 |
| **UI / UX**                           | _(yours)_ Screenshots in both themes; page-prefixed CSS; colors as variables in both theme blocks; breakpoints; shared table components; `NAV_SECTIONS` and `PageHeading` for new pages; English text.                                                                                                                                                                                                                      | no pages, components or CSS touched                  |
| **Docs**                              | _(yours)_ README and AGENTS.md cover changed routes, env vars, tables, localStorage keys and flows.                                                                                                                                                                                                                                                                                                                         | none of those changed                                |

## 3D.2 - Split the work

- **Spawn `diff-reviewer`** for the three correctness dimensions: Regression / blast radius (always), Authorization and data integrity, Storage, caches and external APIs. With `K` below 3, merge dimensions into fewer agents (K = 1: one agent carries all applicable correctness dimensions). Each prompt needs: **which dimension(s)**, the PR type, the stated goal (PR body plus issue acceptance criteria from Step 1d), the **refs** (`origin/<base>` and `origin/pr/<n>`) and the paths that dimension owns. No severity in the brief; it assigns none.
- **Read the diff yourself for the other six** and judge them against the Step 4 checklist in `SKILL.md`. Handing them to `diff-reviewer` wastes a spawn and returns nothing.
- **Test coverage is yours and not optional.** `diff-reviewer` must name a failing input for every item, so it cannot report "no test exists". Missing tests on complex logic is a Critical you raise.

Never spawn an extra agent because the first "might have missed" something. If a finding set looks thin, read that file yourself.

## 3D.3 - Collect and dedupe

Gather each agent's list; note any agent that failed. Dedupe by `(file, line, defect)`. Assign severity yourself: a defect with a named failing input and a wrong result is a **Critical candidate**, an unmet stated requirement is a **Gap**, your own convention findings keep their checklist severity.

## 3D.4 - Edge cases, then a human ruling

**Only with `--deep`.** When deep mode was reached by size alone, skip this step and go to 3D.5.

Spawn **one** `edge-case-explorer` with a description of the change, the paths it touches and the diff file from 3D.0. It returns ranked candidates, each with a scenario and two paired assertions.

Present them to the user for a ruling; neither the explorer nor you rules:

- Batch with `AskUserQuestion` (up to 4 per call), highest rank first, each phrased as the two assertions: _"Intended - a player without a faction can never be an editor"_ / _"Not intended - faction editors lose access when they leave"_.
- Do the same for every **Critical candidate** from 3D.3 that rests on a fact the diff cannot settle.
- Only a candidate the **user** rules a real problem becomes Critical. Ruled intended: one "accepted by design" line, or drop it.
- Unruled: list under open questions; it never drives the verdict.

## 3D.5 - Converge

You now have user-confirmed Criticals, checklist Gaps, Suggestions and open questions. Continue with **Step 4b** for anything still resting on an assumption, then the Output Format as in Standard mode. Say in one line that this was a deep multi-agent review.
