import * as React from 'react';
import { JobGpsDrawer } from 'songdee-ops-panel';

const noop = () => {};

// The drawer is a position:fixed overlay (scrim + panel). The capture card
// mounts each story inside a transformed cell, so fixed positioning resolves
// against that cell — which has no height of its own and would collapse the
// drawer's middle row. The Stage below is preview glue only: an explicitly
// sized, transformed box that gives the overlay a real containing block. At
// the 900px capture viewport the app's own ≤900px media query applies, so the
// drawer renders its full-width tablet layout.
// GPS detail is fetched on mount through adminFetch, which fails under the
// capture server — the drawer settles into its honest loading-then-error
// state ("Could not load GPS detail.") while the job metadata, route
// assignment, summary, and footer all render from the report prop.
const Stage = ({ children }: { children?: unknown }) => (
  <div style={{ position: 'relative', height: 640, overflow: 'hidden', transform: 'translateZ(0)', background: '#EEF0F2' }}>
    {children}
  </div>
);

const jobEn = {
  id: 'R-8241',
  vehicleNumber: 'SD-071',
  driverName: 'สมชาย ใจดี',
  mode: 'Load',
  startTime: '2026-08-20T08:30:00+07:00',
  endTime: '2026-08-20T11:45:00+07:00',
  routeName: 'กรุงเทพฯ – แหลมฉบัง (มอเตอร์เวย์ 7)',
  workPeriodId: 'WP-2026-0820-071',
};

const jobTh = {
  id: 'R-8256',
  vehicleNumber: 'SD-105',
  driverName: 'วิชัย พงษ์ไทย',
  mode: 'Unload',
  startTime: '2026-08-20T13:00:00+07:00',
  endTime: '2026-08-20T15:30:00+07:00',
  routeName: '',
  workPeriodId: 'WP-2026-0820-105',
};

export const GpsDetailUnavailable = () => (
  <Stage>
    <JobGpsDrawer report={jobEn} lang="en" onClose={noop} />
  </Stage>
);

export const GpsDetailUnavailableThai = () => (
  <Stage>
    <JobGpsDrawer report={jobTh} lang="th" onClose={noop} />
  </Stage>
);
