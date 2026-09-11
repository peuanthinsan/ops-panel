# Latest Dashboard Windows result — 2026-09-10, 19:29 Bangkok

Latest GitHub main is `2aa3f15d97916f585850c0969c92f97fb69aca74` (authentication request-constructor fix, PR #256). GitHub gates and production deployment checks passed.

The real restricted Windows build of this exact SHA completed: **512 tests passed; one failed**. The failure remains `app/dashboards/simpleSummaryData.test.ts`, the twelve-label assertion that assumes English punctuation ordering instead of this Windows machine's Thai ordering.

The existing `dashboard-windows-locale-test.patch` still applies to latest main. The test file has exactly the same Git blob as the earlier base `16704b72a47838fc737e471a24b260f211856b0a`. Preserve the newer authentication fix when publishing the locale correction; use a normal fast-forward or protected PR merge, without force-pushing. No production settings or application behavior changes are needed.

Windows has already activated and verified SVIS and OPS at their published SHAs. Dashboard remains running on its prior release until the corrected GitHub main passes the restricted build and candidate check. Automatic deployment is still disabled pending that final activation.
