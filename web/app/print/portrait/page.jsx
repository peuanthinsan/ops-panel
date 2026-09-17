'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PortraitPrintDashboard } from '../print-dashboard';

function PortraitPrintContent() {
  const params = useSearchParams();
  return <PortraitPrintDashboard date={params.get('date')} startDate={params.get('startDate')} endDate={params.get('endDate')} dateBasis={params.get('dateBasis')} workPeriodId={params.get('workPeriodId')} vehicle={params.get('vehicle')} lang={params.get('lang')} style={params.get('style')} />;
}

export default function PortraitPrintPage() { return <Suspense fallback={null}><PortraitPrintContent /></Suspense>; }
