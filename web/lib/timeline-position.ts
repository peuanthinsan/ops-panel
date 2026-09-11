export const TIMELINE_START_MINUTE = 0;
export const TIMELINE_END_MINUTE = 24 * 60;
export const TIMELINE_MINUTES = TIMELINE_END_MINUTE - TIMELINE_START_MINUTE;
export const TIMELINE_AXIS_LABELS = ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'];

function dateValue(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function formatTimelineTime(value: string | number | null | undefined, lang = 'en') {
  const date = value == null || value === '' ? null : new Date(value);
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

/** Position an activity using its actual elapsed time, including seconds. */
export function timelineRangePosition(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  scaleStart: number,
  scaleEnd: number,
) {
  const start = dateValue(startValue)?.getTime();
  if (start == null || !Number.isFinite(scaleStart) || !Number.isFinite(scaleEnd) || scaleEnd <= scaleStart) return null;
  const end = Math.max(start, dateValue(endValue)?.getTime() ?? start);
  if (start > scaleEnd || end < scaleStart) return null;
  const boundedStart = Math.max(scaleStart, start);
  const boundedEnd = Math.min(scaleEnd, end);
  const duration = scaleEnd - scaleStart;
  return { left: ((boundedStart - scaleStart) / duration) * 100, width: ((boundedEnd - boundedStart) / duration) * 100 };
}

/** Allocate visible lanes without changing the time represented by a segment. */
export function assignTimelineLanes<T extends { left: number; width: number }>(segments: T[], minimumWidthPercent = 0) {
  const laneEnds: number[] = [];
  const positioned = [...segments].sort((left, right) => left.left - right.left).map(segment => {
    const visibleStart = Math.min(segment.left, 100 - minimumWidthPercent);
    let lane = laneEnds.findIndex(end => visibleStart >= end);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = visibleStart + Math.max(segment.width, minimumWidthPercent);
    return { ...segment, lane };
  });
  return { segments: positioned, laneCount: Math.max(1, laneEnds.length) };
}

export function bangkokMinuteOfDay(value?: string | null) {
  const date = dateValue(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  const second = Number(parts.find(part => part.type === 'second')?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) && Number.isFinite(second)
    ? (hour * 60) + minute + (second / 60)
    : null;
}

export function timelinePosition(startValue?: string | null, endValue?: string | null, fallbackMinutes = 0.25) {
  const startDate = dateValue(startValue);
  const endDate = dateValue(endValue);
  const start = bangkokMinuteOfDay(startValue);
  if (!startDate || start == null) return null;

  const endMinute = bangkokMinuteOfDay(endValue);
  const crossesMidnight = Boolean(endDate && endDate > startDate && endMinute != null && endMinute < start);
  const hasEnd = Boolean(endDate && endMinute != null);
  const rawEnd = crossesMidnight ? TIMELINE_END_MINUTE : (endMinute ?? start + fallbackMinutes);
  const boundedStart = Math.max(TIMELINE_START_MINUTE, Math.min(TIMELINE_END_MINUTE, start));
  const boundedEnd = Math.max(
    hasEnd ? boundedStart : boundedStart + fallbackMinutes,
    Math.min(TIMELINE_END_MINUTE, rawEnd),
  );
  if (boundedStart >= TIMELINE_END_MINUTE) return null;
  return {
    left: ((boundedStart - TIMELINE_START_MINUTE) / TIMELINE_MINUTES) * 100,
    width: ((Math.min(TIMELINE_END_MINUTE, boundedEnd) - boundedStart) / TIMELINE_MINUTES) * 100,
  };
}
