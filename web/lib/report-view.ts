export const REPORT_TIME_ZONE = 'Asia/Bangkok';

type ReportView = {
  id?: string | null;
  vehicleNumber?: string | null;
  deviceId?: string | null;
  driverName?: string | null;
  driverId?: string | null;
  mode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  duration?: string | null;
  status?: string | null;
  gps?: string | null;
  gpsLookupStatus?: string | null;
  gpsLookupMessage?: string | null;
  deviceGpsSamples?: number | null;
  fmsGpsSamples?: number | null;
  lastDeviceLatitude?: number | null;
  lastDeviceLongitude?: number | null;
  lastGpsCapturedAt?: string | null;
};

function dateValue(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function reportDateKey(value?: string | null) {
  const date = dateValue(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatReportDate(value: string, language: 'en' | 'th') {
  const date = dateValue(`${value}T00:00:00+07:00`);
  if (!date) return value;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export function formatReportDateTime(value: string | null | undefined, language: 'en' | 'th') {
  const date = dateValue(value);
  if (!date) return value || '—';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatReportCoordinate(value: number | string | null | undefined) {
  if (value == null || value === '') return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate.toFixed(5) : null;
}

export function reportSortValue(report: ReportView, key: string): string | number {
  if (key === 'startTime' || key === 'endTime') return dateValue(report[key as 'startTime' | 'endTime'])?.getTime() ?? 0;
  if (key === 'duration') {
    const start = dateValue(report.startTime)?.getTime();
    const end = dateValue(report.endTime)?.getTime();
    return start != null && end != null ? Math.max(0, end - start) : 0;
  }
  if (key === 'gpsState') return `${report.gpsLookupStatus || ''} ${report.gps || ''} ${report.deviceGpsSamples || 0} ${report.fmsGpsSamples || 0}`.trim().toLowerCase();
  return String(report[key as keyof ReportView] ?? '').toLowerCase();
}

export function compareReports(left: ReportView, right: ReportView, key: string, direction: 'asc' | 'desc') {
  const leftValue = reportSortValue(left, key);
  const rightValue = reportSortValue(right, key);
  const result = typeof leftValue === 'number' && typeof rightValue === 'number'
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
  return direction === 'asc' ? result : -result;
}

export function searchableReportText(report: ReportView, language: 'en' | 'th') {
  return [
    report.id,
    report.vehicleNumber,
    report.deviceId,
    report.driverName,
    report.driverId,
    report.mode,
    report.startTime,
    report.endTime,
    reportDateKey(report.startTime),
    formatReportDateTime(report.startTime, language),
    formatReportDateTime(report.endTime, language),
    report.duration,
    report.status,
    report.gps,
    report.gpsLookupStatus,
    report.gpsLookupMessage,
    report.deviceGpsSamples,
    report.fmsGpsSamples,
    report.lastDeviceLatitude,
    report.lastDeviceLongitude,
    formatReportCoordinate(report.lastDeviceLatitude),
    formatReportCoordinate(report.lastDeviceLongitude),
    report.lastGpsCapturedAt,
    formatReportDateTime(report.lastGpsCapturedAt, language),
  ].filter(Boolean).join(' ').toLowerCase();
}
