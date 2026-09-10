# Publish the Windows hosting changes from Peuan's Mac

User authorization: publish the prepared Songdee Windows hosting changes through GitHub from this Mac, using its existing GitHub authentication. The target branch is main for all three repositories under peuanthinsan. Do not ask again for authorization to publish within this scope.

This bundle was prepared on the Windows server. It is also copied into the Mac's shared songdee-ops-panel repository at work/windows-deployment-publish-20260910. Work from this bundle, not from a Windows-only file path.

## What to do

1. Read the repository AGENTS.md/WORKSPACE.md contracts. Inspect current Git status and preserve user work. Use separate clean clones or worktrees for integration; Windows Git could not fully read the redirected Mac Git metadata. Do not reset, clean, stash, or overwrite the user's working checkout automatically.
2. Fetch the current main branches from the canonical repositories: peuanthinsan/dashboard, peuanthinsan/svis, and peuanthinsan/ops-panel. The songdee-prefixed URLs redirect to these repositories. All were public when verified on Windows.
3. Inspect README.md and revisions.json in this bundle. Apply dashboard.patch, svis.patch and ops.patch to their respective integration checkouts. First use git apply --check; resolve conflicts deliberately if main has advanced. The patches were exported against the exact base commits recorded in revisions.json.
4. Complete the outstanding review and validation before publishing. In particular, review the large SVIS package-lock.json regeneration and avoid unrelated dependency changes. Use the opposite-provider review required by the repository contract, if available on this Mac. Report an unavailable reviewer honestly; do not fabricate a review.
5. Validate Windows-specific behavior and existing Vercel behavior. SONGDEE_WINDOWS_HOSTING must remain opt-in outside the Windows launcher. Run Dashboard tests and Next.js build, SVIS tests plus host tests/API build/web build, and OPS Next.js build. Test the final build-settings guard. Use Node 24 or a project-compatible newer version. The hosting/build.cjs helper was written for the Windows Node/npm installation; on Mac run npm and project build commands directly, or fix helper portability deliberately.
6. Use only dummy database/auth settings for builds. Public NEXT_PUBLIC_ build values may be supplied when necessary. Do not source the Mac's production .env files into dependency installation/build processes. Never stage or commit .env files, runtime.json, credentials, tokens, or the complete handoff folder. Windows automatic review previously rejected passing live runtime credentials to unverified build code; tests succeeded with dummy settings instead.
7. Stage only the reviewed hosting changes, commit them with a clear description, and push them to main using Git's existing Mac authentication. Do not export GitHub tokens or Keychain credentials to Windows. Do not force-push. If main advances, reintegrate and rerun affected checks before pushing. Existing Vercel main-branch workflows may run on these pushes; preserve their behavior.
8. Report each pushed commit SHA, tests performed, and any unresolved issue. Publishing these patches DOES NOT enable Windows automatic deployment. Return the SHAs to the Windows task so it can finish server installation, folder standardization, and deployment/rollback verification.

## Server state to preserve

- Dashboard currently runs from songdee-host/app, service SongdeeDashboard, port 8080, local database songdee_local.
- SVIS runs from songdee-host/svis/release, service SongdeeSVIS, port 8081, and still uses the live Neon database.
- OPS runs from songdee-host/ops-panel/release, service SongdeeOPS, port 8082, local database ops_local.
- Use the Mac's existing GitHub authentication for publishing. If specific application secrets are needed later, keep them outside Git and preserve the listed Windows database targets; do not substitute an entire Mac .env file for the Windows runtime configuration.
- The shared Mac SVIS checkout reports commit 4573507 (Add shared fleet filtering across dashboard pages), while the preparation base from GitHub was 100a5ab. Inspect and preserve that difference before integration. Dashboard and OPS reported the same preparation-base commits, but Git status could not be read reliably over folder redirection.
- No production files, service settings, databases, or scheduled tasks were changed in the Windows preparation task.
- Update-Songdee.DRAFT.ps1 is a controller prototype, not a production-ready installer. Do not publish or install it as though its rollback behavior has been fully verified.

## Validation already performed on Windows

- OPS built with dummy credentials and its packaged admin page returned HTTP 200 on temporary port 18082. The test process was stopped afterward.
- Six SVIS host/forwarded-header tests passed.
- Syntax checks and PowerShell parsing passed during preparation.
- Full Dashboard/SVIS builds, final review and end-to-end deployment/rollback remain outstanding.
