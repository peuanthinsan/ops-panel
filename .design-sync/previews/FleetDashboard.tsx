import * as React from 'react';
import { FleetDashboard } from 'songdee-ops-panel';

// Fetch-bound dashboard. In the static preview the admin API is unreachable, so the
// component renders its shipped honest shell: page header, import/export actions,
// add-device form, search field, error banner, and the GPS-pin empty state.
export const ThaiOfflineShell = () => <FleetDashboard lang="th" />;

export const EnglishOfflineShell = () => <FleetDashboard lang="en" />;
