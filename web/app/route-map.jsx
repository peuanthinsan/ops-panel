'use client';

function project(point, bounds, width, height) {
  const x = bounds.maxLon === bounds.minLon ? width / 2 : ((point.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
  const y = bounds.maxLat === bounds.minLat ? height / 2 : height - ((point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
  return { x: 18 + x * 0.92, y: 18 + y * 0.92 };
}

export default function RouteMap({ anchors = [], samples = [], label = 'Route map' }) {
  const points = [
    ...anchors,
    ...samples.map(sample => ({ latitude: Number(sample.deviceGps?.latitude), longitude: Number(sample.deviceGps?.longitude) }))
      .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
  ];
  if (anchors.length < 2 || points.length < 2) return <div className="route-map-empty">{label}: route coordinates are not available in this Google Maps link.</div>;
  const bounds = {
    minLat: Math.min(...points.map(point => point.latitude)), maxLat: Math.max(...points.map(point => point.latitude)),
    minLon: Math.min(...points.map(point => point.longitude)), maxLon: Math.max(...points.map(point => point.longitude)),
  };
  const width = 520;
  const height = 260;
  const routeLine = anchors.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
  return <div className="route-map" role="img" aria-label={label}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs><pattern id="route-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#e6eaee" strokeWidth="1" /></pattern></defs>
      <rect width="100%" height="100%" fill="#f8fafb" /><rect width="100%" height="100%" fill="url(#route-grid)" />
      <polyline points={routeLine} fill="none" stroke="#e31b23" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity=".22" />
      <polyline points={routeLine} fill="none" stroke="#e31b23" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {samples.map((sample, index) => {
        const point = { latitude: Number(sample.deviceGps?.latitude), longitude: Number(sample.deviceGps?.longitude) };
        if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
        const projected = project(point, bounds, width, height);
        return <circle key={sample.id || index} cx={projected.x} cy={projected.y} r="4.5" fill="#087ca7" stroke="#fff" strokeWidth="2" />;
      })}
      {[anchors[0], anchors.at(-1)].map((point, index) => { const projected = project(point, bounds, width, height); return <circle key={index} cx={projected.x} cy={projected.y} r="6" fill={index ? '#7a1424' : '#14865b'} stroke="#fff" strokeWidth="2" />; })}
    </svg>
    <div className="route-map-legend"><span><i className="route-legend-line" />Saved route</span><span><i className="gps-legend-dot" />Recorded GPS</span></div>
  </div>;
}
