import { reportDateKey, searchableReportText } from './report-view.ts';

export const reportFilterKeys = [
  'search',
  'startDate',
  'endDate',
  'vehicle',
  'device',
  'driver',
  'mode',
  'status',
  'gps',
] as const;

export type ReportFilters = Partial<Record<(typeof reportFilterKeys)[number], string>>;

type SearchParamsReader = { get(name: string): string | null };

function gpsValue(report: Record<string, unknown>) {
  return String(report.gpsLookupStatus || report.gps || '');
}

export function reportFiltersFromSearchParams(params: SearchParamsReader): ReportFilters {
  return Object.fromEntries(reportFilterKeys
    .map(key => [key, String(params.get(key) || '').trim()])
    .filter(([, value]) => value)) as ReportFilters;
}

export function appendReportFilters(params: URLSearchParams, filters: ReportFilters) {
  for (const key of reportFilterKeys) {
    const value = String(filters[key] || '').trim();
    if (value) params.set(key, value);
  }
  return params;
}

export function reportMatchesFilters(
  report: Record<string, any>,
  filters: ReportFilters,
  language: 'en' | 'th',
) {
  const date = reportDateKey(report.startTime);
  if (filters.startDate && date < filters.startDate) return false;
  if (filters.endDate && date > filters.endDate) return false;
  if (filters.vehicle && report.vehicleNumber !== filters.vehicle) return false;
  if (filters.device && report.deviceId !== filters.device) return false;
  if (filters.driver && report.driverName !== filters.driver) return false;
  if (filters.mode && report.mode !== filters.mode) return false;
  if (filters.status && report.status !== filters.status) return false;
  if (filters.gps && gpsValue(report) !== filters.gps) return false;
  const query = String(filters.search || '').trim().toLocaleLowerCase(language === 'th' ? 'th' : 'en');
  if (!query) return true;
  const extendedSearch = [
    searchableReportText(report, language),
    report.locationName,
    report.location,
    report.address,
    report.topSpeed,
    report.maxSpeed,
    report.maximumSpeed,
    report.distanceKm,
    report.distance,
    report.gpsDistanceKm,
  ].filter(value => value !== undefined && value !== null).join(' ').toLocaleLowerCase(language === 'th' ? 'th' : 'en');
  return extendedSearch.includes(query);
}

export function filterReports(
  reports: Array<Record<string, any>>,
  filters: ReportFilters,
  language: 'en' | 'th',
) {
  return reports.filter(report => reportMatchesFilters(report, filters, language));
}

export function hasRestrictiveReportFilters(filters: ReportFilters) {
  return Boolean(filters.search || filters.vehicle || filters.device || filters.driver
    || filters.mode || filters.status || filters.gps);
}
