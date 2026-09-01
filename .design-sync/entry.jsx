// design-sync entry barrel — re-exports the scoped Songdee Ops Panel web components.
// Composition only: every export is the app's real shipped component (web/app/*.jsx).
// Scope decided 2026-09-01: primitives + dashboards, RN tablet components excluded.
import './process-shim.js';
export { default as SearchableCombobox } from '../web/app/searchable-combobox.jsx';
export { default as RouteSelector } from '../web/app/route-selector.jsx';
export { default as JobGpsDrawer } from '../web/app/job-gps-drawer.jsx';
export { default as SpeedTimelineOverlay } from '../web/app/speed-timeline.jsx';
export { TimelineAlertMarkers, TimelineAlertChips } from '../web/app/timeline-alerts.jsx';
export { default as RouteMap } from '../web/app/route-map.jsx';
export { default as FleetDashboard } from '../web/app/fleet-dashboard.jsx';
export { default as FullReportDashboard } from '../web/app/report-dashboard.jsx';
export { default as TimelineDashboard } from '../web/app/timeline-dashboard.jsx';
export { default as RoutesDashboard } from '../web/app/routes-dashboard.jsx';
export { default as SettingsDashboard } from '../web/app/settings-dashboard.jsx';
export { LandscapePrintDashboard, PortraitPrintDashboard } from '../web/app/print/print-dashboard.jsx';
export { default as DashboardError } from '../web/app/error.jsx';
