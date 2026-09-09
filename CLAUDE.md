# songdee-ops-panel

Songdee Ops Panel — an Android/Expo **tablet app** for drivers plus a **Next.js fleet web
dashboard**, backed by a dedicated Neon Postgres database. Drivers run jobs on the tablet;
the backend pairs each job against Data-FM GPS history and the dashboard reports coverage.

Part of the Songdee fleet family but a **separate product** from `songdee-dashboard`
(sheet-rendering alert analytics), `songdee-svis` (inspections), and `songdee-spark-site`
(AI alert triage). Route by screen: job start/finish on a tablet, route maps, GPS pairing
reports → here.

## Layout

- `app/`, `components/`, `lib/`, `assets/` — Expo Router tablet app (React Native 0.86, Expo 57)
- `web/` — Next.js dashboard **and** all `/api/*` functions (`web/app/api/[[...segments]]/route.js`)
- `db/` — `schema.sql` (idempotent, transactional) + `db/migrations/*.sql`
- `server.js` — local-development API only, backed by `data/songdee-data.json`. Not production.
- `work/handoffs/` — cross-provider handoff artifacts (this repo uses the WORKSPACE.md convention)

## Commands

- **Package manager: `bun`** (`bun.lock`). `bun run dev` starts the local API on `:4000`
  and the Next dashboard on `:5173` together.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`)
- **Build (dashboard):** `npm run build:web`
- **Android:** `npm run android` (emulator launcher) or `npm run android:direct`
- **Migrations:** `npm --prefix web run db:migrate`; `db:check` verifies without applying.

### `npm test` does not exist

There is **no aggregate test script** — 28 separate `npm run test:<name>` entries, each a
single `node --test tests/<name>.test.ts`. `npm test` silently does nothing useful. Run the
specific tests covering your change (per the global local-test-scope rule), e.g.
`npm run test:job-flow`, `npm run test:admin-auth`, `npm run test:route-deviation`.
Tests are `.ts`/`.mjs` executed by Node's built-in runner with type stripping — needs Node 22.6+
(the Vercel project pins 24.x).

## Deploy model — auto via Vercel Git integration, UNGATED

**A push to `main` is expected to deploy production directly.** There is no
`git.deploymentEnabled` key in `web/vercel.json` (it sets only `regions:["sin1"]`), so
Vercel's documented default of `true` applies. There are **no GitHub Actions workflows**
and `main` has **no branch protection** — nothing runs typecheck or tests before a deploy.

Do **not** end a session here with a `vercel deploy --prod` command block: that would be a
second production deployment racing the git-integration one.

*Unverified:* `.vercel/project.json` proves only a CLI link, not that the Git integration
is connected. Confirm in the Vercel dashboard before relying on push-to-deploy. The README
names the deployment as `uthens-projects/ops-panel` → https://ops-panel.vercel.app with
Root Directory `web`.

## Traps

1. **The README's env-var names are stale.** It documents `FLEET_ADMIN_PASSWORD`,
   `FLEET_ADMIN_TOKEN_SECRET`, `FLEET_CORS_ORIGIN`, but the code reads the `SONGDEE_*`
   names (`web/lib/server/api.mjs:302`, `server.js:64`). `web/.env.example` is the
   accurate list. Setting the `FLEET_*` names in Vercel silently fails first-time admin
   setup. Legacy `FLEET_DATA_FM_*` names *are* still accepted for the GPS adapter only.
2. **Never point migrations at another Songdee database.** This app owns a dedicated Neon
   resource (`ops-panel-db-sg`, Singapore). `db/README.md` says so explicitly. A cross-repo
   `.env.local` naming a stale or shared DB has already caused one production outage in
   this portfolio — verify the target host before any migrate or seed.
3. **Data-FM is the only GPS/FMS source**, configured backend-only. Credentials must never
   reach the tablet or logs. `SONGDEE_DATA_FM_TIME_ZONE=Asia/Bangkok` is an explicit
   *assumption* about `tracktime` semantics, not confirmed by the provider.
4. **Repo visibility is PUBLIC** (`peuanthinsan/ops-panel`) — the only public repo in this
   portfolio. No secrets are committed today (verified 2026-09-07); keep it that way and
   treat every commit as world-readable until the visibility is decided.
5. `server.js` is dev-only. Production API behaviour lives in `web/app/api/`; changing one
   without the other drifts local and deployed behaviour apart.

## Conventions

Thai + English bilingual UI (see the global `thai-english-ui` rules). Bangkok time
throughout. Design-QA notes live at `design-qa.md`, `design-qa-mobile-action-grid.md`, and
`accessibility-audit.md`; schema notes in `db/README.md`; everything operational in `README.md`.
