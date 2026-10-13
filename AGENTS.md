# AGENTS.md

tornintel is a Torn faction tool built with TanStack Start (React 19, Vite, Nitro), Drizzle/PostgreSQL and plain CSS. User-facing text is in English. This file is the shared guide for all coding agents; CLAUDE.md imports it.

<!-- intent-skills:start -->

## Skill Loading

Before editing files for a substantial task:

- Run `npx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

## Commands

```bash
npm run dev              # dev server on http://localhost:3000
npm run build            # production build (.output/); also regenerates src/routeTree.gen.ts
npm test                 # tsx --test "src/**/*.test.ts"
npm run lint             # eslint
npx tsc --noEmit
npx prettier --check src README.md
npm run db:generate      # new migration after changing src/db/schema.ts
npm run db:migrate       # run migrations against DATABASE_URL
```

- Tests live next to the code they cover (`*.test.ts` anywhere under `src/`). The glob is quoted so Node expands `**` on every shell.
- `drizzle-kit generate` needs `DATABASE_URL` but does not connect: `DATABASE_URL=postgres://u:p@localhost:5432/x npm run db:generate` is enough.
- Integration tests against a real Postgres only run with `TORNINTEL_DB_TEST=1`.

## Tooling pitfalls

- The user often has `npm run dev` running on port 3000 with a real database. Use it to check changes instead of starting another server.
- The dev server regenerates `src/routeTree.gen.ts` whenever route files change. Never `git stash` while it runs: the regenerated file blocks `git stash pop` (recover with `git checkout -- src/routeTree.gen.ts`, then pop again).
- Do not use `npx tsr generate`: it drops the `@tanstack/react-start` registration from the route tree, breaking types in every API route. Regenerate with `npx vite build`. Never edit `routeTree.gen.ts` by hand.
- `npm ci` and builds can rewrite `package-lock.json`. Restore it with `git checkout -- package-lock.json` unless dependencies changed on purpose.
- On a fresh `npm ci`, `npx tsc --noEmit` and `npm run lint` are clean: any error is yours. If tsc reports `TS7016 Could not find a declaration file for module 'drizzle-orm'` (and lint then flags assertions in the travel integration test), the local `node_modules/drizzle-orm` is missing its `.d.ts` files: stop the dev server and reinstall with `npm ci`.
- The working copy uses CRLF (autocrlf) and the index stores LF (`.gitattributes`). `prettier.config.js` sets `endOfLine: 'auto'` so prettier keeps each file's line endings.
- Format only the files you changed (`npx prettier --write <files>`). Never `npm run format` or `prettier --write .`: it touches the whole repo. Before finishing, check `git diff --stat` and revert line-ending-only or whitespace-only changes to unrelated files.
- When moving types or functions between files, let the compiler find the references: move, run `npx tsc --noEmit`, fix every new error, repeat. Text-replacement scripts miss references inside function bodies.
- CI (`.github/workflows/ci.yml`) runs on every pull request and push to `main`, as separate checks: lint and `prettier --check .`, typecheck, unit tests, integration tests against a throwaway Postgres (migrations, then `TORNINTEL_DB_TEST=1`), and a build that fails when `src/routeTree.gen.ts` was not regenerated. Deploying is separate: `.github/workflows/coolify-deploy.yml` builds the Docker image and calls the Coolify webhook on push to `main`, whether or not CI passed.

## Architecture

### Pages (`src/routes/`)

