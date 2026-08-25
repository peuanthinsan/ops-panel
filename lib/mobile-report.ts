import type { SavedJob } from './saved-jobs';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const ENGLISH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function bangkokDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + BANGKOK_OFFSET_MS) : null;
}

export function mobileReportDayKey(value: string | number | Date) {
  return bangkokDate(value)?.toISOString().slice(0, 10) || '';
}

function bangkokDayBoundary(dayKey: string, end = false) {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - BANGKOK_OFFSET_MS + (end ? 24 * 60 * 60 * 1000 : 0);
}

export function mobileReportOverlapsDay(startTime: string, endTime: string, dayKey: string) {
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  const dayStart = bangkokDayBoundary(dayKey);
  const dayEnd = bangkokDayBoundary(dayKey, true);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(dayStart) && Number.isFinite(dayEnd)
    && start < dayEnd && end >= dayStart;
}

export function formatMobileReportDay(dayKey: string, language: 'en' | 'th') {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dayKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return language === 'en'
    ? `${day} ${ENGLISH_MONTHS[month - 1]} ${year}`
    : `${day} ${THAI_MONTHS[month - 1]} ${year + 543}`;
}

export function formatMobileReportMonth(monthKey: string, language: 'en' | 'th') {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return language === 'en'
    ? `${ENGLISH_MONTHS[month - 1]} ${year}`
    : `${THAI_MONTHS[month - 1]} ${year + 543}`;
}

export function formatMobileReportTime(value: string) {
  return bangkokDate(value)?.toISOString().slice(11, 19) || value;
}

export function formatMobileReportDateTime(value: string, language: 'en' | 'th') {
  const dayKey = mobileReportDayKey(value);
  return dayKey ? `${formatMobileReportDay(dayKey, language)}, ${formatMobileReportTime(value)}` : value;
}

export function savedJobDayKeys(jobs: SavedJob[]) {
  return [...new Set(jobs.flatMap(job => [mobileReportDayKey(job.startTime), mobileReportDayKey(job.endTime)]).filter(Boolean))].sort().reverse();
}

export function savedJobsForDay(jobs: SavedJob[], dayKey: string | null) {
  const filtered = dayKey ? jobs.filter(job => mobileReportOverlapsDay(job.startTime, job.endTime, dayKey)) : jobs;
  return [...filtered].sort((left, right) => Date.parse(right.endTime) - Date.parse(left.endTime));
}

export function durationSeconds(value: string) {
  const parts = String(value || '').split(':');
  if (!parts.length || parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return 0;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatReportDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function summarizeSavedJobs(jobs: SavedJob[]) {
  return {
    total: jobs.length,
    completed: jobs.filter(job => job.status !== 'Cancelled').length,
    cancelled: jobs.filter(job => job.status === 'Cancelled').length,
    durationSeconds: jobs.reduce((total, job) => total + durationSeconds(job.duration), 0),
  };
}
