# Handoff receipt — v2

Author: OpenAI Codex `/root`; exact model/effort UNKNOWN. Date: 2026-09-17. Artifact: `howen-windows-v2`.

The direct gateway now includes a loopback-only simulation lab covering all eleven proposed activities. Telemetry and alarms traverse real TCP and the decoder/journal/Ops API/SSE path; synthetic zones, driver forms, media outcomes and provisional rules are labelled separately. No operational job records were changed. No commit, push, deployment, production database mutation or physical device reconfiguration was performed. Local preview services were restarted with the lab enabled and a separate simulation journal.

## Scope and ownership

Source is uncommitted on base `e888ae640b2b7fb6106f178c45fe20486c85fb66`. `source.patch` and `source-manifest.json` freeze the selected source; unrelated dirty files are listed and excluded. Root owns the API/control integration and documentation; delegated agents implemented the simulator, lab/evaluator and UI in disjoint files. All implementation writers have finished; the writer lease is released to the receiver.

Read the gateway, simulator, evaluator, Ops bridge/routes/dashboard, focused tests, geofence dependency, and Windows hosting build/launch documentation. The reviewing Claude/operator still needs to perform opposite-provider implementation review before deployment. Same-provider independent review found and resolved startup/shutdown and scenario-evaluation races/false positives; that is not represented as Claude approval.

## Verification

- **25/25** dedicated tests passed using `npm run test:simulation` on final source: ten simulator tests, ten lab/evaluator tests and five authenticated control/API tests.
- **9/9** gateway service/journal regression tests passed after startup/shutdown changes.
- **9/9** gateway client tests passed, including command allowlisting, private-key routing, disabled/conflicting run errors and stream cleanup.
- The prior diagnostic implementation phase had **46/46** gateway tests passing. That entire suite was not rerun for this scoped change; the targeted results above are the current proof.
- Negative cases include incorrect zones/mappings, omitted work completion, insufficient/invalid-time dwell, invalid GPS, raw fuel noise, missing form/media, missing/contradictory alarm identity, release ordering, an earlier visit's exit, and absent completion prerequisites.
- Browser flow: local `/gateway` → Simulation → Run all 11 → inspect evidence/raw packet → run Job complete alone → see prerequisite failure → run all with wired confirmation → stop/rerun. All eleven pass in both confirmation variants; controls recover; no snapshot polling or JavaScript exceptions were observed.
- Browser environment: installed Chrome via bundled Playwright; Browser plugin not available. Desktop 1505×1100 (final capture 1505×1180), mobile 390×844. Page identity, meaningful content, absence of framework overlay/errors, horizontal overflow, source labels, captured-packet links and real control state changes checked.
- Final local run state and source hashes are in `evidence/simulation-final-state.json` and `evidence/simulation-final-proof.json`; broader interaction proof is in `evidence/simulation-browser-proof.json`. Screenshots show desktop and mobile. These are simulator evidence, not Windows/hardware certification.
- Syntax checks and `git diff --check` passed. `artifact-verification.json` records patch reconstruction and source hash validation in isolated temporary copies without modifying the repository index.

## Remaining gates

Windows production build, proxy streaming, service stop/reboot/crash recovery, and physical MDVR reporting/wiring remain unverified. Forced termination can leave `writer.lock`; no service wrapper or automatic lock-recovery solution is included. Data-FM FMS geofence access remains unresolved upstream. Production job automation, mobile evidence persistence and real camera command/media transfer remain outside this release.

The simulator does not prove those external integrations. Fuel remains raw units; synthetic input assignments are not installer instructions; ACC is not PTO. Nine current job modes are preserved; SOS and Snapshot are events. Both confirmation options are available because real loading/unloading sensing has not been identified.

Ready for frozen-source review and a controlled Windows simulator pilot after packaging and configuration validation. The receiving operator must record actual service paths/proxy/network, test results, physical-device acceptance or explicit deferral, and rollback evidence. Any source/scope change invalidates this receipt's frozen hashes.
