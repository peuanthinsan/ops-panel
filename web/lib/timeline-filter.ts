export type TimelineJobFilters = {
  showCompleted: boolean;
  showCancelled: boolean;
  selectedModes: ReadonlySet<string>;
};

export function timelineReportMatchesFilters(
  report: { mode?: unknown; status?: unknown },
  filters: TimelineJobFilters,
) {
  const cancelled = report.status === 'Cancelled';
  if (cancelled ? !filters.showCancelled : !filters.showCompleted) return false;
  return filters.selectedModes.has(String(report.mode || ''));
}
