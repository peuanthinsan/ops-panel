import * as React from 'react';
import { RoutesDashboard } from 'songdee-ops-panel';

// Fetch-bound dashboard. In the static preview the job-routes API is unreachable, so
// the component renders its shipped honest shell: add-route form, deviation alert
// settings form (default 0.5 km / 60 s), error banner, and the route-list panel.
export const ThaiOfflineShell = () => <RoutesDashboard lang="th" />;

export const EnglishOfflineShell = () => <RoutesDashboard lang="en" />;
