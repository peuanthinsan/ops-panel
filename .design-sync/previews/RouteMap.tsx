import * as React from 'react';
import { RouteMap } from 'songdee-ops-panel';

// Without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY the maps loader rejects immediately
// and RouteMap settles into its CoordinateFallback (saved-route SVG grid +
// warning notice) — that IS the honest static render in this capture harness.
// The wrapper is preview layout glue approximating the drawer's route section.
const Section = ({ children }: { children?: unknown }) => (
  <div style={{ maxWidth: 640, padding: 16 }}>{children}</div>
);

// Saved route: Bangkok (Bang Na) → Laem Chabang along Motorway 7.
const motorway7Anchors = [
  { latitude: 13.668, longitude: 100.635 },
  { latitude: 13.577, longitude: 100.752 },
  { latitude: 13.443, longitude: 100.912 },
  { latitude: 13.361, longitude: 100.984 },
  { latitude: 13.174, longitude: 100.931 },
  { latitude: 13.086, longitude: 100.891 },
];

// Recorded GPS fixes drifting slightly off the saved corridor.
const motorway7Samples = [
  { latitude: 13.664, longitude: 100.641, at: '2026-08-20T08:32:00+07:00' },
  { latitude: 13.628, longitude: 100.689, at: '2026-08-20T08:47:00+07:00' },
  { latitude: 13.581, longitude: 100.748, at: '2026-08-20T09:02:00+07:00' },
  { latitude: 13.512, longitude: 100.833, at: '2026-08-20T09:18:00+07:00' },
  { latitude: 13.447, longitude: 100.905, at: '2026-08-20T09:33:00+07:00' },
  { latitude: 13.372, longitude: 100.978, at: '2026-08-20T09:49:00+07:00' },
  { latitude: 13.264, longitude: 100.958, at: '2026-08-20T10:06:00+07:00' },
  { latitude: 13.171, longitude: 100.928, at: '2026-08-20T10:21:00+07:00' },
  { latitude: 13.089, longitude: 100.894, at: '2026-08-20T10:38:00+07:00' },
].map((point, index) => ({
  id: `gps-${index}`,
  capturedAt: point.at,
  deviceGps: { latitude: point.latitude, longitude: point.longitude },
}));

// Saved route: Bangkok → Nakhon Ratchasima along Mittraphap Road — a
// diagonal corridor, so the stretched 520x260 fallback projection still
// reads as a plausible road path.
const mittraphapAnchors = [
  { latitude: 13.789, longitude: 100.575 },
  { latitude: 14.024, longitude: 100.73 },
  { latitude: 14.53, longitude: 100.91 },
  { latitude: 14.65, longitude: 101.2 },
  { latitude: 14.71, longitude: 101.42 },
  { latitude: 14.89, longitude: 101.72 },
  { latitude: 14.97, longitude: 102.1 },
];

export const SavedRouteWithGps = () => (
  <Section>
    <RouteMap anchors={motorway7Anchors} samples={motorway7Samples} label="Route vs GPS map" lang="en" />
  </Section>
);

export const ThaiSavedRouteOnly = () => (
  <Section>
    <RouteMap anchors={mittraphapAnchors} samples={[]} label="แผนที่เส้นทางเทียบกับ GPS" lang="th" />
  </Section>
);

export const MissingCoordinates = () => (
  <Section>
    <RouteMap anchors={[]} samples={[]} label="Route vs GPS map" lang="en" />
  </Section>
);
