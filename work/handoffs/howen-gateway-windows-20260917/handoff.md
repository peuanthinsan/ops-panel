# Howen gateway → Windows deployment handoff

> v2 includes the verified eleven-scenario simulation lab. Windows and physical-device validation remain separate gates.

Prepared 2026-09-17 for `ops.songdeegps.com`. Artifact version: `howen-windows-v2`.

**Deliverable:** deploy the direct Howen gateway and authenticated diagnostics interface as a controlled pilot. This release does not automate the 11 jobs. Local simulator-to-browser verification passed; Windows packaging, service recovery, production proxy streaming, and a physical MDVR remain unverified.

## Transfer and authority

- Source workspace: `/Users/peuan/songdee-ops-panel`, branch `main`, base commit `e888ae640b2b7fb6106f178c45fe20486c85fb66`.
- Implementation is **uncommitted**. Checking out this commit alone does not contain the gateway. `source.patch` contains the selected changes; `source-manifest.json` identifies their exact SHA-256 hashes and excluded dirty paths.
- Active author: OpenAI Codex, `/root`; exact model/effort not exposed. Receiver: Windows operator/reviewing Claude session, not yet assigned. Requested lane: **review**, followed by Windows implementation/validation under the receiving operator's deployment authority.
- No commit, push, deployment, device reconfiguration, or production credential change was performed for this handoff. The current request was to prepare a handoff. The source writer lease is released; the receiver must claim a single writer before changing these files.
- Review the frozen patch before release. Under the local workflow, the reviewing Claude session owns Git and deployment; Codex does not. No unrelated changes are authorized. Revisions invalidate this artifact's hashes and need an updated receipt.

Read `receipt.md`, `task-state.yaml`, and `source-manifest.json` alongside this document. On the same workspace, do **not** apply the patch a second time. For transfer to another machine, copy this handoff directory and obtain the repository at the base commit. Apply the patch only to an isolated clean checkout after review. Do not reset or clean the dirty primary checkout.

## What is included

```
MDVR -- H-protocol TCP :6608 --> gateway/server.mjs
  --> private journal + decoded device state
  --> private HTTP 127.0.0.1:4066
  --> existing authenticated Ops API
  --> HTTPS /gateway (server-sent events)
```

No VSS connection or WebSocket server is used by this path. The browser receives SSE through the existing Ops HTTPS endpoint; it does not poll telemetry every 60 seconds. A snapshot is fetched on initial connection/reconnect. SSE reconnection periodically rechecks the admin session.

The gateway handles registration, heartbeats, status/alarm subscriptions and acknowledgements, bounded durable packet capture, GPS/ACC/I/O decoding, available diagnostics, raw packet inspection, and live connection state. Unsupported fields retain raw evidence and decoder warnings. Incoming telemetry is stored before its ACK is sent.

Data-FM FMS is the geofence source. The already-added geofence viewer is a source dependency of the current page/API changes and is included in this patch. Its upstream access is **not confirmed**: earlier `GetGeofenceInfo` returned code 4 and web login failed. Do not describe that as a valid empty catalog. No Spark geofence data is used. The VSS client module remains only because the geofence adapter imports its redaction helper; do not remove it without updating that dependency. Inactive VSS diagnostics UI code/tests are excluded from this patch.

## Simulator coverage versus the 11 jobs

The optional Simulation tab now runs all eleven target scenarios over an accelerated virtual clock. Telemetry and alarms traverse real H-protocol TCP and the normal decoder/journal/API/SSE path. Evidence checks use received packets, with links back to captured bytes. Driver confirmation and provisional wired-input variants are selectable. A run never creates operational jobs.

| # | Scenario | Simulated evidence | Still requires real integration/confirmation |
| --- | --- | --- | --- |
| 01 | Loading | Loading zone, stopped GPS, driver or IO3 start/end, exit | Cargo-handling signal and real zone/policy |
| 02 | Unloading | Unloading zone, stopped GPS, driver or IO4 start/end, exit | Cargo-handling signal and real zone/policy |
| 03 | Waiting | Loading-zone entry, before/after dwell samples, exit | Data-FM zone, duration and stale-data policy |
| 04 | Rest break | Rest-zone entry, before/after dwell samples, exit | Real zone and rest policy |
| 05 | Vehicle check | Synthetic checklist, odometer and driver confirmation | Actual mobile form and evidence persistence |
| 06 | Refuelling | Stopped fuel-zone GPS, raw fuel baseline/noise/sustained rise | Sensor availability/calibration, physical units and real station |
| 07 | Car wash | Wash-zone GPS and labelled mock media outcome | Real camera command, transfer and saved evidence |
| 08 | Overnight parking | Safe-zone dwell, ACC off, SOS remains a separate emergency | Actual safe zone, dwell/time policy and wiring |
| 09 | Job complete | Prior required sandbox results, stopped endpoint, driver confirmation | Production job rules and write integration |
| 10 | SOS/emergency | IO1, emergency flag, event code 5, duplicate/start/end/release | Panic wiring and actual alert delivery |
| 11 | Snapshot button | Separate IO2, duplicate/start/end/release and one mock capture | Button wiring, real camera and media storage |

