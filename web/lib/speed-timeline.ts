import { bangkokMinuteOfDay } from './timeline-position.ts';

export type RawGpsSpeedSample = {
  id?: string | null;
  capturedAt?: string | null;
  deviceGps?: { speedMps?: number | string | null } | null;
};

export type SpeedPoint = {
  id: string;
  capturedAt: string;
  minute: number;
  speedKph: number;
};

export type SpeedChartPoint = SpeedPoint & { x: number; y: number };

export type ReportSpeedSeries = {
  reportId: string;
  points: SpeedPoint[];
};

export type TimelineSpeedPoint = SpeedPoint & { reportId: string };

export function normalizeSpeedSamples(samples: RawGpsSpeedSample[] = []): SpeedPoint[] {
  const points = samples.flatMap((sample, index) => {
    const capturedAt = String(sample?.capturedAt || '');
    const timestamp = Date.parse(capturedAt);
    const minute = bangkokMinuteOfDay(capturedAt);
    const rawSpeed = sample?.deviceGps?.speedMps;
    const speedMps = Number(rawSpeed);
    if (rawSpeed == null || rawSpeed === '' || !Number.isFinite(timestamp) || minute == null || !Number.isFinite(speedMps) || speedMps < 0) return [];
    return [{
      id: String(sample.id || `${timestamp}-${index}`),
      capturedAt,
      minute,
      speedKph: speedMps * 3.6,
    }];
  });
  points.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  return points;
}

export function speedDomainMaximum(series: SpeedPoint[][], minimum = 100, step = 20) {
  const peak = series.flat().reduce((maximum, point) => Math.max(maximum, point.speedKph), 0);
  return Math.max(minimum, Math.ceil(peak / step) * step);
}

export function mergeReportSpeedSeries(series: ReportSpeedSeries[]): TimelineSpeedPoint[] {
  return series
    .flatMap(item => item.points.map(point => ({ ...point, reportId: item.reportId })))
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}

export function speedChartPoints(
  points: SpeedPoint[],
  options: {
    startMinute?: number;
    endMinute?: number;
    width?: number;
    height?: number;
    top?: number;
    bottom?: number;
    maxSpeed?: number;
  } = {},
): SpeedChartPoint[] {
  const {
    startMinute = 0,
    endMinute = 24 * 60,
    width = 1000,
    height = 72,
    top = 7,
    bottom = 10,
    maxSpeed = 100,
  } = options;
  const minuteSpan = Math.max(1 / 60, endMinute - startMinute);
  const speedSpan = Math.max(1, maxSpeed);
  const chartHeight = Math.max(1, height - top - bottom);
  return points
    .filter(point => point.minute >= startMinute && point.minute <= endMinute)
    .map(point => ({
      ...point,
      x: ((point.minute - startMinute) / minuteSpan) * width,
      y: top + ((speedSpan - Math.min(speedSpan, point.speedKph)) / speedSpan) * chartHeight,
    }));
}

export function speedLinePath(points: SpeedChartPoint[]) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

export type RawTelemetrySample = { id?: string | null; capturedAt?: string | null; speedKph?: number | string | null; totalFuel?: number | string | null };
export type TelemetryResult = { status: string; samples?: RawTelemetrySample[] };
export type TelemetryPoint = {
  id: string; reportId: string; capturedAt: string; minute: number;
  speedKph: number | null; totalFuel: number | null;
  speedObserved: boolean; fuelObserved: boolean;
  sourceReportIds?: string[];
};
export type TelemetryChartPoint = TelemetryPoint & { x: number; speedY: number | null; fuelY: number | null };
export type TelemetryMetric = 'speedKph' | 'totalFuel';

function nonnegativeNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Use paired FMS readings when speed exists; otherwise retain the independent GPS trace.
 * Missing observations break lines. An absent observation from the other source does not.
 * No nearest-time interpolation is used to fabricate paired tooltip values. */
