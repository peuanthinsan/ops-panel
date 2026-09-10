# Songdee Windows deployment preparation — NOT ENABLED

Prepared 2026-09-10. No GitHub commits were pushed. No Windows services, production folders, databases, or scheduled tasks were changed.

## Consistent layout

Dashboard was deployed first under `C:\Users\gps01\songdee-host\app`. SVIS and OPS later adopted a release subdirectory. This is historical, not a framework requirement.

Proposed layout under `C:\Users\gps01\songdee-host`:

```
dashboard/release, dashboard/secrets, dashboard/backups, dashboard/logs
svis/release,      svis/secrets,      svis/backups,      svis/logs
ops-panel/release, ops-panel/secrets, ops-panel/backups, ops-panel/logs
```

Dashboard's service, environment storage and maintenance/backup scripts must be updated together. Merely renaming `app` would break references. Existing files have not been moved.

## Repositories and trigger

The supplied songdee-prefixed URLs redirect to these public repositories:

- https://github.com/peuanthinsan/dashboard — main
- https://github.com/peuanthinsan/svis — main
- https://github.com/peuanthinsan/ops-panel — main

The proposed controller checks main once per minute from Windows. It is independent of Remote Desktop and does not expose a webhook or register a GitHub Actions runner on the production server.

## Files

- `dashboard.patch`, `svis.patch`, `ops.patch`: locally prepared hosting changes against the exact revisions in `revisions.json`. Review before applying. They have not been published.
- `Update-Songdee.DRAFT.ps1`: an uninstalled controller prototype, not a ready-to-run installer. It requires validated service paths, public build settings, protected runtime settings, and a deployed-revision state file for each app.

The patches carry forward specific Windows hosting adapters from the previous deployment. Unrelated changes found in the previous staging copies were not copied over. SVIS's dependency lockfile regenerated substantially and still needs review.

Windows-only Next.js behavior is gated by SONGDEE_WINDOWS_HOSTING=1 to preserve the existing cloud path. Production credentials must not be supplied to the build: it accepts only NEXT_PUBLIC_ settings and uses dummy database/auth values. The runtime launcher reads the server's separate protected configuration.

## Validation completed

- OPS compiled successfully using dummy credentials and an unavailable dummy database endpoint.
- Its packaged admin page returned HTTP 200 on test port 18082; the test process was then stopped.
- Six existing SVIS host/forwarding tests passed.
- JavaScript syntax checks and PowerShell parsing passed during preparation.

The final public-build-settings guard was added after the successful OPS compile. Full Dashboard/SVIS builds, end-to-end deployment/rollback, final code review, and the standardized service setup are not yet validated. The required opposite-provider review was unavailable; no Claude executable was found in the checked locations. This is not a deployment approval or a claim of production readiness.

Automatic approval review rejected a build using live OPS runtime credentials because it could expose secrets to unverified dependency/build code. The successful validation instead used dummy settings. No live credentials are included in this bundle.

## Remaining work

1. Review the patches and complete all app builds, hosting tests and deployment rollback tests.
2. Publish the reviewed changes to the repositories. GitHub read access works on this machine, but no write credential was available. Sign in on Windows or apply and publish from the Mac.
3. Create protected server configuration and build/staging folders; prepare and test the migration of Dashboard from app to dashboard/release. Preserve database targets, existing secrets, port mappings and backups.
4. Install the controller as a Windows scheduled task with appropriate permissions, persist logs, and initialize state from the exact first deployed commit. Leave it disabled until initial activation/rollback is verified.
5. Verify a subsequent main push deploys the intended app, and verify behavior after Remote Desktop disconnect and Windows reboot.

The current one-instance services require a short restart. Database migrations and public ngrok activation remain separate operations. Do not rerun the original fresh-database installers as part of a feature deployment.