The application still has nine job modes. Concept 02 Unloading maps to app mode 3; concept 03 Waiting maps to mode 2. SOS and Snapshot are separate events, not newly added tablet modes. The lab's geofence circles are **synthetic**, not Spark or imported Data-FM boundaries. Forms and media are explicitly simulated software events. See `docs/howen-simulation.md` for the source labels and limitations.

**ACC means ignition, not PTO.** PTO is power take-off and is relevant only if the vehicle has that equipment and reports its state. Manual removal of cargo cannot be inferred from ignition. Fuel readings remain raw protocol units, not asserted litres. Wiring, sensors, actual geofence access and the production automation engine remain unverified/unimplemented.

The basic `gateway/simulator.mjs` CLI remains a simpler one-input demonstration. The eleven-scenario lab is controlled through the authenticated dashboard, is disabled by default, and can only be enabled with a loopback TCP listener and explicitly labelled/admitted `SIM-HOWEN-001`. Do not run the independent demo and the lab simultaneously. Lab results are in memory; save evidence before a service restart. Simulated packet history remains in the bounded journal.

## Review and build

1. Preserve all unrelated dirty work. Use the manifest to review only the supplied patch and its dependencies. Get the reviewed source onto the receiver's clean build checkout; do not deploy the entire dirty Mac directory.
2. Inspect the actual Windows service/controller, proxy, current release, runtime-config location, service account, free ports, and rollback mechanism. These deployment details were not available locally. Record them in the receiver's receipt.
3. Use Node **24** with npm. Prefer a Windows build host matching the server architecture for the Windows web artifact; do not assume Mac-built native dependencies are portable.
4. Run `npm run test:gateway` and `npm run test:simulation` on the candidate source. The source handoff also includes the focused geofence test: `node --test tests/geofence-source.test.mjs`. Let CI/build run the repository's required packaging checks; do not substitute a broad local test rerun for deployment validation.
5. Build the web package with the existing helper. It rejects active `.env` files in both root and `web`; use an isolated clean source export, **not deletion of the developer's local config**. The output must be absent and outside the checkout.

Example PowerShell paths below are a proposed layout, not discovered server paths. Replace them to match the installed controller. All commands in this document are operator instructions, not commands already executed on Windows.

```powershell
Set-Location 'C:\Songdee\src\ops-reviewed'
node --version
npm run test:gateway
if ($LASTEXITCODE -ne 0) { throw 'Gateway tests failed' }
npm run test:simulation
if ($LASTEXITCODE -ne 0) { throw 'Simulation tests failed' }
node hosting/build.cjs 'C:\Songdee\build-settings\ops-public.json' 'C:\Songdee\releases\ops-howen-v2'
if ($LASTEXITCODE -ne 0) { throw 'Web packaging failed' }

# The build helper packages the web app ONLY. Package the gateway separately.
New-Item -ItemType Directory -Path 'C:\Songdee\releases\howen-v2\gateway' -ErrorAction Stop
Copy-Item -Path 'gateway\*.mjs' -Destination 'C:\Songdee\releases\howen-v2\gateway' -ErrorAction Stop
```

`ops-public.json` contains public build values only. For same-origin browser API routing use `{"NEXT_PUBLIC_API_BASE_URL":""}` and preserve any other required public values. If shipping the geofence map, include the already-authorized browser Maps key in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and verify its website restrictions for `ops.songdeegps.com`. Never put gateway keys, database credentials, or Data-FM passwords into this file.

