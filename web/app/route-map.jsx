'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsInIcon } from '@phosphor-icons/react/dist/csr/ArrowsIn';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { CrosshairIcon } from '@phosphor-icons/react/dist/csr/Crosshair';
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereWest';
import { MapTrifoldIcon } from '@phosphor-icons/react/dist/csr/MapTrifold';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
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
    point: 'point', points: 'points', job: 'job', jobs: 'jobs', event: 'event', events: 'events',
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
  },
  th: {
    loading: 'กำลังโหลด Google Maps…',
    unavailable: 'ไม่สามารถโหลด Google Maps ได้ กำลังแสดงพิกัดเส้นทางและ GPS แทน',
    routeUnavailable: 'Google ไม่สามารถคำนวณเส้นทางขับรถได้ กำลังแสดงจุดเส้นทางที่บันทึกไว้',
    savedRoute: 'เส้นทางที่บันทึก',
    workPeriod: 'รอบงาน',
    selectedJob: 'งานที่เลือก',
    deviation: 'จุดออกนอกเส้นทางของงานที่เลือก',
    point: 'จุด', points: 'จุด', job: 'งาน', jobs: 'งาน', event: 'เหตุการณ์', events: 'เหตุการณ์',
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

function CoordinateFallback({ anchors, gpsGroups, trailPoints = [], deviations = [], label, message }) {
  const gps = gpsGroups.flatMap(group => group.points);
  const points = [...anchors, ...gps, ...deviations];
  if (!points.length) return <div className="route-map-empty">{label}: {message}</div>;
  const bounds = {
    minLat: Math.min(...points.map(point => point.latitude)), maxLat: Math.max(...points.map(point => point.latitude)),
    minLon: Math.min(...points.map(point => point.longitude)), maxLon: Math.max(...points.map(point => point.longitude)),
  };
  const width = 520;
  const height = 260;
  const routeLine = anchors.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
  const workPeriodLine = trailPoints.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
  return <div className="route-map-fallback">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
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
          {group.points.map((point, index) => { const projected = project(point, bounds, width, height); return <circle key={`${group.jobId}-${point.sampleId || index}`} cx={projected.x} cy={projected.y} r={group.selected ? 7 : 5} fill={color} stroke="#fff" strokeWidth={group.selected ? 3.5 : 2.5} />; })}
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

export default function RouteMap({ anchors = [], samples = [], deviationEvents = [], selectedJobId = '', workPeriodJobCount, label = 'Route map', lang = 'en' }) {
  const t = copy[lang] || copy.en;
  const bodyRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapBoundsRef = useRef(null);
  const routePoints = useMemo(() => anchors.map(normalizePoint).filter(Boolean), [anchors]);
  const gpsData = useMemo(() => groupGpsSamplesByJob(samples, selectedJobId), [samples, selectedJobId]);
  const recordedPoints = gpsData.trailPoints;
  const deviationPoints = useMemo(() => deviationEvents.map(normalizePoint).filter(Boolean), [deviationEvents]);
  const [state, setState] = useState('loading');
  const [mapType, setMapType] = useState('roadmap');
  const [supportsFullscreen, setSupportsFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    const overlays = [];

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
          const pointLayer = new google.maps.Data({ map });
          for (const point of gpsPath) {
            pointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point(point), properties: {
              color, scale: group.selected ? 7 : 5, fillOpacity: 1, strokeWeight: group.selected ? 3.5 : 2.5,
            } }));
          }
          pointLayer.setStyle(feature => ({
            clickable: false,
            icon: markerIcon(google, feature.getProperty('color'), feature.getProperty('scale'), feature.getProperty('fillOpacity'), feature.getProperty('strokeWeight')),
            zIndex: group.selected ? 70 : 55,
          }));
          overlays.push(pointLayer);
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
      for (const overlay of overlays) overlay.setMap?.(null);
      if (map && window.google?.maps?.event) window.google.maps.event.clearInstanceListeners(map);
      if (mapRef.current === map) mapRef.current = null;
      mapBoundsRef.current = null;
    };
  }, [deviationPoints, gpsData.groups, lang, recordedPoints, routePoints]);

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
  return <div className="route-map" role="region" aria-label={label}>
    <div ref={bodyRef} className={`route-map-body${isFullscreen ? ' is-fullscreen' : ''}`}>
      {!fallback ? <div ref={containerRef} className="route-map-canvas" /> : <CoordinateFallback anchors={routePoints} gpsGroups={gpsData.groups} trailPoints={gpsData.trailPoints} deviations={deviationPoints} label={label} message={t.noCoordinates} />}
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
      {recordedPoints.length ? <span><i className="work-period-legend-line" />{t.workPeriod} · {countLabel(jobCount, t.job, t.jobs)} · {countLabel(gpsData.pointCount, t.point, t.points)}</span> : null}
      {selectedJobId ? <span><i className="selected-job-legend-dot" />{t.selectedJob} · {countLabel(gpsData.selectedPointCount, t.point, t.points)}</span> : null}
      {deviationPoints.length ? <span><i className="route-deviation-dot" />{t.deviation} · {countLabel(deviationPoints.length, t.event, t.events)}</span> : null}
    </div>
  </div>;
}
