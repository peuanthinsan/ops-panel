type PrintLocationReport = {
  locationName?: string | null;
  location?: string | null;
  address?: string | null;
  lastDeviceLatitude?: number | string | null;
  lastDeviceLongitude?: number | string | null;
  lastFmsLatitude?: number | string | null;
  lastFmsLongitude?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

function coordinate(value: number | string | null | undefined) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(5) : null;
}

export function printReportLocation(report: PrintLocationReport, language: 'en' | 'th') {
  const latitude = coordinate(report.lastDeviceLatitude ?? report.lastFmsLatitude ?? report.latitude);
  const longitude = coordinate(report.lastDeviceLongitude ?? report.lastFmsLongitude ?? report.longitude);
  const coordinates = latitude && longitude ? `${latitude}, ${longitude}` : '';
  const explicitName = report.locationName || report.location || report.address || '';
  return {
    name: explicitName || coordinates || (language === 'th' ? 'ไม่มีข้อมูลตำแหน่ง' : 'Location unavailable'),
    coordinates: explicitName ? coordinates : '',
  };
}
