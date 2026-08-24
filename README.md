# Songdee Ops Panel

This workspace contains the Android/Expo tablet app and the responsive fleet web dashboard.

## Run locally

Install dependencies in the repository root and in `web/`, then start the local API and Next.js dashboard together:

```sh
bun run dev
```

The primary Next.js dashboard opens at `http://localhost:5173` and the local API runs at `http://localhost:4000`. The command starts the API when needed or reuses a compatible Songdee API already running on port 4000, so dashboard login works without a second terminal. Use the local default admin password `songdee-setup`.

The command exits with a clear message if port 5173 is already occupied, which prevents accidentally opening the legacy dashboard. Either stop that process or choose an explicit alternate dashboard port:

```sh
SONGDEE_DASHBOARD_PORT=5174 bun run dev
```

If `NEXT_PUBLIC_API_BASE_URL` is set, the launcher verifies that its `/api/health` endpoint is a compatible Songdee Ops API and exits with the failing address instead of opening a dashboard that can only report “Network request failed.” It also identifies an incompatible process already occupying local API port 4000.

Run only one side when needed with `npm run server` or `npm run dev:web:5173`. The existing `dev:dashboard` script names remain aliases for compatibility.

`npm run dev:dashboard` is also available when the standard Next.js port `3000` is preferable. In local development the dashboard automatically calls `http://localhost:4000`; no API environment variable is needed.

For a running Android emulator, launch the control panel from the repository root in a separate terminal:

```sh
npm run android
```

This launcher verifies that port 4000 is serving the current API contract, chooses a free Metro port, creates the required emulator tunnels, and restarts only Expo Go without deleting the tablet's vehicle binding or queued jobs. It exits with a specific recovery message when an older API is still running instead of letting the app fail later with a generic network error or stale bundle.

For a physical Android tablet, use `npm run start`, then scan Expo's QR code. `npm run android:direct` remains available for advanced Expo troubleshooting without the emulator safeguards. Port `8081` (or the next free port selected by the launcher) is Metro's Android bundle server, not another website; opening it directly in a desktop browser is not a supported app preview. The mobile project is intentionally Android-only, so it does not expose a misleading `npm run web` command.

The Vercel-ready Next.js dashboard is in `web/`:

```sh
cd web
npm install
npm run dev -- -p 5173
```

The dashboard supports `/` for reports and `/admin` for fleet administration.

## Deploy to Vercel with Neon