`hosting/build.cjs` installs web dependencies, runs Windows-hosting/admin-auth/database-schema/production-API-boundary checks, builds Next, and packages the standalone server. It does not package `gateway/`. The gateway package must include all six modules: `server.mjs`, `store.mjs`, `protocol.mjs`, `simulator.mjs`, `simulation-lab.mjs`, and `simulation-scenarios.mjs`, even when the lab is disabled. The gateway needs only Node built-ins; no Expo/root dependency install is needed to run that separate service.

## Protected configuration

Generate a new random shared key of at least 24 characters for Windows. Store it outside Git/releases in the gateway's protected environment file and the Ops API's protected runtime config. Use Windows ACLs granting only the service account and administrators the needed access; POSIX `chmod` in Node is not a Windows ACL policy. Do not copy local temporary configs, passwords, keys, journals, `.env` files, or build dummy credentials.

Example `C:\ProgramData\Songdee\Howen\gateway.env` for the **loopback simulator pilot**:

```dotenv
HOWEN_GATEWAY_TCP_HOST=127.0.0.1
HOWEN_GATEWAY_TCP_PORT=6608
HOWEN_GATEWAY_HTTP_PORT=4066
HOWEN_GATEWAY_API_KEY=<NEW_RANDOM_PRIVATE_KEY>
HOWEN_GATEWAY_DATA_DIR=C:/ProgramData/Songdee/Howen/pilot-data
HOWEN_GATEWAY_ALLOWED_DEVICES=SIM-HOWEN-001
HOWEN_GATEWAY_SIMULATED_DEVICES=SIM-HOWEN-001
HOWEN_GATEWAY_ENABLE_SIMULATION=1
```

Merge these fields into the protected runtime configuration of the process actually serving the Ops API, retaining all other production settings:

```json
{
  "HOWEN_GATEWAY_URL": "http://127.0.0.1:4066",
  "HOWEN_GATEWAY_API_KEY": "<THE_SAME_NEW_RANDOM_PRIVATE_KEY>"
}
```

For the normal packaged Next release this is its existing `SONGDEE_CONFIG` JSON. If the current installation sets `SONGDEE_API_URL` to a separate backend, first trace that routing and configure the backend instead. The gateway client permits loopback origins only, so that API process and gateway must run on the same host. Do not set `SONGDEE_API_URL` to the application's own public endpoint or blindly copy local preview routing.

Preserve production database URLs, auth secrets, admin account, encryption settings and integrations. No database migration is introduced by this gateway stage. The root `server.js` used in local JSON-backend tests is **not** the packaged production web entrypoint. Do not replace production PostgreSQL with local test JSON storage or change the production admin password.

## Start and validate a Windows pilot

Start the gateway in a foreground operator session first:

```powershell
& 'C:\Program Files\nodejs\node.exe' '--env-file=C:\ProgramData\Songdee\Howen\gateway.env' 'C:\Songdee\releases\howen-v2\gateway\server.mjs'
```

After the candidate web service is running, use `/gateway` → **Simulation** → **Run all 11**. As an alternative basic wire test only, the command below runs the older one-input demo for two minutes; do not run it while the lab is active:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Songdee\releases\howen-v2\gateway\simulator.mjs' --host 127.0.0.1 --port 6608 --duration 120
```

Launch the candidate web release through the installed controller using `hosting/launch.cjs` and `SONGDEE_CONFIG`. The package launches `web/server.js`, binds loopback, and accepts `SONGDEE_CANDIDATE_PORT` for candidate validation. Follow the existing controller's cutover procedure only after checks pass; this handoff does not supply or install that controller.

Acceptance checks:

- Private `http://127.0.0.1:4066/health` returns 401 without the key; with the protected bearer key it reports `source: howen`, gateway `listening`, storage `ok`. Do not log the key or full authorization header.
- Existing Ops admin sign-in works. `/api/admin/gateway/snapshot` and `/api/admin/gateway/events` reject requests without admin authentication.
- In the Simulation tab, all eleven scenarios pass in both confirmation variants. Inspect actual/expected evidence and source labels. Running Job complete alone must fail missing prerequisites. Stop/rerun controls must recover.
- At the candidate `/gateway`, `SIM-HOWEN-001` is clearly marked simulated. GPS/ACC/I/O update, packet counts increase, and alarm start/end plus outgoing `0x4041`/`0x4051` ACKs appear. Raw packet export matches the selected record.
- Through the actual production proxy, browser requests receive `text/event-stream` chunks promptly. Check buffering, compression and idle timeouts. Server heartbeats occur every 15 seconds; the authenticated bridge reconnects after at most five minutes. This must not become delayed/batched 60-second updates.
- Stop the lab/demo: device becomes disconnected, packet history stays visible. Run again: reconnect succeeds. Stop/restart the gateway: history survives, devices remain offline until they register again.
- Check existing reports/fleet pages and production login still work. Capture deployment evidence without secrets. No automatic job or camera command should occur.

