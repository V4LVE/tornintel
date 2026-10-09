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
- `src/routes/settings.tsx`: API key and connected account settings.
- `src/routes/api/`: server endpoints that request Torn data.
- `src/lib/battle-stats/`: Fair Fight based estimates and tests.
- `src/lib/torn-user.ts`: shared client-side user verification and profile type.
- `src/styles.css`: application styles.

The router generates `src/routeTree.gen.ts` when routes change. Do not edit it by hand.

## Checks

```bash
npm run lint
npm run check
npm test
npx tsc --noEmit
npm run build
```

## Shared TBS storage

Set `DATABASE_URL` to a PostgreSQL connection string in `.env.local` (or in the production server environment), then run `npm run db:migrate`. All app instances must use the same database to share estimates.

While the faction dashboard syncs, a Limited key contributes usable solo Fair Fight observations from the player's recent attacks and defenses. Evidence is stored by target player ID and shared with all tornintel users, including those without their own usable combat history. It follows targets when they change faction. API keys and individual battle stats are not stored; the evidence contains the observer's battle stat score, balance factor, Fair Fight modifier, player IDs, and fight date.

Repeated syncs preserve the first captured evidence for each hit. Stored evidence survives server restarts and remains available after it drops out of Torn's recent history. Estimates are recalculated from the saved observations, with older fights receiving less weight. TBS remains an estimate or a capped bound, not an exact measurement. The dashboard shows the evidence date and contributing player IDs.

Without a database, or during a storage outage, the dashboard continues with the viewer's own evidence and displays a sharing warning. Drizzle commands load `DATABASE_URL` from `.env.local` or `.env`; the production server needs it in its environment.
