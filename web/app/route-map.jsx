'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsInIcon } from '@phosphor-icons/react/dist/csr/ArrowsIn';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { CrosshairIcon } from '@phosphor-icons/react/dist/csr/Crosshair';
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereWest';
import { MapTrifoldIcon } from '@phosphor-icons/react/dist/csr/MapTrifold';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { reportableOperations } from '../lib/actions';
import { computeGoogleDrivingRoute, loadGoogleMaps } from '../lib/google-maps-loader';
import { groupGpsSamplesByJob } from '../lib/route-map-data.mjs';

const copy = {
  en: {
    loading: 'Loading Google Maps…',
    unavailable: 'Google Maps is unavailable. Showing the saved route and GPS coordinates instead.',
    routeUnavailable: 'Google could not calculate the driving path. Showing the saved route points.',
    savedRoute: 'Saved route',
    workPeriod: 'Work period',
    selectedJob: 'Selected job',
    deviation: 'Selected-job deviation',
    point: 'point', points: 'points', fixCount: 'GPS fix', fixesCount: 'GPS fixes', job: 'job', jobs: 'jobs', event: 'event', events: 'events',
    noCoordinates: 'No saved-route or work-period GPS coordinates are available.',
    mapControls: 'Map controls',
    mapStyle: 'Map style',
    roadmap: 'Map',
    satellite: 'Satellite',
    showRoadmap: 'Show road map',
    showSatellite: 'Show satellite imagery',
    viewControls: 'Map view',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitRoute: 'Fit work period',
    enterFullscreen: 'View map fullscreen',
    exitFullscreen: 'Exit fullscreen map',
    gpsJobs: 'GPS jobs',
    fixSummary: '{fixes} GPS fixes · {locations} map locations · {mapped} of {jobs} jobs mapped',
    allFixesVisible: 'Every GPS fix is listed below.',
    jobsWithoutFix: '{count} jobs have no GPS fix.',
    unlinkedFix: '{count} GPS fixes are not linked to a saved job.',
    mapLocation: 'Map location',
    mapLocationTitle: 'Map location {location}: {count} GPS fixes',
    oneFixAtLocation: '1 GPS fix at this location',
    fixesAtLocation: '{count} GPS fixes at this location',
    fix: 'GPS fix',
    activity: 'Activity',
    reportId: 'Report ID',
    jobTime: 'Job start–end',
    fixTime: 'GPS fix time',
    coordinates: 'Coordinates',
    route: 'Route',
    status: 'Status',
    noRoute: 'No route',
    unlinkedJob: 'Unlinked GPS fix',
    selectedBadge: 'Selected job',
    openJob: 'Open job',
    currentJob: 'Current job',
    openJobUnavailable: 'No saved job is linked to this GPS fix',
  },
  th: {
    loading: 'กำลังโหลด Google Maps…',
    unavailable: 'ไม่สามารถโหลด Google Maps ได้ กำลังแสดงพิกัดเส้นทางและ GPS แทน',
    routeUnavailable: 'Google ไม่สามารถคำนวณเส้นทางขับรถได้ กำลังแสดงจุดเส้นทางที่บันทึกไว้',
    savedRoute: 'เส้นทางที่บันทึก',
    workPeriod: 'รอบงาน',
    selectedJob: 'งานที่เลือก',
    deviation: 'จุดออกนอกเส้นทางของงานที่เลือก',
    point: 'จุด', points: 'จุด', fixCount: 'จุด GPS', fixesCount: 'จุด GPS', job: 'งาน', jobs: 'งาน', event: 'เหตุการณ์', events: 'เหตุการณ์',
    noCoordinates: 'ไม่พบพิกัดเส้นทางที่บันทึกหรือพิกัด GPS ของรอบงาน',
    mapControls: 'ตัวควบคุมแผนที่',
    mapStyle: 'รูปแบบแผนที่',
    roadmap: 'แผนที่',
    satellite: 'ดาวเทียม',
    showRoadmap: 'แสดงแผนที่ถนน',
    showSatellite: 'แสดงภาพถ่ายดาวเทียม',
    viewControls: 'มุมมองแผนที่',
    zoomIn: 'ซูมเข้า',
    zoomOut: 'ซูมออก',
    fitRoute: 'แสดงรอบงานทั้งหมด',
    enterFullscreen: 'แสดงแผนที่เต็มหน้าจอ',
    exitFullscreen: 'ออกจากแผนที่เต็มหน้าจอ',
    gpsJobs: 'งานและจุด GPS',
    fixSummary: 'จุด GPS {fixes} จุด · ตำแหน่งบนแผนที่ {locations} แห่ง · มีพิกัด {mapped} จาก {jobs} งาน',
    allFixesVisible: 'จุด GPS ทุกจุดแสดงอยู่ด้านล่าง',
    jobsWithoutFix: '{count} งานไม่มีจุด GPS',
    unlinkedFix: 'จุด GPS {count} จุดไม่ได้เชื่อมกับงานที่บันทึก',
    mapLocation: 'ตำแหน่งบนแผนที่',
    mapLocationTitle: 'ตำแหน่งบนแผนที่ {location}: จุด GPS {count} จุด',
    oneFixAtLocation: 'จุด GPS 1 จุด ณ ตำแหน่งนี้',
    fixesAtLocation: 'จุด GPS {count} จุด ณ ตำแหน่งนี้',
    fix: 'จุด GPS',
    activity: 'กิจกรรม',
    reportId: 'รหัสรายงาน',
    jobTime: 'เวลาเริ่ม–จบงาน',
    fixTime: 'เวลาพิกัด GPS',
    coordinates: 'พิกัด',
    route: 'เส้นทาง',
    status: 'สถานะ',
    noRoute: 'ไม่มีเส้นทาง',
    unlinkedJob: 'จุด GPS ที่ไม่เชื่อมกับงาน',
    selectedBadge: 'งานที่เลือก',
    openJob: 'เปิดงาน',
    currentJob: 'งานปัจจุบัน',
    openJobUnavailable: 'ไม่มีงานที่บันทึกเชื่อมกับจุด GPS นี้',
  },
};

