export const DAILY_REPORT_FIRST_PAGE_JOB_LIMIT = 8;
export const DAILY_REPORT_CONTINUATION_JOB_LIMIT = 14;

export function dailyReportIsComplete(rows: Array<{ mode?: unknown; status?: unknown }>) {
  return rows.some(report => report.mode === 'Finish work' && report.status !== 'Cancelled');
}

export function paginateDailyReportJobs<T>(rows: T[]) {
  const jobs = Array.isArray(rows) ? rows : [];
  const firstPage = jobs.slice(0, DAILY_REPORT_FIRST_PAGE_JOB_LIMIT);
  const remaining = jobs.slice(DAILY_REPORT_FIRST_PAGE_JOB_LIMIT);
  const continuationPages: T[][] = [];

  for (let index = 0; index < remaining.length; index += DAILY_REPORT_CONTINUATION_JOB_LIMIT) {
    continuationPages.push(remaining.slice(index, index + DAILY_REPORT_CONTINUATION_JOB_LIMIT));
  }

  return {
    firstPage,
    continuationPages,
    totalPages: 1 + continuationPages.length,
  };
}
