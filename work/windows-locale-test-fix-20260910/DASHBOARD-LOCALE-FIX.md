# Dashboard Windows test correction

The restricted Windows build worker now starts correctly. Its first real Dashboard build reached the unit tests: 509 passed and one failed because this Windows account uses `th-TH` collation. The test expected English punctuation ordering for `F&D`, `False alert`, and `Fatigue`.

The attached `dashboard-windows-locale-test.patch` changes only `app/dashboards/simpleSummaryData.test.ts`. It checks that all twelve expected labels are present and that the result contains exactly twelve labels. Production source, sorting behavior, settings, and secrets are unchanged.

Base: `peuanthinsan/dashboard` main `16704b72a47838fc737e471a24b260f211856b0a`.

The corrected full unit suite passed on native Windows: **510 tests across 39 files**. The Next.js production build and standalone release packaging also completed successfully, using dummy database/auth settings and no production credentials.

## Mac publication handoff

Use the Mac's existing GitHub authentication. Apply this patch in a separate clone from current Dashboard main, first checking that it still applies cleanly. Inspect and stage only the named test file. Run the relevant tests and existing CI gates, then publish normally without force-pushing. Follow repository branch protection and review requirements. Return the final Dashboard main SHA to the Windows task.

Do not modify the original Mac Dashboard, SVIS, or OPS working trees. No secret transfer is needed for this patch.

Windows must verify the new commit directly from GitHub, confirm that the only change since the reviewed base is this test correction, then update the protected initial Dashboard SHA and rerun its restricted build and candidate health checks. The live service must remain on its old release until those checks pass. Automatic deployment and cleanup remain gated on successful initial verification of all three applications.
