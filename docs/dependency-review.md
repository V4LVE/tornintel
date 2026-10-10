# Dependency review — 2026-10-10

Updated the user-level npm installation from 12.0.2 to 12.2.0. Its Node engine
requirement accepts the installed Node 24.19.0. Recorded `npm@12.2.0` in the
project's `packageManager` field; the Docker image continues to use Node 22 and
its bundled npm.

## Installed direct-package updates

| Package                         | Before   | After    |
| ------------------------------- | -------- | -------- |
| @heroui/react                   | 3.2.5    | 3.2.6    |
| @heroui/styles                  | 3.2.5    | 3.2.6    |
| @tanstack/react-devtools        | 0.10.12  | 0.10.13  |
| @tanstack/react-router          | 1.170.35 | 1.170.42 |
| @tanstack/react-router-devtools | 1.167.1  | 1.167.2  |
| @tanstack/react-start           | 1.168.52 | 1.168.61 |
| @tanstack/router-cli            | 1.167.35 | 1.167.41 |
| @types/node                     | 22.20.2  | 22.20.5  |
| @vitejs/plugin-react            | 6.1.1    | 6.1.2    |
| better-auth                     | 1.7.4    | 1.7.7    |
| dotenv                          | 17.4.2   | 18.0.7   |
| drizzle-kit                     | 0.31.10  | 0.31.11  |
| drizzle-orm                     | 0.45.2   | 0.45.4   |
| eslint                          | 9.39.5   | 10.12.0  |
| pg                              | 8.23.0   | 8.23.1   |
| prettier                        | 3.9.6    | 3.9.10   |
| tsx                             | 4.23.13  | 4.23.15  |
| vite                            | 8.3.0    | 8.3.4    |

Refreshed compatible transitive dependencies in `package-lock.json`. Replaced
`latest` tags with caret ranges and raised manifest minimums to installed
versions. Moved Drizzle Kit to development dependencies because it provides
database administration commands, while Drizzle ORM remains a runtime dependency.
Added npm 12 approvals for the installed versions of esbuild and unrs-resolver
and verified their setup scripts with `npm rebuild`.

## Compatibility decisions

- Retained TypeScript 6.0.3: the installed typescript-eslint parser supports
  `>=4.8.4 <6.1.0`. TypeScript 7 also lacks the stable programmatic API needed by
  tools embedding the compiler, as described in Microsoft's
  [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- Retained Node 22 types, updated to 22.20.5, to match the Docker runtime rather
  than expose APIs available only in the developer machine's Node 24.
- ESLint 10 is supported by the installed TanStack config and plugins. Reviewed
  the [migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0);
  the current flat configuration passes without source changes.
- Reviewed the [dotenv changelog](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md).
  The project uses `config()` with multiple paths; it does not use the removed
  preload or vault APIs.
- The remaining `npm outdated` entries are only TypeScript and Node types, held
  for the compatibility reasons above. Nitro's existing beta release is retained.

## Audit

The audit fell from nine findings (three critical, two high, four moderate) to
four moderate findings. The remaining findings all originate from esbuild
0.18.20 through Drizzle Kit's deprecated esbuild-kit loader. The
[advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) concerns esbuild's
development server CORS behavior.

The latest Drizzle Kit still declares that loader. npm's proposed automatic fix
would downgrade Drizzle Kit to 0.18.1. Kept the current version rather than apply
that downgrade or override its dependency across incompatible version ranges.
The findings also appear with `--omit=dev` because better-auth declares an
optional Drizzle Kit peer; moving the direct dependency does not eliminate that
peer path.

## Validation

- 57 tests passed; the two opt-in PostgreSQL integration tests were skipped.
- ESLint, TypeScript checking, production build, and dependency-tree checks pass.
- The updated Drizzle CLI reports Kit 0.31.11 and ORM 0.45.4.
- dotenv 18 passes a multi-file precedence check using temporary synthetic
  configuration files; local overrides and base-file fallbacks are preserved.
- Production HTTP checks cover all four pages and anonymous access to all six
  data endpoints. Authenticated browser behavior and database migrations were
  not exercised.
- Client JavaScript decreased from 343.73 kB to 340.40 kB (109.72 kB to 109.23 kB
  gzip); CSS remains 27.71 kB (7.17 kB gzip).
- The new Rolldown release emits upstream module-directive and timing-label
  warnings during the Nitro build; the build completes successfully.
- The local HTTP smoke run also reports Better Auth's unset base URL warning.
  The existing auth configuration does not declare one; deployments using its
  account callbacks should supply `BETTER_AUTH_URL` for their domain.
- npm could not remove one retired Rolldown native binary, consistent with a
  running process holding it open on Windows. The new installed binary builds
  successfully. Restart an existing development server to load the new packages.
