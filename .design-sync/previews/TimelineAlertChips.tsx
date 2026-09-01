import * as React from 'react';
import { TimelineAlertChips } from 'songdee-ops-panel';

// Chips are an inline flex list; the app renders them inside a timeline row.
// The white padded wrapper is preview layout glue only.
const Row = ({ children }: { children?: unknown }) => (
  <div style={{ maxWidth: 620, padding: 16, background: '#FFFFFF', border: '1px solid #D7DBDF', borderRadius: 8 }}>{children}</div>
);

const minuteOf = (hh: number, mm: number) => hh * 60 + mm;

const tripAlerts = [
  { id: 'r-4101-speeding-1', reportId: 'r-4101', type: 'speeding' as const, capturedAt: '2026-08-20T08:41:12+07:00', minute: minuteOf(8, 41), speedKph: 96.4 },
  { id: 'r-4101-harsh-braking-1', reportId: 'r-4101', type: 'harsh-braking' as const, capturedAt: '2026-08-20T10:05:48+07:00', minute: minuteOf(10, 5), speedKph: 34, decelerationMps2: 4.2 },
  { id: 'r-4101-alert-1', reportId: 'r-4101', type: 'alert' as const, capturedAt: '2026-08-20T11:22:03+07:00', minute: minuteOf(11, 22), sourceLabel: 'Door opened while moving' },
];

const thaiAlerts = [
  { id: 'r-4102-speeding-1', reportId: 'r-4102', type: 'speeding' as const, capturedAt: '2026-08-20T07:12:30+07:00', minute: minuteOf(7, 12), speedKph: 92.8 },
  { id: 'r-4102-harsh-braking-1', reportId: 'r-4102', type: 'harsh-braking' as const, capturedAt: '2026-08-20T09:48:05+07:00', minute: minuteOf(9, 48), speedKph: 41, decelerationMps2: 3.6 },
  { id: 'r-4102-alert-1', reportId: 'r-4102', type: 'alert' as const, capturedAt: '2026-08-20T14:30:00+07:00', minute: minuteOf(14, 30), sourceLabel: 'ประตูตู้เปิดขณะวิ่ง' },
];

const busyDayAlerts = [
  ...tripAlerts,
  { id: 'r-4101-speeding-2', reportId: 'r-4101', type: 'speeding' as const, capturedAt: '2026-08-20T13:18:40+07:00', minute: minuteOf(13, 18), speedKph: 101.5 },
  { id: 'r-4101-harsh-braking-2', reportId: 'r-4101', type: 'harsh-braking' as const, capturedAt: '2026-08-20T15:02:11+07:00', minute: minuteOf(15, 2), speedKph: 52, decelerationMps2: 3.9 },
  { id: 'r-4101-speeding-3', reportId: 'r-4101', type: 'speeding' as const, capturedAt: '2026-08-20T16:44:27+07:00', minute: minuteOf(16, 44), speedKph: 94.9 },
];

export const TripAlerts = () => (
  <Row>
    <TimelineAlertChips alerts={tripAlerts} lang="en" />
  </Row>
);

export const ThaiTripAlerts = () => (
  <Row>
    <TimelineAlertChips alerts={thaiAlerts} lang="th" />
  </Row>
);

export const LimitedWithOverflow = () => (
  <Row>
    <TimelineAlertChips alerts={busyDayAlerts} lang="en" limit={3} />
  </Row>
);
