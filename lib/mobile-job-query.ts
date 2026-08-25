import { operationActions } from './actions.ts';
import { durationSeconds, formatMobileReportTime, mobileReportDayKey, mobileReportOverlapsDay } from './mobile-report.ts';
import type { SavedJob } from './saved-jobs.ts';

export type MobileJobStatusFilter = 'all' | 'completed' | 'cancelled' | 'pending' | 'failed';
export type MobileJobSort = 'newest' | 'oldest' | 'duration_desc' | 'mode_asc';

export type MobileJobQuery = {
  dayKey: string | null;
  endAt: string | null;
  startAt: string | null;
  monthKey: string | null;
  mode: string | null;
  search: string;
  sort: MobileJobSort;
  status: MobileJobStatusFilter;
};

const thaiModeByEnglish = new Map<string, string>(operationActions.map(([, thai, english]) => [english, thai]));

function normalizedSearch(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesStatus(job: SavedJob, status: MobileJobStatusFilter) {
  if (status === 'all') return true;
  if (status === 'cancelled') return job.status === 'Cancelled';
  if (status === 'pending') return Boolean(job.pendingUpload);
  if (status === 'failed') return Boolean(job.uploadFailed);
  return job.status !== 'Cancelled';
}

function searchableJobText(job: SavedJob) {
  const statusTerms = [
    job.status === 'Cancelled' ? 'cancelled ยกเลิก' : 'completed saved เสร็จแล้ว บันทึกแล้ว',
    job.pendingUpload ? 'waiting pending sync รอซิงค์' : '',
    job.uploadFailed ? 'failed needs attention ต้องตรวจสอบ' : '',
  ];
  return normalizedSearch([
    job.id,
    job.vehicleNumber,
    job.deviceId,
    job.driverName,
    job.driverId,
    job.mode,
    thaiModeByEnglish.get(job.mode),
    job.startTime,
    job.endTime,
    mobileReportDayKey(job.endTime),
    formatMobileReportTime(job.startTime),
    formatMobileReportTime(job.endTime),
    job.duration,
    ...statusTerms,
  ].join(' '));
}

export function mobileJobMonthKey(job: SavedJob) {
  return mobileReportDayKey(job.endTime).slice(0, 7);
}

export function mobileJobMonthKeys(jobs: SavedJob[]) {
  return [...new Set(jobs.map(mobileJobMonthKey).filter(Boolean))].sort().reverse();
}

export function filterAndSortMobileJobs(jobs: SavedJob[], query: MobileJobQuery) {
  const search = normalizedSearch(query.search);
  const filtered = jobs.filter(job => {
    if (query.dayKey && !mobileReportOverlapsDay(job.startTime, job.endTime, query.dayKey)) return false;
    if (!query.dayKey && query.startAt && timestamp(job.endTime) < timestamp(query.startAt)) return false;
    if (!query.dayKey && query.endAt && timestamp(job.startTime) > timestamp(query.endAt)) return false;
    if (!query.dayKey && !query.startAt && !query.endAt && query.monthKey && mobileJobMonthKey(job) !== query.monthKey) return false;
    if (query.mode && job.mode !== query.mode) return false;
    if (!matchesStatus(job, query.status)) return false;
    return !search || searchableJobText(job).includes(search);
  });

  return filtered.sort((left, right) => {
    if (query.sort === 'oldest') return timestamp(left.endTime) - timestamp(right.endTime) || left.id.localeCompare(right.id);
    if (query.sort === 'duration_desc') return durationSeconds(right.duration) - durationSeconds(left.duration) || timestamp(right.endTime) - timestamp(left.endTime) || left.id.localeCompare(right.id);
    if (query.sort === 'mode_asc') return left.mode.localeCompare(right.mode) || timestamp(right.endTime) - timestamp(left.endTime) || left.id.localeCompare(right.id);
    return timestamp(right.endTime) - timestamp(left.endTime) || left.id.localeCompare(right.id);
  });
}
