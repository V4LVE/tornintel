# tornintel

Torn faction tools built with TanStack Start. The main page tracks an opposing faction's hospital status, your faction's chain, and your energy. The payouts page calculates ranked war payouts, and Settings manages the API key stored in this browser.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and enter a Torn API key. The key is stored in browser local storage and sent to this app's API routes in the `X-Torn-Api-Key` header. The server uses it for requests to Torn. A Limited key is needed for the optional Fair Fight estimates; the other views use Torn's public or minimal selections.

To build and start the production server:

```bash
npm run build
npm start
```

## Project layout

- `src/routes/index.tsx`: hospital dashboard and live chain and energy panels.
- `src/routes/payouts.tsx`: ranked war payout calculator.
- `src/routes/war-deals.tsx`: war deal planning and editable proposals for both outcomes. With a saved API key, faction names, current war target, item market prices, and each faction's latest completed cache rewards load automatically. Cache counts are a labeled historical baseline, not a prediction for the entered scores; all values can be adjusted manually. Compensation uses the losing faction's score, with whole items and a cash remainder. Payment wording appears only when a rate or timing is supplied. Manual planning remains available without an API key at `/war-deals`.
- `src/routes/levelling.tsx`: levelling targets grouped into tiers of ten levels.
- `src/routes/settings.tsx`: API key and connected account settings.
- `src/routes/api/`: server endpoints, grouped per feature in route-group folders such as `(levelling)/` that do not change the URL.
- `src/lib/<feature>/`: logic per feature (`torn`, `war-hospital`, `travel`, `battle-stats`, `levelling`, `ffscouter`, `war-deals`, `auth`, `hooks`), with tests next to the code.
- `src/components/`: shared React components.
- `src/styles.css`: application styles. Colors are CSS variables with dark and light values at the top of the file; the theme button in the war hospital top bar switches between them and is remembered in the browser.

The router generates `src/routeTree.gen.ts` when routes change. Do not edit it by hand.

## Checks

```bash
npm run lint
npm run check
npm test
npx tsc --noEmit
npm run build
```

## Levelling targets

`/levelling` shows the levelling list (ported from the TheTornLeveling Discord bot) in ten tiers of ten levels each, from Tier 1 (level 1-10) to Tier 10 (level 91-100). The page opens on the tier with the most players. With a saved API key, Find 3 targets picks random players from the tier and checks them with Torn's `basic` selection, skipping anyone in hospital, jail or traveling. Up to 12 players are checked per search, three at a time. Searching again skips the targets currently shown.

The bundled players live in `src/lib/levelling/players.json` as an array of `{ name, id, lvl, total, str, def, spd, dex }` (numbers may be strings with commas; a duplicate ID keeps the first entry). Their stats are a recorded snapshot: Torn's API only returns battle stats for the key owner.

With a saved API key the list also shows a TBS column: the same Fair Fight based estimate as the war hospital target list, from the shared evidence in PostgreSQL (see Shared TBS storage below). Loading it shares the viewer's recent fights, so attacks on levelling targets improve the estimates for everyone. Players without recorded fights show No FF evidence. The list can be sorted by listed total, TBS, or FF Scouter estimate.

### FF Scouter

Turning on Use FF Scouter estimates shows current [FF Scouter](https://ffscouter.com) battle stat estimates and fair fight for the tier, and adds Find new players, which searches FF Scouter for players in the tier with a low fair fight (optionally inactive 14+ days). FF Scouter uses a Torn API key registered at ffscouter.com. Settings has an optional FF Scouter key field for using a different key than the tornintel one (it is checked with FF Scouter's `check-key` and only saved when registered); without it the Torn API key is sent to ffscouter.com. The setting is opt-in and stored in the browser. Estimates are cached on the server for five minutes per key. FF Scouter rate limits by IP, so all tornintel users share its limits.

### Shared list changes

Players added from Find new players, and players removed from the list, are stored in the `levelling_list_changes` table and shared with all tornintel users. Run `npm run db:migrate` to create it. The editor's identity comes from their Torn API key, and an added player's name and level come from Torn. Added players keep FF Scouter's total estimate from when they were added. Anyone with an API key can add new players, but removing players, and restoring removed ones, is limited to trusted editors: set `LEVELLING_EDITOR_IDS` and/or `LEVELLING_EDITOR_FACTION_IDS` to comma-separated Torn player or faction IDs. With neither set, nobody can remove players. Remove buttons only appear for editors. Removing a player hides it; an editor adding the same player again restores it. Without a database the original lists are shown and changes are disabled.

## Tracked faction

The war hospital tracks the opponent in your faction's current or upcoming ranked war, or the opponent from the last finished ranked war. `TORN_ENEMY_FACTION_ID` is an optional fallback when neither is found. Entering a faction ID tracks it instead and is remembered in the browser until you click Auto.

## Opposing faction travel

The member table tracks active flights inline, with live countdowns and estimated landing windows in the viewer's local time. Hover over the timing for UTC / Torn time. The Traveling filter shows flights, and the Abroad filter shows members who have already landed overseas.

Departure observations are shared in PostgreSQL and survive server restarts. Tracking runs during dashboard syncs while a page is visible and unpaused; it does not monitor continuously when everyone closes the app. A departure seen between status syncs has a window that includes the polling interval. First sightings mid-flight or after a monitoring gap show departure unknown and only a broad upper arrival estimate.

Torn does not expose opponents' private travel details through the viewer's key. Estimates use the [official travel times](https://wiki.torn.com/wiki/Travel), cover business through standard flights, the travel book, and 3% flight variance. Additional delays can fall outside the window. An elapsed countdown does not mark the member ready: the next Torn status must confirm landing. Hidden destinations have no invented countdown. Run `npm run db:migrate` when updating to create the shared travel tracking table; storage failures fall back to temporary tracking on the current server.

## Shared TBS storage

Set `DATABASE_URL` to a PostgreSQL connection string in `.env.local` (or in the production server environment), then run `npm run db:migrate`. All app instances must use the same database to share estimates.

While the faction dashboard syncs, a Limited key contributes usable solo Fair Fight observations from the player's recent attacks and defenses. Evidence is stored by target player ID and shared with all tornintel users, including those without their own usable combat history. It follows targets when they change faction. API keys and individual battle stats are not stored; the evidence contains the observer's battle stat score, balance factor, Fair Fight modifier, player IDs, and fight date.

Repeated syncs preserve the first captured evidence for each hit. Stored evidence survives server restarts and remains available after it drops out of Torn's recent history. Estimates are recalculated from the saved observations, with older fights receiving less weight. TBS remains an estimate or a capped bound, not an exact measurement. The dashboard shows the evidence date and contributor names, falling back to player IDs for evidence without a saved name. Contributor names refresh when those hits sync again.

Without a database, or during a storage outage, the dashboard continues with the viewer's own evidence and displays a sharing warning. Drizzle commands load `DATABASE_URL` from `.env.local` or `.env`; the production server needs it in its environment.
