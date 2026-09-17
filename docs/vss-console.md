# VSS Gateway Console

This document describes the earlier VSS prototype. The active `/gateway` route now uses the [direct Howen gateway](howen-gateway.md); the VSS polling adapter is no longer connected to that route.

Open `/gateway` in the existing web dashboard and sign in with its admin password. The console reads Howen VSS vehicle status and recent alarms through `GET /api/admin/gateway/snapshot`. The same diagnostics module serves both the Next.js API and the optional JSON-backed `server.js` API.

## Configure the API process

Set all three variables on the server that handles `/api/admin/gateway/snapshot`:

```dotenv
HOWEN_VSS_BASE_URL=https://vss.example.invalid
HOWEN_VSS_USERNAME=your-vss-account
HOWEN_VSS_PASSWORD=your-vss-password
```

Use the VSS server base URL, without `/vss`, embedded credentials, query parameters, or a fragment. The client appends the API paths. Keep these settings in a private server environment or ignored environment file; never prefix them with `NEXT_PUBLIC_`. Leaving all three unset displays the connection setup state. Partial configuration fails with a configuration error.

Optional settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOWEN_VSS_UTC_OFFSET_MIN` | `420` | VSS wall-clock timezone offset in minutes; `420` is UTC+07:00. |
| `HOWEN_VSS_TIMEOUT_MS` | `12000` | Timeout for each VSS HTTP request. |
| `HOWEN_VSS_MAX_RESPONSE_BYTES` | `16777216` | Maximum bytes per VSS response. |

The dashboard admin password and VSS account are separate. VSS credentials never log an operator into the dashboard. Both API implementations require an admin session for diagnostics and share a process-local VSS login/cache across operators.

## Run through the existing application

For the normal Next.js path, add the VSS variables to `web/.env.local`, alongside the existing `DATABASE_URL` and `SONGDEE_ADMIN_TOKEN_SECRET`. Follow the existing setup in [README](../README.md#run-locally), then run:

```sh
npm run dev:web:5173
```

Open `http://localhost:5173/gateway`. Use the database's saved admin password; `SONGDEE_ADMIN_PASSWORD` initializes an admin password only when none exists. Leave API URL overrides unset when the local Next.js process should handle the API.

For an existing separate `server.js` backend, inject the VSS settings into that backend process. Node does not automatically load a root `.env` for `server.js`; pass a private environment file or export the variables before startup. For example:

```sh
PORT=4055 node --env-file=/absolute/path/to/private-backend.env server.js
```

Start the dashboard with a same-origin proxy to that backend; an explicit empty `NEXT_PUBLIC_API_BASE_URL` overrides an older direct-browser API setting in `web/.env.local`:

```sh
SONGDEE_API_URL=http://127.0.0.1:4055 NEXT_PUBLIC_API_BASE_URL='' npm run dev:web -- -p 3055
```

Open `http://localhost:3055/gateway`. Its admin password is the value already saved in the backend's local data file, or `SONGDEE_ADMIN_PASSWORD` for first setup; it is separate from a Neon admin account. Configuring VSS only in the frontend process does not configure a separate backend. Changes to startup environment files take effect when the relevant API process restarts.

## Interpret the data

- Reads use `/vss/vehicle/findAll.action` and `/vss/alarm/findAllByTime.action`. The console does not send device commands, write settings, run automation, or open an MDVR TCP gateway.
- Raw payloads are redacted VSS API records. They are not original Howen H-protocol packets. Request details describe the VSS read request, with its token redacted. Device settings readback is unavailable.
- Each alarm collection fixes a window covering the previous 15 minutes. Reads stop at 10 pages of 500 source rows, with an elapsed-time bound between pages. The displayed event list defaults to 200 events and supports up to 500; its limit is separate from collection coverage.
- Vehicle status history is an in-memory sample of viewed devices, bounded to 50 observations per device and 20 viewed devices. Unchanged observations are deduplicated. It is not a permanent archive and resets with the API process or VSS configuration.
- Successful source reads are cached for 15 seconds. Failures retain the last successful source sample and delay the next refresh by 30 seconds. Inspect source fetch timestamps, errors, and stale indicators; a recently fetched response can still contain an old device observation.
- Missing, invalid, or unsupported values remain unknown. An unknown connection state is not offline; unknown ignition or input state is not off. Input bits describe configured VSS alarm states, not electrical levels or verified PTO activity. Unknown timestamps cannot establish current activity.

## Alarm coverage fields

Coverage describes the account-wide alarm collection before the selected-device, event-kind, and display-limit filters.

| Field | Meaning |
| --- | --- |
| `total` | Latest VSS-reported source-row total, or `null` when VSS omits it. |
| `rowsRead` | Source rows returned across accepted pages before normalization. Compare this with `total`. |
| `uniqueEvents` | Distinct normalized alarm event IDs retained. |
| `loaded` | Compatibility alias for `uniqueEvents`. Do not compare it with `total` as a completeness percentage. |
| `duplicateRows` | Valid rows whose normalized event ID was already retained. Lifecycle changes can produce separate events. |
| `skippedRows` | Rows without a usable device identity, which cannot become events. Missing observation times alone do not cause skipping. |
| `complete` | Paging reached the end without observed source-total changes. This does not certify source data quality or freshness. |
| `truncated` / `changedDuringRead` | More pages remained / the reported total changed during collection. |
| `matchingDeviceAlarms` | Retained unique alarms for the selected device. |
| `matchingEvents` / `returnedEvents` | Events after device/kind filtering / events returned after the display limit. Status observations can contribute to these counts. |

For an accepted collection, `rowsRead = uniqueEvents + duplicateRows + skippedRows`. A completed read can therefore have fewer unique events than the source total. Coverage is unavailable until an alarm collection succeeds; a failed refresh preserves coverage from the last successful alarm collection.
