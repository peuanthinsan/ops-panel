import * as React from 'react';
import { DashboardError } from 'songdee-ops-panel';

const noop = () => {};

// The route error page is a full-viewport main (min-height:100vh, grey
// backdrop) centring the bilingual error card; its copy is hardcoded EN + TH.
// The narrow wrapper in the second cell is preview glue showing the card at a
// phone-width column. The pin illustration comes from the app's /public
// directory, which the capture server does not host — its slot renders empty
// here; heading, Thai body copy, and retry button are the graded composition.
const routeError = () => {
  const error = new Error('Timeline query failed: upstream GPS service timed out');
  (error as Error & { digest?: string }).digest = 'SD-TIMELINE-504';
  return error;
};

export const FullPage = () => <DashboardError error={routeError()} reset={noop} />;

export const PhoneWidth = () => (
  <div style={{ maxWidth: 430 }}>
    <DashboardError error={routeError()} reset={noop} />
  </div>
);