The production dashboard and API are deployed at [https://songdee-ops-panel.vercel.app](https://songdee-ops-panel.vercel.app) in the `uthens-projects/songdee-ops-panel` Vercel project. Its dedicated `songdee-ops-panel-db-sg` Neon Postgres resource runs in Singapore and has the complete [`db/schema.sql`](db/schema.sql) schema applied.

For a new environment, create a dedicated Neon database, apply the schema, and create a Vercel project whose Root Directory is `web`. The Next.js dashboard and all `/api/*` Vercel Functions then deploy together under one origin. Set these Vercel environment variables:

The schema runs in one transaction and records its required version only after every table, constraint, validation, and index succeeds. `/api/health` returns an error for a missing, partial, or outdated schema, so apply the complete file again after pulling a schema change. Existing invalid active jobs, report times, or GPS coordinates intentionally stop the migration instead of being silently accepted.

- `DATABASE_URL`: the pooled Neon connection string.
- `SONGDEE_ADMIN_PASSWORD`: a 12–128 character initial fleet-admin password. It is hashed into the database only when no admin password exists yet.
- `SONGDEE_ADMIN_TOKEN_SECRET`: a random secret of at least 32 characters used to sign 12-hour admin sessions.
- `SONGDEE_CORS_ORIGIN`: the deployed dashboard origin, such as `https://ops.songdee.com`.

Changing `SONGDEE_ADMIN_PASSWORD` later does not overwrite the password saved by an administrator. Use Fleet admin to change it; that operation also invalidates every existing admin session. Do not set `NEXT_PUBLIC_API_BASE_URL` for the normal same-origin Vercel deployment.

Point production tablets at the same deployment:

```sh
EXPO_PUBLIC_API_URL=https://songdee-ops-panel.vercel.app npm run start
```

Set `SONGDEE_DRIVER_IDENTITY_API_URL` when a dedicated driver service is available. The tablet requests identity with both its current `vehicleNumber` and `deviceId`, and the server forwards both as query parameters to the adapter every 15 seconds. Responses are correlated back to the same vehicle/device pair before the app may display or snapshot that driver, so an in-flight lookup from a fleet reassignment cannot attach the previous vehicle's driver to the next job. When no dedicated driver adapter is configured, the native Data-FM integration uses the newest non-empty `driverrfid` and `drivername` in the recent vehicle-history window and caches that result for 30 seconds.

Completed and cancelled jobs are saved directly in this application's database. There is no second report-delivery POST. After a completed job is saved, the tablet asks the backend to look up Data-FM GPS around the job time; the dashboard stores and displays that coverage result independently of the job's completed status.

Set `SONGDEE_GPS_MOTION_API_URL` when Data-FM can report vehicle movement. It receives the bound vehicle context and should return `{ "moving": true|false, "speed": number }`. After confirmation, the tablet waits for that server-side movement result before recording the job start. The tablet is not a GPS source and never uses its own location to start a job.

Every configured adapter address must be an absolute `http://` or `https://` URL. A malformed driver or motion URL degrades to a correlated `misconfigured` response instead of crashing the local API; a malformed GPS address retains completed jobs and allows the Data-FM lookup to be retried.

Data-FM is the application's only GPS/FMS data source. Configure it only on the backend with `SONGDEE_DATA_FM_BASE_URL=https://www.data-fm.com`, `SONGDEE_DATA_FM_USERNAME`, `SONGDEE_DATA_FM_PASSWORD`, and an explicit `SONGDEE_DATA_FM_TIME_ZONE`. The current deployment uses `Asia/Bangkok`; this is an explicit integration assumption until the provider confirms the timezone semantics of `tracktime`. `SONGDEE_DEVICE_GPS_API_URL` remains available only as a contract-neutral fallback when Data-FM credentials are absent.

The Data-FM adapter obtains and caches the documented 24-hour token with a five-minute refresh margin, refreshes and replays once after response code 1, uses HTTPS even though the supplied examples show HTTP, and calls `GetVehicleHistory` with the exact `YYYY.MM.DD HH:MM:SS` format. If an exact history request returns no records, it resolves the vehicle case-insensitively against `GetMasterVehicleList` and retries with Data-FM's canonical identifier; for example, the fleet label `FORD T` resolves to provider vehicle `Ford T`. The master is cached for one hour. The adapter normalizes response codes safely, tolerates `vData` as either an array or the string `"[]"`, preserves RFID values as strings, and converts `speed` from km/h only at the common GPS boundary. Credentials and tokens are never sent to the tablet or written to application logs.

While a job is active, the tablet sends only the job ID, vehicle binding, and a lookup time every 60 seconds; it never sends coordinates or requests Android location permission. The backend requests Data-FM history around that time and stores the nearest valid GPS fix within `SONGDEE_GPS_PAIR_TOLERANCE_SECONDS` (60 seconds by default).

GPS samples carry the active canonical job ID. The production schema stores normalized Data-FM coordinates, GPS-fix time, speed, heading, source status, and the raw provider payload. `GET /api/admin/reports/:reportId/gps` returns that job's paginated Data-FM points and aggregate summary; the normal reports query includes per-job GPS counts for filtering and review. Legacy pairing columns remain in the schema for migration compatibility but are not shown or required by the product. Migration [`db/migrations/20260820_002_job_gps_pairing.sql`](db/migrations/20260820_002_job_gps_pairing.sql) upgrades an existing production database to GPS schema version `2026-08-20.1`.

Vehicle filters, device job history, and the tablet archive compare vehicle names case-insensitively, so historical `FORD T` and `Ford T` records are treated as one fleet vehicle. Migration [`db/migrations/20260824_006_finish_work_mode.sql`](db/migrations/20260824_006_finish_work_mode.sql) adds option 9 to active/completed job constraints. Migration [`db/migrations/20260824_007_device_job_history_pagination.sql`](db/migrations/20260824_007_device_job_history_pagination.sql) adds the lifetime-history query index and upgrades the production schema to `2026-08-24.2`.

A vehicle can be bound to multiple Android device IDs so technicians can test or operate the same vehicle from different tablets. Each Android device ID remains bound to one vehicle at a time, and jobs, signed credentials, and binding history remain device-specific. Migration [`db/migrations/20260820_003_multi_device_vehicle_bindings.sql`](db/migrations/20260820_003_multi_device_vehicle_bindings.sql) upgrades an existing database to schema version `2026-08-20.2`.

During Expo development, the tablet derives the API address from Expo's host URI: physical tablets use the development computer's LAN address and Android emulators map localhost to `10.0.2.2:4000`. `EXPO_PUBLIC_API_URL` overrides this discovery and is required for a deployed production API:

```sh
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:4000 npm run start
```

## Build installable Android releases

Ops Panel is a separate Android application from SVIS. Its package is `com.songdeedev.opspanel`, its deep-link scheme is `songdeeops`, and it is linked to the dedicated [`@peuanthinsan/songdee-ops-panel`](https://expo.dev/accounts/peuanthinsan/projects/songdee-ops-panel) EAS project (`0825171f-7773-4a62-a7f7-899e6f4d75cf`). Do not replace that ID with the SVIS EAS project ID.

If this workspace is ever intentionally moved to another Songdee Expo account, relink it explicitly and update the release-identity test:

```sh
npx eas-cli@latest init
```

Create `EXPO_PUBLIC_API_URL` in both the EAS `preview` and `production` environments, pointing to the deployed HTTPS dashboard/API origin. This value is public application configuration, not a secret. The build deliberately fails if it is absent, relative, or not HTTP(S), preventing an installable tablet build from silently calling the Android emulator gateway.

Build an internally installable APK for technician/device testing:

```sh
npx eas-cli@latest build --platform android --profile preview
```

Build a production-connected, release-signed APK for direct installation:

```sh
npx eas-cli@latest build --platform android --profile production-apk
```

The current production-connected APK is Android version code 10. Its SHA-256 digest is `42997e05db25d4ab71a667d33019285b5881a65f60a197d262f74cc7dfb4a85b`, and it is available from EAS build [`6dbc0c6c-145d-4527-a876-e8ad7a0bd30d`](https://expo.dev/accounts/peuanthinsan/projects/songdee-ops-panel/builds/6dbc0c6c-145d-4527-a876-e8ad7a0bd30d). The downloaded file is `releases/songdee-ops-panel-v0.1.0-build10-production.apk`. APK binaries stay outside Git and are ignored under `releases/`.

Build the Play Store Android App Bundle after preview verification:

```sh
npx eas-cli@latest build --platform android --profile production
```

All release profiles use EAS-managed Android version codes with automatic incrementing. The committed `extra.eas.projectId` belongs only to Ops Panel and is guarded by the release-identity test.

The local `server.js` development password defaults to `songdee-setup`. Production has no default password and requires the initial `SONGDEE_ADMIN_PASSWORD` environment variable.

## Product behavior

- A tablet asks only for a vehicle number when it has no binding. It sends its Android device ID automatically.
- Repeating setup for the same vehicle/device pair is safe and returns the existing binding instead of trapping a reinstalled tablet in a conflict.
- Once a device is bound, its vehicle can be changed or unbound only from fleet administration.
- The Android device ID is read from the device and is the only device identifier stored.
- Driver and movement lookups require that explicit Android device ID; neither backend falls back to an arbitrary first fleet vehicle when device correlation is missing.
- The tablet checks the API for an admin-updated binding when it starts, while retaining its last local binding if the API is temporarily unavailable.
- Startup paints a valid cached binding immediately and defers background job delivery until after the first interaction frame. Device credentials are shared in memory, and removal of Android location acquisition eliminates permission and sensor work from the control panel.
- If the separate local binding record is missing, a job that already started—or has a durable final turn-off/cancel payload—can reconstruct its exact vehicle/device pair from active-job recovery state and finish safely during an API outage. A selection still waiting for movement cannot do this and must revalidate against the server first.
- Jobs 1–8 use the normal on/off flow. Selecting one confirms that it is on; while selected, the other eight tiles are greyed out, and tapping it again opens one dialog with Keep job on, Cancel job, and Turn off/save choices.
- Option 9 remains `จบงาน` / “Finish work” with the exact description `ปิดงาน สรุปเที่ยววิ่ง` / “Close the job and summarize the trip,” but it is the end-of-day exception: tapping it immediately offers only Cancel or Finish and view report. Cancel makes no state or network change; Finish records the end-of-day marker without waiting for movement and opens that Bangkok operating day's report.
- The red GPS-pin logo in the tablet header opens the admin vehicle control; there is no separate Admin text button. It changes only that tablet's vehicle number, requires the fleet-admin password, refuses changes during an active job, and never stores the submitted password on the device.
- Successfully synced jobs remain in a durable tablet archive instead of disappearing with the retry outbox. There is no history-retention ceiling: the Jobs screen queries the complete current vehicle/device history in indexed 50-row pages and renders it as a virtualized list. Its bilingual search/sort/filter panel collapses without clearing active controls or loaded results. Drivers can use quick month chips or Android's native calendar and 24-hour clock dialogs to set an exact start/end range; selected values display seconds. Search, filters, sorting, counts, and recorded-time totals apply before pagination, and more pages load on demand. Daily summaries and timelines use the same paged records, and repeated uses of the same mode remain separate jobs.
- Tablet sync diagnostics use explicit labels: “Waiting to sync” means the record is queued, while “Dashboard sync failed” means the record is safely stored on the tablet but the dashboard rejected it and requires an administrator to correct the server/schema condition before retrying.
- Movement is detected only by the server-side Data-FM/motion adapter for the bound vehicle. The tablet does not read GPS. While movement is pending, it rechecks fleet-admin binding changes every five seconds and safely abandons the unstarted selection if the Android device was reassigned or unbound.
- The 3×3 control panel uses a compact, still-readable layout on short phone landscape screens and the full-size layout on tablets and portrait screens. One-time setup scrolls above the Android keyboard and supports both orientations.
- The tablet language switch covers technician setup, driver state, confirmations, recovery guidance, and driver-facing API failures in both English and Thai. Report mode values remain canonical English at the backend boundary so filtering and integrations stay stable.
- Turn-on and active-job confirmations expose a modal accessibility boundary, support the platform escape/back action, announce their heading, move TalkBack focus into that heading when opened, and return focus to the mode control that invoked them when closed.
- When movement is detected, the start timestamp is written to a durable tablet outbox and posted idempotently to the backend `active_jobs` store. Finishing or cancelling the same job closes that active record; offline reports still retain the original start timestamp.
- While a job is active, tapping its tile exposes cancellation in the same popup as the turn-off action. Once the cancellation payload is durable on the tablet, the selected tile clears and all nine jobs unlock even if the API is offline or rejects the upload; queued/rejected delivery remains visible for later synchronization or admin review. Cancelled jobs do not require a GPS lookup.
- Fleet administration blocks reassignment or unbinding while that device has an active job, protecting its timing and GPS history.
- Completed and cancelled jobs are written to the tablet SQLite outbox before upload. Drivers can continue to the next job while offline; queued reports retry every 30 seconds without creating duplicate dashboard rows.
- After a completed or cancelled report is durable, the tablet clears the active-job recovery record with a closed-marker fallback. A transient SecureStore deletion failure therefore cannot leave the driver trapped resubmitting a report with a different end time.
- Before the first turn-off or cancel network attempt, the tablet also stores the exact final report payload in active-job recovery state. Retries reuse the same report ID and timing; if the driver cancels a completion that is stuck in recovery, cancellation supersedes the local status under that same ID so the tablet can release the job without creating a duplicate.
- Start and end times display hours, minutes, and seconds on the tablet, dashboard job details, GPS drawer, and printed reports.
- Temporary network/server failures pause job-start and report outbox delivery for retry. GPS reconciliation is server-side and is retriggered by the next active-job heartbeat or the final saved report; it cannot block the driver's control flow.
- Tablet outbox migrations repair partially applied retry-diagnostic columns and allow a later database-open attempt after a transient initialization failure.
- The mounted control panel keeps the Android screen awake while the app is open.
- The web admin uses a fixed password, manages the entire vehicle/device fleet, switches English/Thai, and prints saved jobs.
- Dashboard login supports keyboard submission, invalid-password feedback returns focus to the password field, and route focus uses `preventScroll` so mobile users do not land below the global navigation. Unknown server failures fall back to localized guidance instead of leaking English into Thai mode.
- Fleet administration refreshes authoritative bindings every 30 seconds while visible and also provides a manual refresh. An in-progress vehicle edit is preserved, and late refresh responses cannot overwrite a completed add, reassignment, or unbind operation.
- Admin password changes use an atomic compare-and-replace in production. If another administrator changed the password first, the stale request is rejected and must sign in again instead of overwriting the newer password.
- The dashboard refreshes visible report data every 30 seconds, keeps search responsive, and renders saved jobs in 100-row pages. Printing formats the filtered jobs as A4 daily and vehicle report sheets.
- Each saved job includes its Data-FM GPS-point count and latest coordinate and timestamp for that job window. The dashboard exposes a Data-FM GPS status filter and a paginated per-job list of GPS fix times, coordinates, speed, and heading.
- Fleet reassignments retain binding history, allowing delayed GPS samples and queued reports to validate against the vehicle/device assignment that existed when they were captured.
- Binding-history windows use an exclusive unbind boundary, so the old and new vehicle can never both validate at the exact fleet-reassignment timestamp.
- The production schema constrains active jobs to the current vehicle/device binding, so a concurrent reassignment or unbind cannot race a new job start into an inconsistent state.
- The web wordmark reads `SONGDEE` over `OPS PANEL` with no slash and reuses the exact GPS pin artwork from the SVIS source asset.

## Backend boundary

`server.js` is the local-development API and persists to the ignored `data/songdee-data.json` file. Set `SONGDEE_DATA_FILE` for an isolated local fixture. The production API is implemented as Next.js Vercel Functions in `web/app/api/[[...segments]]/route.js` and persists to Neon using [`db/schema.sql`](db/schema.sql). Both expose the same tablet/dashboard endpoint contract and reject JSON request bodies larger than 64 KiB.

The Data-FM GPS and fallback driver mappings implement the supplied Songdee GPS API Integration Protocol v1.0. Data-FM movement and any dedicated driver service remain adapter boundaries until their exact API contracts are supplied. Completed and cancelled jobs are saved directly in this application's database; there is no separate report-delivery POST.
