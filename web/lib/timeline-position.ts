export const TIMELINE_START_MINUTE = 0;
export const TIMELINE_END_MINUTE = 24 * 60;
export const TIMELINE_MINUTES = TIMELINE_END_MINUTE - TIMELINE_START_MINUTE;
export const TIMELINE_AXIS_LABELS = ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'];

function dateValue(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function bangkokMinuteOfDay(value?: string | null) {
  const date = dateValue(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? (hour * 60) + minute : null;
}

export function timelinePosition(startValue?: string | null, endValue?: string | null, fallbackMinutes = 5) {
  const startDate = dateValue(startValue);
  const endDate = dateValue(endValue);
  const start = bangkokMinuteOfDay(startValue);
  if (!startDate || start == null) return null;

  const endMinute = bangkokMinuteOfDay(endValue);
  const crossesMidnight = Boolean(endDate && endDate > startDate && endMinute != null && endMinute < start);
  const rawEnd = crossesMidnight ? TIMELINE_END_MINUTE : (endMinute ?? start + fallbackMinutes);
  const boundedStart = Math.max(TIMELINE_START_MINUTE, Math.min(TIMELINE_END_MINUTE, start));
  const boundedEnd = Math.max(
    boundedStart + fallbackMinutes,
    Math.min(TIMELINE_END_MINUTE, rawEnd),
  );
  if (boundedStart >= TIMELINE_END_MINUTE) return null;
  return {
    left: ((boundedStart - TIMELINE_START_MINUTE) / TIMELINE_MINUTES) * 100,
    width: ((Math.min(TIMELINE_END_MINUTE, boundedEnd) - boundedStart) / TIMELINE_MINUTES) * 100,
  };
}
