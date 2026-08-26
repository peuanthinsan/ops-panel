const bangkokDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function workPeriodDateKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(bangkokDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isFinishWorkReport(report) {
  return report?.mode === 'Finish work' && report?.status !== 'Cancelled';
}

function vehicleKey(report) {
  return String(report?.vehicleNumber || '').trim().toLocaleLowerCase();
}

function timestamp(value) {
  const result = Date.parse(String(value || ''));
  return Number.isFinite(result) ? result : 0;
}

function compareReports(left, right) {
  return timestamp(left.startTime) - timestamp(right.startTime)
    || timestamp(left.endTime) - timestamp(right.endTime)
    || String(left.id || '').localeCompare(String(right.id || ''));
}

export function annotateWorkPeriods(reports = []) {
  const annotated = new Map();
  const byVehicle = new Map();
  reports.forEach((report, index) => {
    const key = vehicleKey(report);
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key).push({ report, index });
  });

  for (const vehicleReports of byVehicle.values()) {
    const ordered = [...vehicleReports].sort((left, right) => compareReports(left.report, right.report));
    let period = [];
    const closePeriod = complete => {
      if (!period.length) return;
      const first = period[0].report;
      const last = period[period.length - 1].report;
      const workPeriodId = String(first.id || `${vehicleKey(first)}-${first.startTime || period[0].index}`);
      const metadata = {
        workPeriodId,
        workPeriodStartTime: first.startTime || null,
        workPeriodEndTime: complete ? (last.endTime || last.startTime || null) : null,
        workPeriodDate: workPeriodDateKey(first.startTime),
        workPeriodComplete: complete,
      };
      for (const item of period) annotated.set(item.index, { ...item.report, ...metadata });
      period = [];
    };

    for (const item of ordered) {
      period.push(item);
      if (isFinishWorkReport(item.report)) closePeriod(true);
    }
    closePeriod(false);
  }

  return reports.map((report, index) => annotated.get(index) || report);
}

export function reportsForWorkPeriod(reports = [], anchorReportId = '') {
  const annotated = annotateWorkPeriods(reports);
  const anchor = annotated.find(report => String(report.id || '') === String(anchorReportId || ''));
  return anchor ? annotated.filter(report => report.workPeriodId === anchor.workPeriodId).sort(compareReports) : [];
}

export function reportsForWorkDate(reports = [], dateKey = '') {
  return annotateWorkPeriods(reports)
    .filter(report => report.workPeriodDate === dateKey)
    .sort(compareReports);
}