## Windows service readiness gate

The repository has no installed gateway Windows service wrapper. The CLI implements `SIGINT`/`SIGTERM` shutdown; validate the selected wrapper actually lets `gateway.stop()` flush state and release `writer.lock`. Plain `node.exe` is not by itself an SCM service implementation.

**Unattended crash recovery is not proven.** Forced termination can leave `writer.lock`; the next start intentionally refuses that directory. Startup CLI logging currently gives a generic failure message, so inspect the private data directory and service logs when diagnosing startup. Node documents that Windows `process.kill()` with SIGINT/SIGTERM unconditionally terminates a process; do not assume those calls exercise graceful cleanup ([Node 24 signal documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events)).

Before declaring the service production-ready, demonstrate normal service stop/start, restart after OS reboot, journal recovery, and forced-crash behavior under the actual wrapper. If automatic recovery is required, implement/review a safe service lifecycle or lock-recovery mechanism first. A restart policy alone does not solve the stale lock. For manual recovery, confirm the exact previous gateway process has stopped and no writer is active before removing **only** the stale `writer.lock`; retain the journal. Never delete a live lock or automatically clear it on every startup.

Configure least-privilege service identity, protected log capture/rotation, persistent data outside release folders, and service monitoring. One instance only may own a data directory. The current bounded journal is diagnostic history, not a permanent fleet archive.

## One physical MDVR, then expand

1. Confirm the MDVR model/firmware, exact device identifier, current endpoint and availability of a secondary server connection. Record rollback values before changing a device. Confirm the intended network route can carry raw TCP.
2. Stop the lab/demo and disable `HOWEN_GATEWAY_ENABLE_SIMULATION` (unset it or set `0`). Change the gateway to a dedicated persistent real-device data directory, exact real-device allowlist and empty simulated-device list. Bind to the appropriate server interface (for example `0.0.0.0`) only when network controls are ready.
3. Expose **only the TCP device port** (proposed 6608, verify availability) through the Windows firewall/NAT/APN or an appropriate TCP tunnel. Keep private HTTP 4066 on loopback. The existing HTTPS site/tunnel does not establish reachability of raw TCP; the website's port does not need to change.
4. Under the operator's device-change authority, configure one MDVR with the reachable TCP host/IP and port. A device ID allowlist is not cryptographic authentication; apply the intended network access controls.
5. Verify real registration `0x1001` / response `0x4001`, status subscription `0x4040`, alarm subscription `0x4050`, uploads `0x1041` / `0x1051` and their ACKs, valid location/time, signal freshness, disconnect/reconnect, and observed reporting cadence. A connected socket alone is not a telemetry pass.
6. Physically toggle each intended input with the installer. Record device channel, electrical polarity and meaning (panic, snapshot, loading sensor, etc.). Do not identify an unknown input as PTO, or fuel raw units as litres. Confirm actual sensor availability and code mappings from captured packets.

Only then consider a larger pilot. Default implementation caps are 256 retained devices and 256 concurrent device connections, with no eviction of historical device IDs; no fleet-capacity/load claim has been validated. Initial subscriptions request status groups 0–8, not every possible parameter. Video/snapshot control and arbitrary parameter readback are not implemented.

## Rollback

- Record the current web release and protected config backup before cutover. Roll back with the existing controller, restoring the previous config if changed. Keep the production database and auth data intact.
- Stop the gateway through the validated lifecycle. Preserve its journal and logs outside releases; never start an old and new instance against the same directory.
- If the pilot MDVR endpoint was changed, restore its recorded previous values and verify the original downstream service receives data again.
- Remove only firewall/tunnel/service changes introduced for this pilot when appropriate. Do not modify unrelated services. Keep the prior web release available until acceptance is complete.

The receiving operator's receipt must identify reviewed commit/artifact hash, actual Windows paths/service/proxy, configuration keys changed (not values), build/test results, browser streaming evidence, service lifecycle results, physical-device results or explicit deferral, and rollback outcome. Successful simulator validation must remain labelled separately from physical MDVR and 11-job acceptance.
