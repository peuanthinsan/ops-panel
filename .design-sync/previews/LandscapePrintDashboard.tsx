import * as React from 'react';
import { LandscapePrintDashboard } from 'songdee-ops-panel';

// Fetch-bound print view. In the static preview the reports API is unreachable, so the
// component renders its shipped print-state shell (GPS-pin brand mark with the
// preparing/could-not-open message and retry button). Realistic one-day filters match
// how the reports page opens this view.
export const ThaiFleetDayShell = () => (
  <LandscapePrintDashboard lang="th" filters={{ startDate: '2026-08-20', endDate: '2026-08-20' }} />
);

export const EnglishFleetDayShell = () => (
  <LandscapePrintDashboard lang="en" filters={{ startDate: '2026-08-20', endDate: '2026-08-20' }} />
);
