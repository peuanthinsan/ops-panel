export type TimelineJobFilters = {
  showCompleted?: boolean;
  showCancelled?: boolean;
  selectedModes: ReadonlySet<string>;
};

export function isTimelineReport(report: { status?: unknown }) {
  return report.status !== 'Cancelled';
}

export function timelineReportMatchesFilters(
  report: { mode?: unknown; status?: unknown },
  filters: TimelineJobFilters,
) {
  if (!isTimelineReport(report) || filters.showCompleted === false) return false;
  return filters.selectedModes.has(String(report.mode || ''));
}