function normalizePoint(point) {
  const latitudeValue = point?.latitude ?? point?.lat;
  const longitudeValue = point?.longitude ?? point?.lng;
  if (latitudeValue == null || longitudeValue == null || String(latitudeValue).trim() === '' || String(longitudeValue).trim() === '') return null;
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function project(point, bounds, width, height) {
  const x = bounds.maxLon === bounds.minLon ? width / 2 : ((point.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
  const y = bounds.maxLat === bounds.minLat ? height / 2 : height - ((point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
  return { x: 18 + x * 0.92, y: 18 + y * 0.92 };
}

function CoordinateFallback({ anchors, gpsGroups, trailPoints = [], locationClusters = [], activeClusterKey = '', deviations = [], label, message, onSelectCluster }) {
  const points = [...anchors, ...trailPoints, ...deviations];
  if (!points.length) return <div className="route-map-empty">{label}: {message}</div>;
  const bounds = {
    minLat: Math.min(...points.map(point => point.latitude)), maxLat: Math.max(...points.map(point => point.latitude)),
    minLon: Math.min(...points.map(point => point.longitude)), maxLon: Math.max(...points.map(point => point.longitude)),
  };
  const width = 520;
  const height = 260;
  const routeLine = anchors.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
  const workPeriodLine = trailPoints.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
  // SVG uses painter's order instead of CSS z-index, so render the active stack last.
  const renderedLocationClusters = [
    ...locationClusters.filter(cluster => cluster.key !== activeClusterKey),
    ...locationClusters.filter(cluster => cluster.key === activeClusterKey),
  ];
  return <div className="route-map-fallback">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label={label}>
      <title>{label}</title>
      <defs><pattern id="route-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#e6eaee" strokeWidth="1" /></pattern></defs>
      <rect width="100%" height="100%" fill="#f8fafb" /><rect width="100%" height="100%" fill="url(#route-grid)" />
      {anchors.length > 1 ? <>
        <polyline points={routeLine} fill="none" stroke="#e31b23" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity=".22" />
        <polyline points={routeLine} fill="none" stroke="#e31b23" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </> : null}
      {trailPoints.length > 1 ? <>
        <polyline points={workPeriodLine} fill="none" stroke="#FFFFFF" strokeWidth="8" strokeDasharray="10 8" strokeLinecap="round" strokeLinejoin="round" opacity=".96" />
        <polyline points={workPeriodLine} fill="none" stroke="#0B6F70" strokeWidth="4" strokeDasharray="10 8" strokeLinecap="round" strokeLinejoin="round" opacity=".98" />
      </> : null}
      {gpsGroups.map(group => {
        const line = group.points.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
        const color = group.selected ? '#087CA7' : '#0B6F70';
        return <g key={group.jobId}>
          {group.selected && group.points.length > 1 ? <polyline points={line} fill="none" stroke="#FFFFFF" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity=".98" /> : null}
          {group.selected && group.points.length > 1 ? <polyline points={line} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </g>;
      })}
      {renderedLocationClusters.map(cluster => {
        const projected = project(cluster, bounds, width, height);
        const active = cluster.key === activeClusterKey;
        const radius = cluster.count > 1 ? 11 : 7;
        const color = '#0B6F70';
        const activate = event => {
          if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
          if (event.type === 'keydown') event.preventDefault();
          onSelectCluster(cluster.key);
        };
        return <g
          key={cluster.id}
          className={`route-map-cluster-marker${active ? ' is-active' : ''}${cluster.selected ? ' contains-selected' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={cluster.title}
          aria-pressed={active}
          onClick={activate}
          onKeyDown={activate}
        >
          <title>{cluster.title}</title>
          <circle className="route-cluster-focus-ring" cx={projected.x} cy={projected.y} r={radius + 5} fill="transparent" stroke="transparent" strokeWidth="3" />
          {cluster.selected ? <circle cx={projected.x} cy={projected.y} r={radius + 3} fill="#fff" stroke="#087CA7" strokeWidth="2.5" /> : null}
          <circle cx={projected.x} cy={projected.y} r={radius} fill={color} stroke="#fff" strokeWidth="2.5" />
          {cluster.count > 1 ? <text className="route-cluster-count" x={projected.x} y={projected.y} textAnchor="middle" dominantBaseline="central">{cluster.count}</text> : null}
        </g>;
      })}
      {deviations.map((point, index) => { const projected = project(point, bounds, width, height); return <circle key={`deviation-${index}`} cx={projected.x} cy={projected.y} r="7" fill="#B92B3A" stroke="#fff" strokeWidth="2.5" />; })}
    </svg>
  </div>;
}

function markerIcon(google, color, scale = 5, fillOpacity = 1, strokeWeight = 2) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    fillColor: color,
    fillOpacity,
    strokeColor: '#fff',
    strokeWeight,
  };
}

function clusterMarkerIcon(google, count, selected, active) {
  const size = count > 9 ? 46 : 40;
  const center = size / 2;
  const innerRadius = 12;
  const activeRing = active
    ? `<circle cx="${center}" cy="${center}" r="18" fill="none" stroke="#111" stroke-width="2.5"/>`
    : '';
  const countText = count > 1
    ? `<text x="${center}" y="${center + 1}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Arial,sans-serif" font-size="${count > 9 ? 12 : 13}" font-weight="700">${count}</text>`
    : '';
  const selectedRing = selected
    ? `<circle cx="${center}" cy="${center}" r="15" fill="#fff" stroke="#087CA7" stroke-width="2.5"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${activeRing}${selectedRing}<circle cx="${center}" cy="${center}" r="${innerRadius}" fill="#0B6F70" stroke="#fff" stroke-width="3"/>${countText}</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(center, center),
  };
}

function dashedLineIcons(color, strokeWeight) {
  return [{
    icon: {
      path: 'M 0,-1 0,1',
      strokeColor: color,
      strokeOpacity: 1,
      strokeWeight,
      scale: 4,
    },
    offset: '0',
    repeat: '16px',
  }];
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function fixKey(point) {
  return point.sampleId || `${point.jobId}:${point.capturedAtMs ?? 'unknown'}:${point.sourceIndex}`;
}

function displayTime(value, lang) {
  const date = value == null ? null : new Date(value);
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function displayCoordinate(point) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    : '—';
}

const thaiActivities = Object.fromEntries(reportableOperations.map(([, thai, english]) => [english, thai]));

const thaiStatuses = { Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };

function displayActivity(value, lang) {
  return lang === 'th' ? thaiActivities[value] || value || '—' : value || '—';
}

function displayStatus(value, lang) {
  return lang === 'th' ? thaiStatuses[value] || value || '—' : value || '—';
}

export default function RouteMap({ anchors = [], samples = [], reports = [], deviationEvents = [], selectedJobId = '', workPeriodJobCount, label = 'Route map', lang = 'en', onOpenJob }) {
  const t = copy[lang] || copy.en;
  const bodyRef = useRef(null);
  const detailRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapBoundsRef = useRef(null);
  const clusterLayerRef = useRef(null);
  const activeClusterKeyRef = useRef('');
  const routePoints = useMemo(() => anchors.map(normalizePoint).filter(Boolean), [anchors]);
  const gpsData = useMemo(() => groupGpsSamplesByJob(samples, selectedJobId), [samples, selectedJobId]);
  const recordedPoints = gpsData.trailPoints;
  const locationClusters = gpsData.locationClusters || [];
  const reportsById = useMemo(() => new Map(reports.map(report => [String(report?.id || ''), report])), [reports]);
  const clusterMembershipByFixKey = useMemo(() => {
    const membership = new Map();
    locationClusters.forEach((cluster, index) => {
      for (const point of cluster.points) membership.set(fixKey(point), { clusterKey: cluster.key, clusterIndex: index + 1 });
    });
    return membership;
  }, [locationClusters]);
  const fixRows = useMemo(() => recordedPoints.map((point, index) => {
    const pointFixKey = fixKey(point);
    const membership = clusterMembershipByFixKey.get(pointFixKey);
    return {
      ...point,
      fixKey: pointFixKey,
      clusterKey: membership?.clusterKey || '',
      clusterIndex: membership?.clusterIndex || 0,
      chronologicalIndex: index + 1,
      report: reportsById.get(String(point.jobId || '')) || null,
    };
  }), [clusterMembershipByFixKey, recordedPoints, reportsById]);
  const visualClusters = useMemo(() => locationClusters.map((cluster, index) => ({
    ...cluster,
    locationIndex: index + 1,
    title: t.mapLocationTitle
      .replace('{location}', String(index + 1))
      .replace('{count}', String(cluster.count)),
  })), [lang, locationClusters, t.mapLocationTitle]);
  const deviationPoints = useMemo(() => deviationEvents.map(normalizePoint).filter(Boolean), [deviationEvents]);
  const [state, setState] = useState('loading');
  const [mapType, setMapType] = useState('roadmap');
  const [supportsFullscreen, setSupportsFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeClusterKey, setActiveClusterKey] = useState('');
  const [activeFixKey, setActiveFixKey] = useState('');
  activeClusterKeyRef.current = activeClusterKey;

  const activateCluster = useCallback(clusterKey => {
    const clusterFixes = fixRows.filter(point => point.clusterKey === clusterKey);
    const preferred = clusterFixes.find(point => String(point.jobId) === String(selectedJobId)) || clusterFixes[0];
    setActiveClusterKey(clusterKey);
    setActiveFixKey(preferred?.fixKey || '');
    window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest' }));
  }, [fixRows, selectedJobId]);

  const activateFix = useCallback(point => {
    setActiveClusterKey(point.clusterKey);
    setActiveFixKey(point.fixKey);
    window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest' }));
  }, []);

  useEffect(() => {
    const preferred = fixRows.find(point => String(point.jobId) === String(selectedJobId)) || fixRows[0];
    setActiveClusterKey(preferred?.clusterKey || '');
    setActiveFixKey(preferred?.fixKey || '');
  }, [fixRows, selectedJobId]);

  useEffect(() => {
    clusterLayerRef.current?.forEach(feature => {
      feature.setProperty('active', String(feature.getProperty('clusterKey') || '') === activeClusterKey);
    });
  }, [activeClusterKey]);

  useEffect(() => {
    setSupportsFullscreen(Boolean(document.fullscreenEnabled && bodyRef.current?.requestFullscreen && document.exitFullscreen));

    function syncFullscreenState() {
      const fullscreen = document.fullscreenElement === bodyRef.current;
      setIsFullscreen(fullscreen);

      const map = mapRef.current;
      const mapsEvent = window.google?.maps?.event;
      if (!map || !mapsEvent) return;
      const center = map.getCenter();
      window.requestAnimationFrame(() => {
        mapsEvent.trigger(map, 'resize');
        if (center) map.setCenter(center);
      });
    }

    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!routePoints.length && !recordedPoints.length && !deviationPoints.length) { setState('empty'); return undefined; }
    let cancelled = false;
    let map = null;
    let clusterLayer = null;
    const overlays = [];
    const listeners = [];

    async function renderMap() {
      try {
        const google = await loadGoogleMaps(lang);
        if (cancelled || !containerRef.current) return;
        const initialPoint = routePoints[0] || recordedPoints[0] || deviationPoints[0];
        map = new google.maps.Map(containerRef.current, {
          center: { lat: initialPoint.latitude, lng: initialPoint.longitude },
          zoom: 7,
          mapTypeId: google.maps.MapTypeId.ROADMAP,
          disableDefaultUI: true,
          mapTypeControl: false,
          zoomControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          rotateControl: false,
          scaleControl: false,
          gestureHandling: 'cooperative',
        });
        mapRef.current = map;
        setMapType('roadmap');

        let displayedRoute = routePoints;
        let routeState = 'ready';
        if (routePoints.length > 1) {
          try {
            const computed = await computeGoogleDrivingRoute(routePoints, lang);
            if (cancelled) return;
            displayedRoute = computed.path.map(normalizePoint).filter(Boolean);
          } catch (error) {
            console.error('[RouteMap] Google driving route failed:', error);
            routeState = 'route-unavailable';
          }
        }

        const routePath = displayedRoute.map(point => ({ lat: point.latitude, lng: point.longitude }));
        if (routePath.length > 1) overlays.push(new google.maps.Polyline({
          map, path: routePath, strokeColor: '#E31B23', strokeOpacity: 0.95, strokeWeight: 5, zIndex: 20,
        }));
        if (routePath.length) {
          const routePointLayer = new google.maps.Data({ map });
          routePointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point(routePath[0]), properties: { color: '#14865B', scale: 7 } }));
          if (routePath.length > 1) routePointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point(routePath.at(-1)), properties: { color: '#7A1424', scale: 7 } }));
          routePointLayer.setStyle(feature => ({
            clickable: false,
            icon: markerIcon(google, feature.getProperty('color'), feature.getProperty('scale')),
            zIndex: 30,
          }));
          overlays.push(routePointLayer);
        }

        const workPeriodPath = gpsData.trailPoints.map(point => ({ lat: point.latitude, lng: point.longitude }));
        if (workPeriodPath.length > 1) {
          overlays.push(new google.maps.Polyline({
            map,
            path: workPeriodPath,
            strokeOpacity: 0,
            icons: dashedLineIcons('#FFFFFF', 8),
            zIndex: 31,
          }));
          overlays.push(new google.maps.Polyline({
            map,
            path: workPeriodPath,
            strokeOpacity: 0,
            icons: dashedLineIcons('#0B6F70', 4),
            zIndex: 32,
          }));
        }

        for (const group of gpsData.groups) {
          const gpsPath = group.points.map(point => ({ lat: point.latitude, lng: point.longitude }));
          const color = group.selected ? '#087CA7' : '#0B6F70';
          if (group.selected && gpsPath.length > 1) {
            overlays.push(new google.maps.Polyline({
              map,
              path: gpsPath,
              strokeColor: '#FFFFFF',
              strokeOpacity: 0.98,
              strokeWeight: 10,
              zIndex: 45,
            }));
            overlays.push(new google.maps.Polyline({
              map,
              path: gpsPath,
              strokeColor: color,
              strokeOpacity: 1,
              strokeWeight: 6,
              zIndex: 46,
            }));
          }
        }

        if (visualClusters.length) {
          clusterLayer = new google.maps.Data({ map });
          clusterLayerRef.current = clusterLayer;
          for (const cluster of visualClusters) {
            clusterLayer.add(new google.maps.Data.Feature({
              geometry: new google.maps.Data.Point({ lat: cluster.latitude, lng: cluster.longitude }),
              properties: {
                clusterKey: cluster.key,
                count: cluster.count,
                selected: cluster.selected,
                active: cluster.key === activeClusterKeyRef.current,
                title: cluster.title,
              },
            }));
          }
          clusterLayer.setStyle(feature => ({
            clickable: true,
            cursor: 'pointer',
            icon: clusterMarkerIcon(google, Number(feature.getProperty('count')), Boolean(feature.getProperty('selected')), Boolean(feature.getProperty('active'))),
            title: feature.getProperty('title'),
            zIndex: feature.getProperty('active') ? 1_000 : feature.getProperty('selected') ? 72 : 60,
          }));
          listeners.push(clusterLayer.addListener('click', event => {
            const clusterKey = String(event.feature.getProperty('clusterKey') || '');
            if (clusterKey) activateCluster(clusterKey);
          }));
          overlays.push(clusterLayer);
        }

        if (deviationPoints.length) {
          const deviationLayer = new google.maps.Data({ map });
          for (const point of deviationPoints) {
            deviationLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point({ lat: point.latitude, lng: point.longitude }), properties: { color: '#B92B3A', scale: 9 } }));
          }
          deviationLayer.setStyle(feature => ({
            clickable: false,
            icon: markerIcon(google, feature.getProperty('color'), feature.getProperty('scale'), 1, 3),
            zIndex: 70,
          }));
          overlays.push(deviationLayer);
        }

        const bounds = new google.maps.LatLngBounds();
        for (const point of [...routePath, ...recordedPoints.map(point => ({ lat: point.latitude, lng: point.longitude })), ...deviationPoints.map(point => ({ lat: point.latitude, lng: point.longitude }))]) bounds.extend(point);
        mapBoundsRef.current = bounds;
        map.fitBounds(bounds, 34);
        google.maps.event.addListenerOnce(map, 'idle', () => {
          if (Number(map?.getZoom()) > 17) map.setZoom(17);
        });
        setState(routeState);
      } catch (error) {
        if (cancelled) return;
        if (!String(error?.message || '').includes('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured')) {
          console.error('[RouteMap] Google Maps failed to load:', error);
        }
        setState('unavailable');
      }
    }

    setState('loading');
    void renderMap();
    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove?.();
      for (const overlay of overlays) overlay.setMap?.(null);
      if (map && window.google?.maps?.event) window.google.maps.event.clearInstanceListeners(map);
      if (mapRef.current === map) mapRef.current = null;
      if (clusterLayerRef.current === clusterLayer) clusterLayerRef.current = null;
      mapBoundsRef.current = null;
    };
  }, [activateCluster, deviationPoints, gpsData.groups, lang, recordedPoints, routePoints, visualClusters]);

  function changeMapType(nextType) {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(nextType);
    setMapType(nextType);
  }

  function changeZoom(amount) {
    const map = mapRef.current;
    const currentZoom = Number(map?.getZoom());
    if (!map || !Number.isFinite(currentZoom)) return;
    map.setZoom(Math.max(2, Math.min(20, currentZoom + amount)));
  }

  function fitRoute() {
    if (!mapRef.current || !mapBoundsRef.current) return;
    mapRef.current.fitBounds(mapBoundsRef.current, 34);
  }

  async function toggleFullscreen() {
    const body = bodyRef.current;
    if (!supportsFullscreen || !body) return;
    try {
      if (document.fullscreenElement === body) await document.exitFullscreen();
      else await body.requestFullscreen();
    } catch (error) {
      console.error('[RouteMap] Fullscreen request failed:', error);
    }
  }

  if (state === 'empty') return <div className="route-map-empty">{label}: {t.noCoordinates}</div>;
  const fallback = state === 'unavailable';
  const controlsDisabled = state === 'loading';
  const jobCount = Math.max(0, Number.isFinite(Number(workPeriodJobCount)) ? Number(workPeriodJobCount) : gpsData.jobCount);
  const mappedJobCount = new Set(fixRows.filter(point => point.report).map(point => String(point.report.id))).size;
  const jobsWithoutFixCount = Math.max(0, jobCount - mappedJobCount);
  const unlinkedFixCount = fixRows.filter(point => !point.report).length;
  const activeFix = fixRows.find(point => point.fixKey === activeFixKey) || fixRows[0] || null;
  const activeClusterFixes = activeFix
    ? fixRows.filter(point => point.clusterKey === activeFix.clusterKey)
    : [];
  const activeReport = activeFix?.report || null;
  const activeIsSelectedJob = String(activeFix?.jobId || '') === String(selectedJobId || '');
  const fixSummary = t.fixSummary
    .replace('{fixes}', String(gpsData.pointCount))
    .replace('{locations}', String(visualClusters.length))
    .replace('{mapped}', String(mappedJobCount))
    .replace('{jobs}', String(jobCount));
  return <div className="route-map" role="region" aria-label={label}>
    <div ref={bodyRef} className={`route-map-body${isFullscreen ? ' is-fullscreen' : ''}`}>
      {!fallback ? <div ref={containerRef} className="route-map-canvas" /> : <CoordinateFallback anchors={routePoints} gpsGroups={gpsData.groups} trailPoints={gpsData.trailPoints} locationClusters={visualClusters} activeClusterKey={activeClusterKey} deviations={deviationPoints} label={label} message={t.noCoordinates} onSelectCluster={activateCluster} />}
      {!fallback ? <div className="route-map-controls" role="group" aria-label={t.mapControls}>
        <div className="route-map-type-control" role="group" aria-label={t.mapStyle}>
          <button type="button" className={`route-map-control-button route-map-type-button${mapType === 'roadmap' ? ' is-active' : ''}`} aria-label={t.showRoadmap} aria-pressed={mapType === 'roadmap'} title={t.showRoadmap} disabled={controlsDisabled} onClick={() => changeMapType('roadmap')}>
            <MapTrifoldIcon size={16} weight="bold" aria-hidden="true" />
            <span className="route-map-control-label">{t.roadmap}</span>
          </button>
          <button type="button" className={`route-map-control-button route-map-type-button${mapType === 'satellite' ? ' is-active' : ''}`} aria-label={t.showSatellite} aria-pressed={mapType === 'satellite'} title={t.showSatellite} disabled={controlsDisabled} onClick={() => changeMapType('satellite')}>
            <GlobeHemisphereWestIcon size={16} weight="bold" aria-hidden="true" />
            <span className="route-map-control-label">{t.satellite}</span>
          </button>
        </div>
        <div className="route-map-view-controls" role="group" aria-label={t.viewControls}>
          <button type="button" className="route-map-control-button route-map-icon-button" aria-label={t.zoomIn} title={t.zoomIn} disabled={controlsDisabled} onClick={() => changeZoom(1)}><PlusIcon size={16} weight="bold" aria-hidden="true" /></button>
          <button type="button" className="route-map-control-button route-map-icon-button" aria-label={t.zoomOut} title={t.zoomOut} disabled={controlsDisabled} onClick={() => changeZoom(-1)}><MinusIcon size={16} weight="bold" aria-hidden="true" /></button>
          <button type="button" className="route-map-control-button route-map-icon-button" aria-label={t.fitRoute} title={t.fitRoute} disabled={controlsDisabled} onClick={fitRoute}><CrosshairIcon size={16} weight="bold" aria-hidden="true" /></button>
          {supportsFullscreen ? <button type="button" className="route-map-control-button route-map-icon-button route-map-fullscreen-button" aria-label={isFullscreen ? t.exitFullscreen : t.enterFullscreen} title={isFullscreen ? t.exitFullscreen : t.enterFullscreen} disabled={controlsDisabled} aria-pressed={isFullscreen} onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <ArrowsInIcon size={16} weight="bold" aria-hidden="true" /> : <ArrowsOutIcon size={16} weight="bold" aria-hidden="true" />}
          </button> : null}
        </div>
      </div> : null}
      {state === 'loading' ? <div className="route-map-notice" role="status">{t.loading}</div> : null}
      {state === 'route-unavailable' ? <div className="route-map-notice warning" role="status">{t.routeUnavailable}</div> : null}
      {fallback ? <div className="route-map-notice warning" role="status">{t.unavailable}</div> : null}
    </div>
    <div className="route-map-legend">
      {routePoints.length ? <span><i className="route-legend-line" />{t.savedRoute} · {countLabel(routePoints.length, t.point, t.points)}</span> : null}
      {recordedPoints.length ? <span><i className="work-period-legend-line" />{t.workPeriod} · {countLabel(jobCount, t.job, t.jobs)} · {countLabel(gpsData.pointCount, t.fixCount, t.fixesCount)}</span> : null}
      {selectedJobId ? <span><i className="selected-job-legend-dot" />{t.selectedJob} · {countLabel(gpsData.selectedPointCount, t.fixCount, t.fixesCount)}</span> : null}
      {deviationPoints.length ? <span><i className="route-deviation-dot" />{t.deviation} · {countLabel(deviationPoints.length, t.event, t.events)}</span> : null}
    </div>
    {fixRows.length ? <section className="gps-fix-tray" aria-labelledby="gps-fix-tray-heading">
      <header className="gps-fix-tray-heading">
        <div><h3 id="gps-fix-tray-heading">{t.gpsJobs}</h3><strong>{fixSummary}</strong></div>
        <p>{t.allFixesVisible}{jobsWithoutFixCount ? ` ${t.jobsWithoutFix.replace('{count}', String(jobsWithoutFixCount))}` : ''}{unlinkedFixCount ? ` ${t.unlinkedFix.replace('{count}', String(unlinkedFixCount))}` : ''}</p>
      </header>
      <ol className="gps-fix-tray-list">
        {fixRows.map(point => {
          const selected = String(point.jobId) === String(selectedJobId);
          const active = point.fixKey === activeFix?.fixKey;
          const activity = point.report ? displayActivity(point.report.mode, lang) : t.unlinkedJob;
          return <li key={point.fixKey}>
            <button
              type="button"
              className={`gps-fix-tray-button${active ? ' is-active' : ''}${selected ? ' is-selected-job' : ''}`}
              aria-pressed={active}
              aria-label={`${t.fix} ${point.chronologicalIndex}: ${activity}, ${displayTime(point.capturedAt, lang)}, ${t.mapLocation} ${point.clusterIndex}`}
              onClick={() => activateFix(point)}
            >
              <span className="gps-fix-order" aria-hidden="true">{point.chronologicalIndex}</span>
              <span className="gps-fix-tray-copy"><strong>{activity}</strong><small>{displayTime(point.capturedAt, lang)} · {t.mapLocation} {point.clusterIndex}</small></span>
              {selected ? <span className="gps-fix-selected-dot" title={t.selectedBadge} aria-hidden="true" /> : null}
            </button>
          </li>;
        })}
      </ol>
      {activeFix ? <div ref={detailRef} className="gps-location-detail" aria-live="polite">
        <div className="gps-location-detail-heading">
          <div><strong>{activeClusterFixes.length === 1 ? t.oneFixAtLocation : t.fixesAtLocation.replace('{count}', String(activeClusterFixes.length))}</strong><small>{t.mapLocation} {activeFix.clusterIndex} · {displayCoordinate(activeFix)}</small></div>
          {activeClusterFixes.length > 1 ? <ul className="gps-location-stack" aria-label={t.fixesAtLocation.replace('{count}', String(activeClusterFixes.length))}>
            {activeClusterFixes.map(point => <li key={point.fixKey}><button
              type="button"
              className={point.fixKey === activeFix.fixKey ? 'is-active' : ''}
              aria-pressed={point.fixKey === activeFix.fixKey}
              onClick={() => activateFix(point)}
            >
              <span>{point.chronologicalIndex}</span>{point.report ? displayActivity(point.report.mode, lang) : t.unlinkedJob}
            </button></li>)}
          </ul> : null}
        </div>
        <article className="gps-fix-detail-card">
          <header><strong>{activeReport ? displayActivity(activeReport.mode, lang) : t.unlinkedJob}</strong>{activeIsSelectedJob ? <span>{t.selectedBadge}</span> : null}</header>
          <dl>
            <div><dt>{t.activity}</dt><dd>{activeReport ? displayActivity(activeReport.mode, lang) : t.unlinkedJob}</dd></div>
            <div><dt>{t.reportId}</dt><dd>{activeReport?.id || '—'}</dd></div>
            <div><dt>{t.jobTime}</dt><dd>{activeReport ? `${displayTime(activeReport.startTime, lang)}–${displayTime(activeReport.endTime, lang)}` : '—'}</dd></div>
            <div><dt>{t.fixTime}</dt><dd>{displayTime(activeFix.capturedAt, lang)}</dd></div>
            <div><dt>{t.coordinates}</dt><dd>{displayCoordinate(activeFix)}</dd></div>
            <div><dt>{t.route}</dt><dd>{activeReport?.routeName || t.noRoute}</dd></div>
            <div><dt>{t.status}</dt><dd>{activeReport ? displayStatus(activeReport.status, lang) : '—'}</dd></div>
          </dl>
          <button type="button" className="gps-open-job-button" disabled={!activeReport || !onOpenJob || activeIsSelectedJob} title={!activeReport ? t.openJobUnavailable : undefined} onClick={() => activeReport && !activeIsSelectedJob && onOpenJob?.(activeReport)}>{activeIsSelectedJob ? t.currentJob : t.openJob}</button>
        </article>
      </div> : null}
    </section> : null}
  </div>;
}
