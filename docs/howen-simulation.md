# Eleven-job simulation lab

The lab exercises the data needed for the eleven proposed buttons: nine job scenarios plus SOS and Snapshot events. It is an isolated test run, not production job automation. It never calls the operational job-write APIs, Data-FM, VSS, or a real camera.

## Run locally

Use the normal gateway service and Ops API configuration in `howen-gateway.md`, with these additional gateway settings:

```dotenv
HOWEN_GATEWAY_TCP_HOST=127.0.0.1
HOWEN_GATEWAY_ALLOWED_DEVICES=SIM-HOWEN-001
HOWEN_GATEWAY_SIMULATED_DEVICES=SIM-HOWEN-001
HOWEN_GATEWAY_ENABLE_SIMULATION=1
```

Stop any independently running `gateway/simulator.mjs` demo first. The lab owns its simulator connection for the duration of a run. Open `/gateway`, sign in as an Ops admin, and choose **Simulation**. Run all scenarios or inspect an individual one. Loading/unloading confirmation can use either simulated driver confirmation or a provisional dedicated input; neither is a confirmed truck installation.

The lab is disabled by default. Enabling it requires a loopback TCP listener and explicit admission/simulation labelling of `SIM-HOWEN-001`. It cannot be enabled on the public TCP listener for real trucks. Admin authentication and the private gateway bearer key are required to operate it. Run state is temporary and resets on service restart; actual simulated wire packets remain in the gateway's bounded diagnostic journal.

## Evidence sources

| Label | What it proves |
| --- | --- |
| Howen TCP | A simulated MDVR sent an H-protocol packet, the gateway decoded/stored it and acknowledged it. Checks reference received packet IDs. |
| Simulated geofence | Decoded GPS was compared with a synthetic test circle. These are not imported or verified Data-FM boundaries. |
| Simulated app | A test driver confirmation or vehicle-check submission was supplied. No real tablet form was submitted or saved. |
| Simulated media | A test capture result was supplied. No actual MDVR camera command, photo upload or video retrieval occurred. |
| Simulation rule | Sandbox evaluation of the other evidence under the displayed provisional rules. This does not change operational jobs. |

The clock is accelerated: minutes/hours of source time can pass in seconds of wall time. Stationary samples hold their coordinates. View both the virtual time and the packet's source/receipt times when interpreting results. A passed scenario means the test data met its sandbox requirements; it does not establish production readiness or a real-world job completion.

## Coverage and mapping

The number on the concept image is not always the current application's mode number.

| Concept # | Scenario | Existing application mode | Data required |
| --- | --- | --- | --- |
| 01 | Loading | 1 · Load | Loading zone, stopped GPS, driver confirmation or mapped loading input, end evidence |
| 02 | Unloading | 3 · Unload | Unloading zone, stopped GPS, driver confirmation or mapped unloading input, end evidence |
| 03 | Waiting | 2 · Stop vehicle | Loading zone, stationary samples across a dwell threshold |
| 04 | Rest break | 4 · Break | Rest zone, stationary samples across a dwell threshold |
| 05 | Vehicle check | 5 · Vehicle check | Simulated completed check submission; missing checks must not pass |
| 06 | Refuelling | 6 · Refuel | Fuel station, stopped GPS, fuel balance change above the simulated noise threshold |
| 07 | Car wash | 7 · Vehicle wash | Wash zone and a simulated capture result |
| 08 | Overnight parking | 8 · Park overnight | Safe zone, stationary dwell and ignition off; SOS remains a separate emergency |
| 09 | Job complete | 9 · Finish work | Required preceding scenario evidence, endpoint and completion confirmation |
| 10 | SOS / emergency | Separate event | Dedicated panic input, emergency alarm, valid location and matched start/end |
| 11 | Snapshot button | Separate event | Different input, press/release and a simulated capture result |

I/O assignments are fixtures, not a wiring specification. ACC is ignition; it is not PTO, proof of engine RPM, or proof of cargo handling. Fuel balance is reported in raw protocol units; a rise is not asserted to be a number of litres. Sensor calibration, actual wiring/polarity, device capabilities, thresholds, and real Data-FM geofences must be confirmed before implementing production rules.

The existing tablet API has nine modes and does not yet persist the proposed checklist/media/fuel evidence fields. The lab intentionally preserves the current mode contract. Implementing and validating those production adapters and the operational automation engine is a later task.

## Validation

`npm run test:simulation` runs the dedicated simulator, scenario and control/API checks. These are targeted tests, not the full repository suite. Browser verification must exercise run-all, individual scenario selection, evidence inspection, stop/rerun, desktop/mobile layout and live SSE updates. Negative cases must remain failed or pending rather than receiving a success label merely because a script reached its final step.

The Windows handoff's v2 artifact includes this simulation work; its v1 source snapshot is superseded. Review the refreshed source artifact before deployment. A simulator pass does not resolve the Windows service recovery, raw TCP routing, physical MDVR, or live Data-FM access checks.
