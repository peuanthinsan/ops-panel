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
  const minuteSpan = Math.max(1, endMinute - startMinute);
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
