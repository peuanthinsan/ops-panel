'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { reportFiltersFromSearchParams } from '../../../lib/report-filter';
import { LandscapePrintDashboard } from '../print-dashboard';

function LandscapePrintContent() {
  const params = useSearchParams();
  return <LandscapePrintDashboard filters={reportFiltersFromSearchParams(params)} lang={params.get('lang')} timelineOnly={params.get('view') === 'timeline'} />;
}

export default function LandscapePrintPage() { return <Suspense fallback={null}><LandscapePrintContent /></Suspense>; }