| Route        | File            | Contents                                                                                                                      |
| ------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/`          | `index.tsx`     | War hospital: opposing members (hospital, ready, travel), chain tracker, energy, keep-alive chain target, TBS                 |
| `/levelling` | `levelling.tsx` | Levelling targets in 10 tiers of 10 levels, Find 3 targets, TBS, FF Scouter estimates and new-player search, shared list      |
| `/payouts`   | `payouts.tsx`   | Ranked war payout calculator (war and non-war hits × rate, capped at earnings)                                                |
| `/war-deals` | `war-deals.tsx` | War deal proposals for both outcomes (compensation = losing score × rate, whole items plus a cash remainder)                  |
| `/my-stats`  | `my-stats.tsx`  | Own battle stats and 7D–1Y progress, opt-in sharing with the faction, faction list with shared stats and FF Scouter estimates |
| `/settings`  | `settings.tsx`  | Torn API key and optional FF Scouter key                                                                                      |

`__root.tsx` holds the HTML document, favicon links, the theme boot script and `notFoundComponent`. Its `component` wraps every page in `SessionProvider` and `AppShell`, so pages render inside the shared sidebar and top bar and navigate client-side with `Link` (no full page loads, no back links).

### Folder structure

Code is grouped by feature. Put new files in the matching feature folder, with tests next to them. Shared types and DTOs live in `src/models/`, one file per feature:

```
src/
  components/            shared React components
  db/                    Drizzle client and schema
  models/                shared types and DTOs, one file per feature (see Models below)
  lib/
    torn/                Torn API client (fetchTorn) and key verification
    war-hospital/        enemy faction resolution, dashboard route tests
    travel/              flight tracking
    battle-stats/        TBS estimator and Fair Fight evidence
    levelling/           tiers, bundled players.json, shared list changes
    ffscouter/           FF Scouter client
    war-deals/           war deal logic and data loading
    auth/                Better Auth scaffolding
    hooks/               React hooks (use-visible-polling, use-table-view)
    table-view/          search, sort and pagination helpers for tables
  routes/                pages (file name = URL)
    api/(<feature>)/     API routes grouped per feature
