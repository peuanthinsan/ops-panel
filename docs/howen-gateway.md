# Direct Howen gateway

The `/gateway` dashboard reads the direct H-protocol gateway. MDVRs connect to its TCP listener; the gateway handles registration, heartbeats, status/alarm subscriptions and acknowledgements, stores packet records, and streams snapshots through the authenticated Ops API to the browser. There is no VSS connection, WebSocket server, or periodic telemetry polling in this path.

This first stage is a diagnostic interface. It does not start or finish operational jobs, change MDVR settings, retrieve video, or evaluate production geofence rules. An optional loopback-only [eleven-job simulation lab](howen-simulation.md) exercises synthetic scenarios and shows the evidence for sandbox checks. The separate `/geofences` viewer still reads existing Data-FM FMS boundary definitions.

## Processes and ports

| Process | Example local address | Purpose |
| --- | --- | --- |
| Gateway TCP listener | `127.0.0.1:6608` | H-protocol device connections |
| Gateway private HTTP listener | `127.0.0.1:4066` | Authenticated snapshot and event stream |
| Existing Ops backend | Existing configured port | Admin authentication and gateway proxy |
| Existing Ops website | `https://ops.songdeegps.com` in production | Dashboard over its existing HTTPS connection |

The two gateway listeners are part of one separate Node process. The private HTTP listener must remain on loopback. A device connects to the dedicated TCP address/port, not an HTTPS URL or `/gateway` web route. An HTTP tunnel for the website does not by itself expose the TCP listener.

## Private runtime configuration

Use Node 24. Keep gateway settings outside Git and release directories. For example, create a private environment file with:

```dotenv
HOWEN_GATEWAY_TCP_HOST=127.0.0.1
HOWEN_GATEWAY_TCP_PORT=6608
HOWEN_GATEWAY_HTTP_PORT=4066
HOWEN_GATEWAY_API_KEY=replace-with-a-random-private-key-at-least-24-characters
HOWEN_GATEWAY_DATA_DIR=/absolute/private/path/howen-data
HOWEN_GATEWAY_ALLOWED_DEVICES=SIM-HOWEN-001
HOWEN_GATEWAY_SIMULATED_DEVICES=SIM-HOWEN-001
```

Use an absolute Windows data path when running on Windows. Set restrictive filesystem permissions/ACLs for the service account: captured packets contain operational data. Start the gateway with:

```sh
node --env-file=/absolute/private/path/howen.env gateway/server.mjs
```

Configure the existing Ops **API process** with the same private key:

```dotenv
HOWEN_GATEWAY_URL=http://127.0.0.1:4066
HOWEN_GATEWAY_API_KEY=the-same-private-gateway-key
```

When using Next.js directly, these belong to the Next server runtime. When `SONGDEE_API_URL` points to a separate backend, they belong to that backend. Never prefix either setting with `NEXT_PUBLIC_`. Both the standalone JSON backend and the Next API require an admin session before exposing gateway data. Stream connections periodically reconnect through that admin check.

For a real-device pilot, configure the exact device ID allowlist, remove simulator IDs, and expose only the TCP listener through the Windows firewall/network. A non-loopback TCP listener requires a nonempty allowlist. Device IDs are an admission filter, not cryptographic proof of device identity; use the intended trusted network/APN or network access controls for the pilot. Confirm the device's server configuration and whether a secondary connection is supported before repointing a device that other systems depend on.

## What the dashboard proves

The dashboard separates browser stream health from MDVR connection state. It shows received and sent packets, decoded GPS/ACC/I/O, available diagnostics, registration/subscription information, receipt and source timestamps, decoder warnings, and raw header/payload hex. ACC is not labelled PTO, and input numbers have no assumed truck-specific meaning.

Capture and display are bounded. Raw payloads can be truncated; the packet reports its original length and truncation flag. The dashboard snapshot can contain fewer packets than the journal; inspect retention counts. This journal is a diagnostic history, not an unlimited fleet archive. Replayed devices are offline until a new TCP connection registers them.

Unknown or missing fields remain unknown. A successful TCP connection does not establish valid GPS, functioning fuel sensors, or correct input wiring. The initial subscription requests status groups 0–8. Other packet types and unsupported status extensions remain visible with decoder notes; arbitrary device parameter readback is not implemented.

The H-protocol document contains an altitude-unit inconsistency between its field table and worked example. Until confirmed on hardware, the decoder preserves the raw altitude rather than publishing a guessed metre value.

Only one gateway process may write a data directory. An exclusive `writer.lock` protects journal replay and compaction. A normal stop removes it. After a forced termination, startup can report a stale lock: first confirm the recorded process has stopped, then remove that lock and restart. Never remove a lock belonging to a running gateway.

## Verification and rollout

Run only the gateway tests:

```sh
npm run test:gateway
```

The simulator connects over real TCP and sends registration, binary status, input alarms, and heartbeats. Mark its ID explicitly in `HOWEN_GATEWAY_SIMULATED_DEVICES`; the dashboard displays simulation labels. Simulator verification exercises the transport, decoder, journal, API, and browser stream. It is not evidence of a physical MDVR connection.

```sh
npm run gateway:simulate -- --host 127.0.0.1 --port 6608 --duration 120
```

Open `/gateway`, sign in with the existing Ops admin password, and select `SIM-HOWEN-001`. Verify that received counts increase, GPS/ACC/I/O change, alarm start/end packets appear, and outgoing `0x4041`/`0x4051` acknowledgements are visible. When the simulator stops, the device becomes disconnected and its captured history remains available.

For Windows, package the `gateway/` directory as a separate Node service with its protected configuration and persistent data directory. Existing `hosting/build.cjs` packages the website only. Configure service recovery and validate raw TCP reachability, stream proxy buffering/timeouts, restart recovery, real-device reporting cadence, and input wiring before expanding beyond a test device. Database migrations and automated job changes are outside this first-stage release.
