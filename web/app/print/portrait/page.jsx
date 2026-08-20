'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PortraitPrintDashboard } from '../print-dashboard';

function PortraitPrintContent() {
  const params = useSearchParams();
  return <PortraitPrintDashboard date={params.get('date')} vehicle={params.get('vehicle')} lang={params.get('lang')} />;
}

export default function PortraitPrintPage() { return <Suspense fallback={null}><PortraitPrintContent /></Suspense>; }