```

API route folders in parentheses are TanStack route groups: they organize files without changing the URL (`src/routes/api/(levelling)/levelling-list.ts` serves `/api/levelling-list`). The generator writes the group into the route id (`createFileRoute('/api/(levelling)/levelling-list')`); leave that as generated. A new API route goes in the group of its feature, or a new group.

### API routes (`src/routes/api/`)

Groups: `(war-hospital)` faction-members, chain-target, combat-bars; `(levelling)` levelling-*; `(account)` user, ffscouter-key; `(my-stats)` my-stats, my-stats-history, stat-sharing, faction-stats; `(payouts)` payout-hits; `(war-deals)` war-deal-defaults; `auth/$`.

- **`user`**: verifies the key (used by `verifyTornUser` in `src/lib/torn/torn-user.ts`).
- **`faction-members`**: opposing members with status, travel and TBS. Without `factionId`, `src/lib/war-hospital/enemy-faction.server.ts` picks the opponent in the current or upcoming ranked war, then the last ranked war, then `TORN_ENEMY_FACTION_ID`.
- **`combat-bars`** and **`chain-target`**: energy and chain, plus a keep-alive target from the viewer's recent solo wins.
- **`payout-hits`** and **`war-deal-defaults`**: data for payouts and war deals.
- **`levelling-list`**:
  - GET: the bundled list plus shared changes.
  - POST `{playerId, action: 'add'|'remove'}`: the editor's identity and the player's name/level come from Torn, never from the request body.
  - Removing players and restoring removed ones is limited to trusted editors (`isLevellingEditor`, configured with `LEVELLING_EDITOR_IDS`/`LEVELLING_EDITOR_FACTION_IDS`); anyone with a key can add new players. GET with a key returns `canEdit` so the UI only shows Remove to editors. Any change that affects every user must check permissions, not just identity.
- **`levelling-targets`**: random targets from a tier, checked with Torn `basic`. At most 12 checks, three at a time.
- **`levelling-stats`**: Fair Fight based TBS estimates for a list of IDs.
- **`my-stats`** and **`my-stats-history`**: the key owner's battle stats (v2 `battlestats`) and a historical `personalstats` reading for one timestamp. Both also store the reading when the owner shares with their faction.
- **`stat-sharing`**: GET the viewer's sharing state; POST `{enabled}` to opt in (requires a faction, records current stats) or out (deletes everything shared).
- **`faction-stats`**: the viewer's own faction with shared stats and history. The faction comes from the viewer's key, so shared stats only reach members of the same faction. FF Scouter estimates only with `?ffscouter=1`.
- **`levelling-estimates`**, **`levelling-discover`** and **`ffscouter-key`**: proxies to FF Scouter's `get-stats`, `get-targets` and `check-key`.
- **`auth/$`**: Better Auth scaffolding. No page uses it and no database adapter is configured.

### Server lib (`src/lib/`)

- **`torn/torn-api.server.ts`**: `fetchTorn(url, { maxAgeMs, signal?, cacheWhen? })`. It keeps a per-process cache (256 entries) keyed by a sha256 hash of the URL, so API keys never appear in cache keys. Concurrent identical calls share one request. It throws `TornApiError(message, code)`. `cacheWhen` is used, for example, to cache only players who are not `Okay`, so available targets are always rechecked.
- **`battle-stats/`**:
  - `estimator.ts`: `estimateBattleStats`; BSS is the sum of the square roots of the four stats.
  - `fair-fight-evidence.server.ts`: loads the viewer's own attacks via v1 `profile,battlestats,attacks`. v1 is deliberate: a Limited key can fetch its own stats and attacks together there. Only the last 14 days count, because only current stats are known.
  - `shared-evidence.server.ts`: saves and loads shared evidence. The first observation per `evidenceId` is kept.
- **`travel/`** (`travel.ts`, `travel.server.ts`): flight tracking and arrival windows, stored in Postgres with row locks and an in-memory fallback.
- **`levelling/`** (`levelling.ts`, `levelling.server.ts`): tiers (`LEVELLING_TIERS`, `tierForLevel`), normalizing `src/lib/levelling/players.json`, and `applyListChanges`.
- **`ffscouter/`** (`ffscouter.ts`, `ffscouter.server.ts`): FF Scouter client. Estimates are cached for 5 minutes per key, because fair fight is relative to the key owner. `ffScouterKeyFrom(request)` uses `X-FfScouter-Key` and falls back to the Torn key.
- **`war-deals/`**: war deal summaries, message generation and Torn data loading.
- **`war-hospital/`**: `enemy-faction.server.ts` (picks the opponent faction).
- **`battle-stats/my-stats.ts`** and **`battle-stats/faction-sharing.server.ts`**: My stats helpers (stat names, ranges, build summary, `dayEnd`), `fetchPlayerIdentity` (who owns a key, from Torn) and `statSharingRepository`. Readings are bucketed per UTC day.
- **`hooks/use-visible-polling.ts`**: polling without overlapping requests, only while the tab is visible.
- **`hooks/use-stat-history.ts`**: My stats history, cached per player in `tornintel.statHistory.<id>`.
- **`hooks/use-table-view.ts`** and **`table-view/`**: client-side search, filter tabs, column sorting and pagination. Missing sort values always go last; the page is clamped so polling refreshes keep the current page.

### Models (`src/models/`)

Every shared type and DTO, so the API route and the page use the same definition. Files hold only `type` declarations (no runtime code) and import each other with `import type`:

| File              | Contents                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `account.ts`      | `UserProfile` and the `/api/user` response                                                                                  |
| `battle-stats.ts` | Battle stats, Fair Fight observations, `BattleStatsEstimate`, shared evidence and contributors                              |
| `ffscouter.ts`    | FF Scouter API shapes, `FfScouterEstimate`, key status                                                                      |
| `levelling.ts`    | `LevellingTier`, list players and changes, `/api/levelling-*` responses                                                     |
| `my-stats.ts`     | `OwnBattleStats`, `StatPoint`, `RangeKey`, `PlayerIdentity`, `/api/my-stats*`, `stat-sharing` and `faction-stats` responses |
| `payouts.ts`      | Payout players, wars and `/api/payout-hits` responses                                                                       |
| `torn.ts`         | Raw Torn API responses as tornintel reads them (`TornAttack`, `TornBasicProfile`, `TornRankedWar`, ...)                     |
| `travel.ts`       | Member status, travel snapshots and estimates                                                                               |
| `war-deals.ts`    | `CacheEstimate`, `DealDefaults`                                                                                             |
| `war-hospital.ts` | `WarTarget`, `FactionMembersResponse`, `CombatBarsResponse`, chain target and enemy faction types                           |

- Put a type here when more than one file uses it, when it is an API response (DTO), or when it describes a Torn or FF Scouter response. Props and small helper types used by a single file stay in that file.
- API routes check their responses with `satisfies <Response type>` from here, and pages fetch with the same type, so a changed DTO fails type checking on both sides.

### Components (`src/components/`)

- `battle-stats-cell.tsx`: TBS display, shared by the dashboard and levelling.
- `table-controls.tsx`: `TableToolbar` (filter tabs with counts and search), `SortHeader`, `TableEmpty` and `TablePagination`. Driven by `useTableView` from `src/lib/hooks/use-table-view.ts` (pure helpers in `src/lib/table-view/`). Every list table uses them inside a `.panel` (`.panel.table-panel` on standalone pages); new lists should too instead of building their own filtering or paging.
- `theme-toggle.tsx`: the dark/light button and `themeBootScript`.
- `session.tsx`: `SessionProvider` and `useSession()`: the verified Torn key and profile (`apiKey`, `user`, `connect`, `disconnect`), and `apiError`/`reportApiError` for the top bar's connection status (the war hospital reports each poll). Pages read the key from here instead of verifying it themselves.
- `app-shell.tsx`: `AppShell` (API key gate, sidebar, top bar with breadcrumb, Torn connection status and theme toggle) and `PageHeading` (eyebrow, title, description) for the top of each page. The sidebar is configured in `NAV_SECTIONS`: **Faction** for faction-wide tools and **Personal** for the viewer's own tools. A new page gets a nav entry there and starts with `PageHeading`; items without a `link` show as "Soon".

### Database (`src/db/schema.ts`, migrations in `drizzle/`)

| Table                                                              | Purpose                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `shared_fair_fight_observations`                                   | Shared Fair Fight evidence for TBS, shared between all users                                            |
| `faction_member_travel`                                            | Shared travel snapshots                                                                                 |
| `stat_sharing`, `shared_stat_snapshots`                            | Players sharing real stats with their faction, and their daily readings. Opting out deletes both        |
| `levelling_list_changes`                                           | Players added to or removed from the levelling list. Removal is a soft delete; adding again restores it |
| `todos`, `battle_stat_evidence`, `battle_stat_calibration_samples` | Unused (template leftover or planned)                                                                   |

Everything must work without `DATABASE_URL`. Each storage feature checks `process.env.DATABASE_URL` itself, falls back (own data only or temporary memory) and returns a `warning`/`reason` that the UI shows. Writes return 503 without a database.

## Conventions

- **API keys:**
  - The Torn key lives only in the browser's localStorage (`tornintel.apiKey`). It is sent in the `X-Torn-Api-Key` header and to Torn as the `key` parameter.
  - Never log keys, store them on the server, or include them in cache keys.
  - The FF Scouter key lives in `tornintel.ffscouterKey` and is sent as `X-FfScouter-Key`. The UI says clearly when a key is sent to ffscouter.com.
- **localStorage keys** use the `tornintel.` prefix: `apiKey`, `ffscouterKey`, `ffscouter`, `manualFactionId`, `hospitalPaused`, `paidPayouts`, `theme`, `statHistory.<playerId>`. Store only per-viewer conveniences there, not shared state.
- **API routes:**
  - Shape: `createFileRoute('/api/x')({ server: { handlers: { GET } } })`, with helpers below `Route` in the same file. Export nothing but `Route` from a route file; shared helpers belong in `src/lib`.
  - Errors always use `Response.json({ error: 'Full sentence.' }, { status })`: 401 missing key, 400 validation, 403 not allowed, 404/409 for lookups, 502 for Torn or FF Scouter failures (pass `TornApiError.message` through), 503 without storage.
  - Set `Cache-Control: no-store`.
  - **Authorization:** a valid Torn key proves who the caller is, not what they may change. Every write to data shared between users (a POST/PUT/PATCH/DELETE handler, or a `.server.ts` write reached from a GET) needs an explicit permission check, such as `isLevellingEditor`, and undoing someone else's change counts as a write. Each rule gets a test that asserts 403 for an unauthorized caller. When porting a feature, first list every mutation and who may perform it.
- **Logging:** `console.warn/error('[tornintel] Message', { message })`, never with keys.
- **Server and client:** `.server.ts` files are server-only (db, Torn fetches, node:crypto). Pure logic shared with the client goes in a sibling file without `.server`; types go in `src/models/`. The client may only `import type` from `.server` files.
- **TypeScript:**
  - Use `type`, not `interface`.
  - Put type imports on a separate `import type` line (enforced by `consistent-type-imports` and `verbatimModuleSyntax`).
  - The import alias is `#/` (`#/lib/...`).
  - Use `satisfies` on response objects.
  - tsconfig is strict, with `noUnusedLocals`/`noUnusedParameters`.
