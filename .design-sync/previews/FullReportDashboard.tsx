import * as React from 'react';
import { FullReportDashboard } from 'songdee-ops-panel';

// Fetch-bound dashboard. In the static preview the reports API is unreachable, so the
// component renders its shipped honest shell: header with date-range picker and print
// action, zeroed KPI stats, shared filter panel with SearchableCombobox rows, the
// embedded timeline section, and the job-list panel in its error/empty state.
export const ThaiOfflineShell = () => <FullReportDashboard lang="th" />;

export const EnglishOfflineShell = () => <FullReportDashboard lang="en" />;
