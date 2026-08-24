export const DEVICE_JOB_PAGE_SIZE = 50;
export const DEVICE_JOB_MAX_PAGE_SIZE = 100;

const supportedStatuses = new Set(['all', 'completed', 'cancelled', 'pending', 'failed']);
const supportedSorts = new Set(['newest', 'oldest', 'duration_desc', 'mode_asc']);

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function validDay(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function validMonth(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : '';
}

function validDateTime(value) {
  const text = String(value || '').trim();
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : '';
}

function bangkokKey(value, length) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + (7 * 60 * 60 * 1000)).toISOString().slice(0, length);
}

function durationSeconds(report) {
  const start = Date.parse(report.startTime);
  const end = Date.parse(report.endTime);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

function searchableText(report) {
  return [
    report.id,
    report.vehicleNumber,
    report.deviceId,
    report.driverName,
    report.driverId,
    report.mode,
    report.status,
    report.startTime,
    report.endTime,
    bangkokKey(report.startTime, 10),
    bangkokKey(report.startTime, 19).slice(11),
    bangkokKey(report.endTime, 19).slice(11),
    report.duration,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function sameVehicle(left, right) {
  return String(left || '').trim().toLocaleLowerCase('en-US') === String(right || '').trim().toLocaleLowerCase('en-US');
}

export function parseDeviceJobHistoryQuery(searchParams) {
  const rawStatus = String(searchParams.get('status') || 'all');
  const rawSort = String(searchParams.get('sort') || 'newest');
  const dayKey = validDay(searchParams.get('day'));
  const startAt = dayKey ? '' : validDateTime(searchParams.get('from'));
  const endAt = dayKey ? '' : validDateTime(searchParams.get('to'));
  return {
    dayKey,
    endAt,
    startAt,
    monthKey: dayKey || startAt || endAt ? '' : validMonth(searchParams.get('month')),
    mode: String(searchParams.get('mode') || '').trim().slice(0, 80),
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: positiveInteger(searchParams.get('pageSize'), DEVICE_JOB_PAGE_SIZE, DEVICE_JOB_MAX_PAGE_SIZE),
    search: String(searchParams.get('search') || '').trim().slice(0, 180),
    sort: supportedSorts.has(rawSort) ? rawSort : 'newest',
    status: supportedStatuses.has(rawStatus) ? rawStatus : 'all',
  };
}

function matchesQuery(report, query) {
  if (query.dayKey && bangkokKey(report.endTime, 10) !== query.dayKey) return false;
  if (!query.dayKey && query.startAt && Date.parse(report.endTime) < Date.parse(query.startAt)) return false;
  if (!query.dayKey && query.endAt && Date.parse(report.startTime) > Date.parse(query.endAt)) return false;
  if (!query.dayKey && !query.startAt && !query.endAt && query.monthKey && bangkokKey(report.endTime, 7) !== query.monthKey) return false;
  if (query.mode && report.mode !== query.mode) return false;
  if (query.status === 'cancelled' && report.status !== 'Cancelled') return false;
  if (query.status === 'completed' && report.status === 'Cancelled') return false;
  if (query.status === 'pending' || query.status === 'failed') return false;
  return !query.search || searchableText(report).includes(query.search.toLocaleLowerCase());
}

function compareJobs(left, right, sort) {
  const leftEnd = Date.parse(left.endTime) || 0;
  const rightEnd = Date.parse(right.endTime) || 0;
  if (sort === 'oldest') return leftEnd - rightEnd || String(left.id).localeCompare(String(right.id));
  if (sort === 'duration_desc') return durationSeconds(right) - durationSeconds(left) || rightEnd - leftEnd || String(left.id).localeCompare(String(right.id));
  if (sort === 'mode_asc') return String(left.mode).localeCompare(String(right.mode)) || rightEnd - leftEnd || String(left.id).localeCompare(String(right.id));
  return rightEnd - leftEnd || String(right.id).localeCompare(String(left.id));
}

export function summarizeDeviceJobs(reports) {
  return {
    total: reports.length,
    completed: reports.filter(report => report.status !== 'Cancelled').length,
    cancelled: reports.filter(report => report.status === 'Cancelled').length,
    durationSeconds: reports.reduce((total, report) => total + durationSeconds(report), 0),
  };
}

export function queryLocalDeviceJobs(reports, deviceId, vehicleNumber, searchParams) {
  const query = parseDeviceJobHistoryQuery(searchParams);
  const bindingReports = reports.filter(report => report.deviceId === deviceId && sameVehicle(report.vehicleNumber, vehicleNumber));
  const filtered = bindingReports.filter(report => matchesQuery(report, query));
  filtered.sort((left, right) => compareJobs(left, right, query.sort));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;
  const jobs = filtered.slice(offset, offset + query.pageSize);
  return {
    jobs,
    facets: {
      months: [...new Set(bindingReports.map(report => bangkokKey(report.endTime, 7)).filter(Boolean))].sort().reverse(),
    },
    pageInfo: {
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      start: jobs.length ? offset + 1 : 0,
      end: offset + jobs.length,
      hasNextPage: page < totalPages,
    },
    summary: summarizeDeviceJobs(filtered),
  };
}