- **Lint rules that often bite:** `no-shadow` (for example a `request` parameter shadowing a function), `no-unnecessary-type-assertion` and `no-unnecessary-condition`.
- **Formatting:** prettier with no semicolons, single quotes and trailing commas.
- **Comments:** sparse, full sentences that explain _why_.
- **Client fetches:**
  - Use local helpers at the bottom of the file with `cache: 'no-store'`, cast to `T & { error?: string }`, and throw `new Error(payload.error ?? '...')`.
  - Effects use an `AbortController` and must not set state after aborting. Prefix calls to async functions with `void`.
- **Tests:**
  - Use `node:test` and `node:assert/strict`.
  - Route tests import `Route` and call `Route.options.server.handlers.GET({ request: new Request(...) } as never)`.
  - Mock `globalThis.fetch` and restore it in `finally`, or use `context.mock.method`.
  - The `fetchTorn` cache is global per process: use different keys or IDs between tests, or they hit each other's cache.
- **CSS (`src/styles.css`):**
  - Plain semantic classes only, prefixed per page: `levelling-`, `payout-`, `deal-`, `settings-`, `chain-`, `travel-` and so on. Tailwind and HeroUI are installed but not used in JSX.
  - Every color is a variable at the top: `--c-<dark-hex>`, with a dark value in `:root` and a light value in `:root[data-theme='light']`. Never use hex values directly in rules; add a new color to both blocks.
  - Breakpoints are 1000px, 800px and 700px.
