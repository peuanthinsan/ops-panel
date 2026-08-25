'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { reportFiltersFromSearchParams } from '../../../lib/report-filter';
import { LandscapePrintDashboard } from '../print-dashboard';

function LandscapePrintContent() {
  const params = useSearchParams();
  const query = params.toString();
  const timelineFilters = useMemo(() => {
    const values = new URLSearchParams(query);
    return values.get('timelineFilter') === '1' ? {
      showCompleted: values.get('timelineShowCompleted') === '1',
      showCancelled: values.get('timelineShowCancelled') === '1',
      selectedModes: new Set(values.getAll('timelineMode')),
    } : null;
  }, [query]);
  return <LandscapePrintDashboard filters={reportFiltersFromSearchParams(params)} lang={params.get('lang')} timelineOnly={params.get('view') === 'timeline'} timelineFilters={timelineFilters} />;
}

export default function LandscapePrintPage() { return <Suspense fallback={null}><LandscapePrintContent /></Suspense>; }
