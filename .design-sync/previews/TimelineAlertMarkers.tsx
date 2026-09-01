import * as React from 'react';
import { TimelineAlertMarkers } from 'songdee-ops-panel';

// Markers are position:absolute (top:-11px, translateX(-50%)) and expect a
// positioned timeline track — the app mounts them inside the timeline row
// chart. The wrapper below is preview layout glue only. `minute` is Bangkok
// minute-of-day; the visible window is [startMinute, endMinute].
// Hover/focus tooltips are interaction-only and not captured here.
const Track = ({ children }: { children?: unknown }) => (
  <div style={{ padding: '28px 16px 16px' }}>
    <div style={{ position: 'relative', height: 72, background: '#FFFFFF', border: '1px solid #D7DBDF', borderRadius: 8 }}>{children}</div>
  </div>
);

const minuteOf = (hh: number, mm: number) => hh * 60 + mm;

const morningAlerts = [
  { id: 'r-4101-speeding-1', reportId: 'r-4101', type: 'speeding' as const, capturedAt: '2026-08-20T08:41:12+07:00', minute: minuteOf(8, 41), speedKph: 96.4 },
  { id: 'r-4101-harsh-braking-1', reportId: 'r-4101', type: 'harsh-braking' as const, capturedAt: '2026-08-20T10:05:48+07:00', minute: minuteOf(10, 5), speedKph: 34, decelerationMps2: 4.2 },
  { id: 'r-4101-alert-1', reportId: 'r-4101', type: 'alert' as const, capturedAt: '2026-08-20T11:22:03+07:00', minute: minuteOf(11, 22), sourceLabel: 'Door opened while moving' },
];

const fullDayAlerts = [
  { id: 'r-4102-speeding-1', reportId: 'r-4102', type: 'speeding' as const, capturedAt: '2026-08-20T07:12:30+07:00', minute: minuteOf(7, 12), speedKph: 92.8 },
  { id: 'r-4102-harsh-braking-1', reportId: 'r-4102', type: 'harsh-braking' as const, capturedAt: '2026-08-20T09:48:05+07:00', minute: minuteOf(9, 48), speedKph: 41, decelerationMps2: 3.6 },
  { id: 'r-4102-alert-1', reportId: 'r-4102', type: 'alert' as const, capturedAt: '2026-08-20T14:30:00+07:00', minute: minuteOf(14, 30), sourceLabel: 'ประตูตู้เปิดขณะวิ่ง' },
  { id: 'r-4102-speeding-2', reportId: 'r-4102', type: 'speeding' as const, capturedAt: '2026-08-20T16:55:20+07:00', minute: minuteOf(16, 55), speedKph: 104.2 },
];

// Three episodes inside the same half hour — checks that clustered markers
// stay legible instead of merging into one blob.
const clusteredAlerts = [
  { id: 'r-4103-speeding-1', reportId: 'r-4103', type: 'speeding' as const, capturedAt: '2026-08-20T12:04:10+07:00', minute: minuteOf(12, 4), speedKph: 95.1 },
  { id: 'r-4103-harsh-braking-1', reportId: 'r-4103', type: 'harsh-braking' as const, capturedAt: '2026-08-20T12:11:42+07:00', minute: minuteOf(12, 11), speedKph: 28, decelerationMps2: 5.1 },
  { id: 'r-4103-speeding-2', reportId: 'r-4103', type: 'speeding' as const, capturedAt: '2026-08-20T12:26:55+07:00', minute: minuteOf(12, 26), speedKph: 98.7 },
];

export const MorningShift = () => (
  <Track>
    <TimelineAlertMarkers alerts={morningAlerts} lang="en" startMinute={7 * 60} endMinute={12 * 60} />
  </Track>
);

export const FullDayThai = () => (
  <Track>
    <TimelineAlertMarkers alerts={fullDayAlerts} lang="th" startMinute={6 * 60} endMinute={18 * 60} />
  </Track>
);

export const NoonCluster = () => (
  <Track>
    <TimelineAlertMarkers alerts={clusteredAlerts} lang="en" startMinute={11 * 60} endMinute={14 * 60} interactive={false} />
  </Track>
);