- **Torn links:** `https://www.torn.com/page.php?sid=attack&user2ID=<id>` and `https://www.torn.com/profiles.php?XID=<id>`.
- Update `README.md` when features, environment variables or flows change.
- **Git:**
  - Branch off for each piece of work; `main` deploys on push, so never commit to it directly.
  - Commit subjects are past tense and capitalized, with no prefix and at most 72 characters ("Moved shared types and DTOs into src/models"), then short bullets for what and why.
  - Answer a request for a commit message right away, even in the middle of other work.
  - Commit at logical checkpoints instead of piling several features into one diff.

## Claude Code setup (`.claude/`)

- `settings.json`: a PostToolUse hook (`hooks/format-edited-file.mjs`) runs prettier on each file after Edit or Write. It skips `routeTree.gen.ts`, `drizzle/` and files in `.prettierignore`. Personal settings go in `settings.local.json`, which is git-ignored.
- Skills: `/commit` (commit message in the repo style), `/pr-ready` (checks, authorization audit, PR description), `/merge-main` (merge `origin/main` or a parent branch into the current branch and resolve conflicts), `/handoff` (handoff document for a fresh session, saved in the OS temp directory), `/pr-review [n] [--deep]` (author-side review of your own GitHub PR, posted as one `COMMENT` review; needs `gh auth login`) and `/pr-fix [n]` (on your own PR: resolve conflicts with the base, then fix, answer or escalate every open review comment, push and reply).
- Agents: `diff-reviewer` and `edge-case-explorer`, read-only reviewers that `/pr-review --deep` spawns.

## Domain knowledge

- **Other players' battle stats:** the Torn API only returns battle stats for the key owner. Anyone else's stats are always estimates: Fair Fight evidence (TBS) or FF Scouter.
- **Fair Fight:** FF of 1.05 or less is "weak" and 3 or more is "capped". Both give only bounds, not point estimates. Only uninterrupted solo wins count (Hospitalized, Mugged, Attacked or Left).
- **Levelling tiers** are plain level ranges from 1 to 100. `players.json` is a snapshot; users' changes live in `levelling_list_changes`.
- **FF Scouter:**
  - Rate limits by IP, so all tornintel users share its limits (`get-stats` 120/min with up to 205 IDs, `get-targets` 25/min).
  - Its key is a Torn key registered at ffscouter.com. Error code 6 means the key is not registered.
- **Torn error codes:**
  - Key errors (2, 10, 13, 18) must be shown to the user, not hidden behind a fallback.
  - Code 6 means an invalid player ID and must not abort a whole search.

## Environment variables (`.env`, see `.env.example`)

`DATABASE_URL` (optional, but needed for shared data), `TORN_ENEMY_FACTION_ID` (optional fallback), `LEVELLING_EDITOR_IDS` and `LEVELLING_EDITOR_FACTION_IDS` (trusted levelling list editors; none means nobody can remove), `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (Better Auth, required in production) and `TORNINTEL_DB_TEST` (integration tests). Never commit `.env` or real keys.
