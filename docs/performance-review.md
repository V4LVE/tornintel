# Performance review — 2026-10-10

Reviewed the dashboard, polling, Torn request cache, travel tracking, shared Fair
Fight evidence, chain target lookup, war deal defaults, payouts, and production
build output against commit `200ae59`.

## Changes

- Removed the unused HeroUI stylesheet import. No source component imports HeroUI
  or uses its CSS variables. Production CSS fell from 452.70 kB to 27.71 kB
  (44.85 kB to 7.17 kB gzip). The main JavaScript bundle remains 343.73 kB
  (109.72 kB gzip).
- Travel storage and combat evidence loading now run concurrently after faction
  status is fetched. Shared evidence still saves before loading. This removes
  travel storage latency from the evidence path; no live latency benchmark was
  performed.
- Evidence conflicts update a contributor name only when a supplied name differs
  from the saved value. The first captured battle stats remain unchanged.
- Travel tracking retains its transaction and row locks but skips updates for
  cached or older observations. Fresh observations still write their timestamp,
  which is necessary to detect gaps in monitoring.
- The dashboard clock stops while the page is hidden and refreshes immediately
  on return. Ready-target lists and online counts are reused between clock ticks;
  online counts now use the server's online flag rather than substring matching.

## Existing behavior retained

The Torn cache isolates API keys, coalesces concurrent requests, clones returned
data, and preserves upstream timestamps. Polling avoids overlapping requests and
waits while the page is hidden. Optional combat evidence uses a longer cache
lifetime than faction status. Chain lookup caps profile checks and rechecks ready
targets. War deal history requests run concurrently and reuse matching reports.
The production build already strips developer tools and splits page components.

## Follow-up findings

- `src/routes/api/payout-hits.ts` requests only one page of up to 100 attacks.
  Non-war hits can be undercounted for a larger war. Add bounded pagination with
  complete/partial result reporting and a multi-page regression test before
  relying on these counts for payouts. More pages also consume more Torn calls.
- `src/routes/payouts.tsx` stores paid player IDs in one browser-wide list.
  Switching wars can show a player as paid because of a previous war. Scope
  payment records by faction/account and war; the current list has no war metadata
  that would allow a reliable automatic migration.
- Shared evidence grows with saved history. Its player-ID index avoids a table
  scan, but loading and estimating all historical hits may eventually become
  expensive. Measure row counts and query times before choosing retention or
  aggregation rules, which could affect estimates and capped bounds.

## Validation and limits

- Unit and mocked endpoint tests: 57 passed, zero failed.
- Production build, ESLint, and TypeScript checking pass.
- Production HTTP smoke checks: all four pages return 200; all six data endpoints
  return 401 without an API key.
- Changed files pass Prettier. The repository-wide formatting check reports
  existing violations in 24 unchanged files.
- The two PostgreSQL integration tests remain opt-in and were skipped. They now
  also check that repeated syncs leave PostgreSQL row versions unchanged.
- No authenticated browser session, visual regression check, or live Torn/database
  performance benchmark was available for this review.
