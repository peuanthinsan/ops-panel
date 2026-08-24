import type { MobileJobQuery } from './mobile-job-query';
import type { SavedJob } from './saved-jobs';

export const DEVICE_JOB_PAGE_SIZE = 50;

export type DeviceJobHistorySummary = {
  total: number;
  completed: number;
  cancelled: number;
  durationSeconds: number;
};

export type DeviceJobHistoryPageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  start: number;
  end: number;
  hasNextPage: boolean;
};

export type DeviceJobHistoryResponse = {
  jobs: SavedJob[];
  facets: { months: string[] };
  pageInfo: DeviceJobHistoryPageInfo;
  summary: DeviceJobHistorySummary;
};

export function emptyDeviceJobHistory(): DeviceJobHistoryResponse {
  return {
    jobs: [],
    facets: { months: [] },
    pageInfo: { page: 1, pageSize: DEVICE_JOB_PAGE_SIZE, total: 0, totalPages: 1, start: 0, end: 0, hasNextPage: false },
    summary: { total: 0, completed: 0, cancelled: 0, durationSeconds: 0 },
  };
}

export function deviceJobHistorySearchParams(query: MobileJobQuery, page: number) {
  const params = new URLSearchParams({
    page: String(Math.max(1, Math.trunc(page))),
    pageSize: String(DEVICE_JOB_PAGE_SIZE),
    sort: query.sort,
    status: query.status,
  });
  if (query.search.trim()) params.set('search', query.search.trim());
  if (query.dayKey) params.set('day', query.dayKey);
  else {
    if (query.startAt) params.set('from', query.startAt);
    if (query.endAt) params.set('to', query.endAt);
    if (!query.startAt && !query.endAt && query.monthKey) params.set('month', query.monthKey);
  }
  if (query.mode) params.set('mode', query.mode);
  return params;
}
