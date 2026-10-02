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

Drizzle commands require `DATABASE_URL` in `.env.local` or `.env`. The dashboard's Torn API key flow does not require a database. The optional Better Auth and database files are still present in the project.
