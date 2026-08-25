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

export type ReportFilterValue = string | string[];
export type ReportFilters = Partial<Record<(typeof reportFilterKeys)[number], ReportFilterValue>>;

type SearchParamsReader = { get(name: string): string | null; getAll?(name: string): string[] };
const multiValueKeys = new Set(['vehicle', 'device', 'driver', 'mode', 'status', 'gps']);

function filterValues(value: ReportFilterValue | undefined) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))];
}

function firstFilterValue(value: ReportFilterValue | undefined) {
  return filterValues(value)[0] || '';
}

function gpsValue(report: Record<string, unknown>) {
  return String(report.gpsLookupStatus || report.gps || '');
}

export function reportFiltersFromSearchParams(params: SearchParamsReader): ReportFilters {
  return Object.fromEntries(reportFilterKeys.map(key => {
    const values = multiValueKeys.has(key)
      ? [...new Set((params.getAll?.(key) || [params.get(key)]).map(value => String(value || '').trim()).filter(Boolean))]
      : String(params.get(key) || '').trim();
    return [key, values];
  }).filter(([, value]) => Array.isArray(value) ? value.length : value)) as ReportFilters;
}

export function appendReportFilters(params: URLSearchParams, filters: ReportFilters) {
  for (const key of reportFilterKeys) {
    for (const value of filterValues(filters[key])) params.append(key, value);
  }
  return params;
}

export function reportMatchesFilters(
  report: Record<string, any>,
  filters: ReportFilters,
  language: 'en' | 'th',
) {
  const date = reportDateKey(report.startTime);
  const startDate = firstFilterValue(filters.startDate);
  const endDate = firstFilterValue(filters.endDate);
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  const exactFilters: Array<[ReportFilterValue | undefined, unknown, boolean?]> = [
    [filters.vehicle, report.vehicleNumber, true],
    [filters.device, report.deviceId],
    [filters.driver, report.driverName],
    [filters.mode, report.mode],
    [filters.status, report.status],
    [filters.gps, gpsValue(report)],
  ];
  for (const [filter, actual, caseInsensitive = false] of exactFilters) {
    const values = filterValues(filter);
    if (!values.length) continue;
    const actualValue = String(actual || '');
    if (caseInsensitive
      ? !values.some(value => value.toLocaleLowerCase() === actualValue.toLocaleLowerCase())
      : !values.includes(actualValue)) return false;
  }
  const query = firstFilterValue(filters.search).toLocaleLowerCase(language === 'th' ? 'th' : 'en');
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
  return ['search', 'vehicle', 'device', 'driver', 'mode', 'status', 'gps']
    .some(key => filterValues(filters[key as keyof ReportFilters]).length > 0);
}
