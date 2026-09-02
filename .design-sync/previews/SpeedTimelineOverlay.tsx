import * as React from 'react';
import { SpeedTimelineOverlay } from 'songdee-ops-panel';

// The overlay is position:absolute inset:0 — it expects a positioned, sized
// track (the app mounts it inside .timeline-speed-track). The wrapper below is
// preview layout glue only. Minutes are Bangkok minute-of-day unless originTime
// is set (originTime remaps to minutes-since-origin).
const Track = ({ children }: { children?: unknown }) => (
  <div style={{ padding: '28px 16px 16px' }}>
    <div style={{ position: 'relative', height: 72, background: '#FFFFFF', border: '1px solid #D7DBDF', borderRadius: 8 }}>{children}</div>
  </div>
);

function samples(reportId: string, baseHour: number, speeds: number[]) {
  return speeds.map((kph, i) => {
    const minute = i * 12;
    const hh = String(baseHour + Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    return {
      id: `${reportId}-${i}`,
      capturedAt: `2026-08-20T${hh}:${mm}:00+07:00`,
      deviceGps: { speedMps: kph / 3.6 },
    };
  });
}

const cityRun = [0, 18, 32, 45, 52, 48, 61, 74, 68, 55, 40, 22, 8, 0];
const highwayRun = [0, 25, 47, 66, 82, 95, 103, 98, 88, 92, 76, 54, 30, 0];

const oneReport = [{ id: 'r-4101' }];
const oneSamples = { 'r-4101': samples('r-4101', 8, highwayRun) };
const twoReports = [{ id: 'r-4101' }, { id: 'r-4102' }];
const twoSamples = {
  'r-4101': samples('r-4101', 8, highwayRun),
  'r-4102': samples('r-4102', 13, cityRun),
};

export const HighwayTrip = () => (
  <Track>
    <SpeedTimelineOverlay reports={oneReport} samplesByReportId={oneSamples} lang="en" startMinute={7 * 60} endMinute={11 * 60} />
  </Track>
);

export const TwoVehiclesThai = () => (
  <Track>
    <SpeedTimelineOverlay reports={twoReports} samplesByReportId={twoSamples} lang="th" startMinute={6 * 60} endMinute={17 * 60} />
  </Track>
);

export const Loading = () => (
  <Track>
    <SpeedTimelineOverlay reports={[]} samplesByReportId={{}} loading lang="en" />
  </Track>
);
