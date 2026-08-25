import { normalizeSpeedSamples, type RawGpsSpeedSample, type SpeedPoint } from './speed-timeline.ts';
import { bangkokMinuteOfDay } from './timeline-position.ts';

export const DEFAULT_SPEEDING_THRESHOLD_KPH = 90;
export const DEFAULT_HARSH_BRAKING_THRESHOLD_MPS2 = 3;

export type TimelineAlertType = 'speeding' | 'harsh-braking' | 'alert';

export type TimelineAlert = {
  id: string;
  reportId: string;
  type: TimelineAlertType;
  capturedAt: string;
  minute: number;
  speedKph?: number;
  decelerationMps2?: number;
  sourceLabel?: string;
};

type TimelineReport = {
  id?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  topSpeed?: number | string | null;
  maxSpeed?: number | string | null;
  maximumSpeed?: number | string | null;
  alerts?: unknown[] | null;
  harshBraking?: boolean | null;
  harshBrake?: boolean | null;
  harshBrakingCount?: number | string | null;
  harshBrakingAt?: string | null;
  harshBrakeAt?: string | null;
  speeding?: boolean | null;
  speedingCount?: number | string | null;
  speedingAt?: string | null;
};

type ExplicitAlert = Record<string, unknown>;

type AlertOptions = {
  speedingThresholdKph?: number;
  harshBrakingThresholdMps2?: number;
  maximumBrakingGapSeconds?: number;
  maximumSpeedingEpisodeGapSeconds?: number;
};

const bangkokDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const alertTimeFormatters = {
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  th: new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function reportTopSpeed(report: TimelineReport) {
  return numberValue(report.topSpeed ?? report.maxSpeed ?? report.maximumSpeed);
}

function reportIdentifier(report: TimelineReport, index: number) {
  return String(report.id || `report-${index}-${report.startTime || 'unknown'}`);
}

function dateKeyInBangkok(value: unknown) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(bangkokDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function exactTimestamp(value: unknown, report: TimelineReport) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(candidate)) {
    const day = dateKeyInBangkok(report.startTime);
    if (!day) return '';
    const clock = candidate.length === 5 ? `${candidate}:00` : candidate;
    return `${day}T${clock}+07:00`;
  }
  return Number.isFinite(Date.parse(candidate)) ? candidate : '';
}

function inferredType(value: unknown): TimelineAlertType {
  const text = String(value || '').toLowerCase();
  if (/brak|decel|เบรก/.test(text)) return 'harsh-braking';
  if (/speed|overspeed|ความเร็ว/.test(text)) return 'speeding';
  return 'alert';
}

function explicitAlertDetails(value: unknown, report: TimelineReport) {
  if (!value || typeof value !== 'object') {
    const sourceLabel = String(value || '').trim();
    return sourceLabel ? { type: inferredType(sourceLabel), capturedAt: '', sourceLabel } : null;
  }
  const alert = value as ExplicitAlert;
  const sourceLabel = String(alert.label ?? alert.message ?? alert.name ?? alert.description ?? alert.type ?? '').trim();
  const type = inferredType(`${alert.type || ''} ${alert.category || ''} ${sourceLabel}`);
  const capturedAt = exactTimestamp(
    alert.capturedAt ?? alert.occurredAt ?? alert.eventTime ?? alert.timestamp ?? alert.trackTime ?? alert.time,
    report,
  );
  const speedKph = numberValue(alert.speedKph ?? alert.speedKmH ?? alert.speed);
  return { type, capturedAt, sourceLabel, speedKph: speedKph == null ? undefined : speedKph };
}

function alertFromPoint(reportId: string, type: TimelineAlertType, point: SpeedPoint, extra: Partial<TimelineAlert> = {}): TimelineAlert {
  return {
    id: `${reportId}-${type}-${point.id}`,
    reportId,
    type,
    capturedAt: point.capturedAt,
    minute: point.minute,
    ...extra,
  };
}

function speedingAlerts(reportId: string, points: SpeedPoint[], threshold: number, maximumGapSeconds: number) {
  const alerts: TimelineAlert[] = [];
  let episode: SpeedPoint[] = [];
  const finishEpisode = () => {
    if (!episode.length) return;
    const peak = episode.reduce((highest, point) => point.speedKph > highest.speedKph ? point : highest);
    alerts.push(alertFromPoint(reportId, 'speeding', peak, { speedKph: peak.speedKph }));
    episode = [];
  };
  for (const point of points) {
    if (point.speedKph <= threshold) {
      finishEpisode();
      continue;
    }
    const previous = episode.at(-1);
    const gapSeconds = previous ? (Date.parse(point.capturedAt) - Date.parse(previous.capturedAt)) / 1000 : 0;
    if (previous && (!Number.isFinite(gapSeconds) || gapSeconds > maximumGapSeconds)) finishEpisode();
    episode.push(point);
  }
  finishEpisode();
  return alerts;
}

function harshBrakingAlerts(reportId: string, points: SpeedPoint[], threshold: number, maximumGapSeconds: number) {
  const alerts: TimelineAlert[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const elapsedSeconds = (Date.parse(point.capturedAt) - Date.parse(previous.capturedAt)) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds > maximumGapSeconds) continue;
    const decelerationMps2 = ((previous.speedKph - point.speedKph) / 3.6) / elapsedSeconds;
    if (decelerationMps2 < threshold) continue;
    alerts.push(alertFromPoint(reportId, 'harsh-braking', point, { speedKph: point.speedKph, decelerationMps2 }));
  }
  return alerts;
}

