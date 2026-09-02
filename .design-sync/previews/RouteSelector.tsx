import * as React from 'react';
import { RouteSelector } from 'songdee-ops-panel';

const noop = () => {};

// The app mounts RouteSelector inside .gps-route-assignment (the framed grey
// box in the GPS drawer) — reusing that wrapper class is composition context;
// the max-width div is preview glue. Opening the popover triggers an
// adminFetch route search, so the open/search states are interaction-only and
// not composed here: the closed trigger, busy, and error states are.
const Box = ({ children }: { children?: unknown }) => (
  <div style={{ maxWidth: 430, padding: 16 }}>
    <div className="gps-route-assignment">{children}</div>
  </div>
);

export const AssignedRoute = () => (
  <Box>
    <RouteSelector value="กรุงเทพฯ – แหลมฉบัง (มอเตอร์เวย์ 7)" lang="en" onSelect={noop} />
  </Box>
);

export const NoRouteYet = () => (
  <Box>
    <RouteSelector value="" lang="en" onSelect={noop} />
  </Box>
);

export const SavingThai = () => (
  <Box>
    <RouteSelector value="กรุงเทพฯ – อยุธยา (สายเอเชีย)" busy lang="th" onSelect={noop} />
  </Box>
);

export const SaveFailed = () => (
  <Box>
    <RouteSelector value="กรุงเทพฯ – แหลมฉบัง (มอเตอร์เวย์ 7)" error="Could not update the assigned route." lang="en" onSelect={noop} />
  </Box>
);
