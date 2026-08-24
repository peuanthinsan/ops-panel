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