function fallbackAlert(
  reportId: string,
  report: TimelineReport,
  type: TimelineAlertType,
  capturedAtValue: unknown,
  sourceLabel = '',
  speedKph?: number,
) {
  const capturedAt = exactTimestamp(capturedAtValue, report) || exactTimestamp(report.startTime, report);
  const minute = bangkokMinuteOfDay(capturedAt);
  if (!capturedAt || minute == null) return null;
  return {
    id: `${reportId}-${type}-fallback`,
    reportId,
    type,
    capturedAt,
    minute,
    sourceLabel,
    ...(speedKph == null ? {} : { speedKph }),
  } satisfies TimelineAlert;
}

function deduplicateAlerts(alerts: TimelineAlert[]) {
  const seen = new Set<string>();
  return alerts.filter(alert => {
    const second = Math.floor(Date.parse(alert.capturedAt) / 1000);
    const key = `${alert.type}:${Number.isFinite(second) ? second : alert.capturedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}

export function deriveTimelineAlerts(
  reports: TimelineReport[] = [],
  samplesByReportId: Record<string, RawGpsSpeedSample[]> = {},
  options: AlertOptions = {},
) {
  const speedingThresholdKph = options.speedingThresholdKph ?? DEFAULT_SPEEDING_THRESHOLD_KPH;
  const harshBrakingThresholdMps2 = options.harshBrakingThresholdMps2 ?? DEFAULT_HARSH_BRAKING_THRESHOLD_MPS2;
  const maximumBrakingGapSeconds = options.maximumBrakingGapSeconds ?? 30;
  const maximumSpeedingEpisodeGapSeconds = options.maximumSpeedingEpisodeGapSeconds ?? 120;
  const allAlerts: TimelineAlert[] = [];

  reports.forEach((report, reportIndex) => {
    const reportId = reportIdentifier(report, reportIndex);
    const points = normalizeSpeedSamples(samplesByReportId[reportId] || []);
    const reportAlerts: TimelineAlert[] = [
      ...speedingAlerts(reportId, points, speedingThresholdKph, maximumSpeedingEpisodeGapSeconds),
      ...harshBrakingAlerts(reportId, points, harshBrakingThresholdMps2, maximumBrakingGapSeconds),
    ];
    const fallbacks = new Map<TimelineAlertType, ReturnType<typeof explicitAlertDetails>>();

    for (const value of Array.isArray(report.alerts) ? report.alerts : []) {
      const details = explicitAlertDetails(value, report);
      if (!details) continue;
      if (details.capturedAt) {
        const minute = bangkokMinuteOfDay(details.capturedAt);
        if (minute != null) reportAlerts.push({
          id: `${reportId}-${details.type}-explicit-${reportAlerts.length}`,
          reportId,
          type: details.type,
          capturedAt: details.capturedAt,
          minute,
          sourceLabel: details.sourceLabel,
          ...(details.speedKph == null ? {} : { speedKph: details.speedKph }),
        });
      } else if (!fallbacks.has(details.type)) {
        fallbacks.set(details.type, details);
      }
    }

    const topSpeed = reportTopSpeed(report);
    if ((report.speeding === true || Number(report.speedingCount) > 0 || (topSpeed != null && topSpeed > speedingThresholdKph)) && !fallbacks.has('speeding')) {
      fallbacks.set('speeding', { type: 'speeding', capturedAt: '', sourceLabel: '', speedKph: topSpeed == null ? undefined : topSpeed });
    }
    if ((report.harshBraking || report.harshBrake || Number(report.harshBrakingCount) > 0) && !fallbacks.has('harsh-braking')) {
      fallbacks.set('harsh-braking', { type: 'harsh-braking', capturedAt: '', sourceLabel: '' });
    }

    for (const [type, details] of fallbacks) {
      if (reportAlerts.some(alert => alert.type === type)) continue;
      const requestedTime = type === 'speeding'
        ? report.speedingAt
        : type === 'harsh-braking'
          ? report.harshBrakingAt ?? report.harshBrakeAt
          : report.startTime;
      const alert = fallbackAlert(reportId, report, type, requestedTime, details?.sourceLabel, details?.speedKph);
      if (alert) reportAlerts.push(alert);
    }
    allAlerts.push(...reportAlerts);
  });

  return deduplicateAlerts(allAlerts);
}

export function timelineAlertPosition(alert: TimelineAlert, startMinute = 0, endMinute = 24 * 60) {
  if (alert.minute < startMinute || alert.minute > endMinute) return null;
  return ((alert.minute - startMinute) / Math.max(1, endMinute - startMinute)) * 100;
}

export function formatTimelineAlertTime(alert: TimelineAlert, lang = 'en') {
  const date = new Date(alert.capturedAt);
  return Number.isFinite(date.getTime()) ? alertTimeFormatters[lang === 'th' ? 'th' : 'en'].format(date) : '—';
}

export function timelineAlertLabel(alert: TimelineAlert, lang = 'en') {
  if (alert.type === 'speeding') {
    const speed = numberValue(alert.speedKph);
    if (speed != null) {
      const value = Number(speed.toFixed(1)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB');
      return lang === 'th' ? `ความเร็วเกินกำหนด (${value} กม./ชม.)` : `Speeding (${value} km/h)`;
    }
    return lang === 'th' ? 'ความเร็วเกินกำหนด' : 'Speeding';
  }
  if (alert.type === 'harsh-braking') return lang === 'th' ? 'เบรกกะทันหัน' : 'Harsh braking';
  return alert.sourceLabel || (lang === 'th' ? 'การแจ้งเตือน' : 'Alert');
}