export function reportTelemetryPoints(
  reports: { id: string }[],
  telemetryByReportId: Record<string, TelemetryResult> = {},
  samplesByReportId: Record<string, RawGpsSpeedSample[]> = {},
  originTime = '',
): TelemetryPoint[] {
  const origin = Date.parse(originTime);
  const points = reports.flatMap(report => {
    const result = telemetryByReportId[report.id];
    const api = (result?.status === 'received' ? result.samples || [] : [])
      .filter(sample => Number.isFinite(Date.parse(String(sample.capturedAt || ''))));
    const useApiSpeed = api.some(sample => nonnegativeNumber(sample.speedKph) !== null);
    const byTime = new Map<number, TelemetryPoint>();
    const put = (sample: RawTelemetrySample, index: number, source: 'fms' | 'gps') => {
      const capturedAt = String(sample.capturedAt || '');
      const timestamp = Date.parse(capturedAt);
      const minute = Number.isFinite(origin) ? (timestamp - origin) / 60_000 : bangkokMinuteOfDay(capturedAt);
      if (!Number.isFinite(timestamp) || minute == null) return;
      const point = byTime.get(timestamp) || {
        id: String(sample.id || `${source}-${timestamp}-${index}`), reportId: report.id, capturedAt, minute,
        speedKph: null, totalFuel: null, speedObserved: false, fuelObserved: false,
      };
      if (source === 'gps' || useApiSpeed) { point.speedKph = nonnegativeNumber(sample.speedKph); point.speedObserved = true; }
      if (source === 'fms') { point.totalFuel = nonnegativeNumber(sample.totalFuel); point.fuelObserved = true; }
      byTime.set(timestamp, point);
    };
    api.forEach((sample, index) => put(sample, index, 'fms'));
    if (!useApiSpeed) (samplesByReportId[report.id] || []).forEach((sample, index) => {
      const speedMps = nonnegativeNumber(sample?.deviceGps?.speedMps);
      put({ ...sample, speedKph: speedMps == null ? null : speedMps * 3.6 }, index, 'gps');
    });
    return [...byTime.values()];
  });
  // A vehicle can have overlapping jobs from multiple tablets. Share identical
  // readings, retaining their report membership to establish real continuity.
  const unique = new Map<string, TelemetryPoint>();
  for (const point of points) {
    const key = JSON.stringify([Date.parse(point.capturedAt), point.speedKph, point.totalFuel, point.speedObserved, point.fuelObserved]);
    const existing = unique.get(key);
    if (existing) existing.sourceReportIds = [...new Set([...(existing.sourceReportIds || [existing.reportId]), point.reportId])];
    else unique.set(key, { ...point, sourceReportIds: [point.reportId] });
  }
  return [...unique.values()].sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}

export function telemetryDomainMaximum(points: TelemetryPoint[], metric: TelemetryMetric) {
  const peak = points.reduce((maximum, point) => Math.max(maximum, point[metric] ?? 0), 0);
  if (metric === 'speedKph') return Math.max(100, Math.ceil(peak / 20) * 20);
  if (!peak) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const step = magnitude / 2;
  return Math.ceil(peak / step) * step;
}

export function telemetryChartPoints(points: TelemetryPoint[], {
  startMinute = 0, endMinute = 24 * 60, width = 1000, height = 72, top = 20, bottom = 10,
  maxSpeed = telemetryDomainMaximum(points, 'speedKph'), maxFuel = telemetryDomainMaximum(points, 'totalFuel'),
} = {}): TelemetryChartPoint[] {
  const span = Math.max(1 / 60, endMinute - startMinute);
  const chartHeight = Math.max(1, height - top - bottom);
  const y = (value: number | null, maximum: number) => value == null ? null : top + (1 - value / Math.max(Number.EPSILON, maximum)) * chartHeight;
  return points.filter(point => point.minute >= startMinute && point.minute <= endMinute).map(point => ({
    ...point, x: (point.minute - startMinute) / span * width,
    speedY: y(point.speedKph, maxSpeed), fuelY: y(point.totalFuel, maxFuel),
  }));
}

export function telemetryLinePath(points: TelemetryChartPoint[], metric: TelemetryMetric, maxGapMinutes = 5) {
  let previous: TelemetryChartPoint | null = null;
  const path: string[] = [];
  for (const point of points) {
    if (!(metric === 'speedKph' ? point.speedObserved : point.fuelObserved)) continue;
    const y = metric === 'speedKph' ? point.speedY : point.fuelY;
    if (y == null) { previous = null; continue; }
    const sharesReport = previous && (point.sourceReportIds || [point.reportId]).some(id => (previous.sourceReportIds || [previous.reportId]).includes(id));
    const move = !previous || !sharesReport || point.minute - previous.minute > maxGapMinutes;
    // A zero-length round-capped stroke keeps isolated readings visible without
    // creating one DOM node per sample in a dense or fragmented series.
    path.push(`${move ? 'M' : 'L'}${point.x.toFixed(2)},${y.toFixed(2)}${move ? 'h0' : ''}`);
    previous = point;
  }
  return path.join(' ');
}

/** Bound SVG markers while keeping endpoints and global extrema. Paths retain all readings. */
export function telemetryMarkerPoints(points: TelemetryChartPoint[], limit = 24): TelemetryChartPoint[] {
  const visible = points.filter(point => point.speedY != null || point.fuelY != null);
  if (visible.length <= limit) return visible;
  const selected = new Set([0, visible.length - 1]);
  for (const metric of ['speedKph', 'totalFuel'] as const) {
    const indices = visible.flatMap((point, index) => point[metric] == null ? [] : [index]);
    for (const direction of [-1, 1]) if (indices.length) selected.add(indices.reduce((best, index) => direction * visible[index][metric]! > direction * visible[best][metric]! ? index : best));
  }
  const remaining = Math.max(0, limit - selected.size);
  for (let index = 1; index <= remaining; index++) selected.add(Math.round(index * (visible.length - 1) / (remaining + 1)));
  return [...selected].sort((a, b) => a - b).map(index => visible[index]);
}
