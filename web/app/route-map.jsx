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

const copy = {
  en: {
    loading: 'Loading Google Maps…',
    unavailable: 'Google Maps is unavailable. Showing the saved route coordinates instead.',
    routeUnavailable: 'Google could not calculate the driving path. Showing the saved route points.',
    savedRoute: 'Saved route',
    recordedGps: 'Recorded GPS',
    deviation: 'Route deviation',
    noCoordinates: 'Route coordinates are not available in this Google Maps link.',
    mapControls: 'Map controls',
    mapStyle: 'Map style',
    roadmap: 'Map',
    satellite: 'Satellite',
    showRoadmap: 'Show road map',
    showSatellite: 'Show satellite imagery',
    viewControls: 'Map view',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitRoute: 'Fit entire route',
    enterFullscreen: 'View map fullscreen',
    exitFullscreen: 'Exit fullscreen map',
  },
  th: {
    loading: 'กำลังโหลด Google Maps…',
    unavailable: 'ไม่สามารถโหลด Google Maps ได้ กำลังแสดงพิกัดเส้นทางที่บันทึกไว้แทน',
    routeUnavailable: 'Google ไม่สามารถคำนวณเส้นทางขับรถได้ กำลังแสดงจุดเส้นทางที่บันทึกไว้',
    savedRoute: 'เส้นทางที่บันทึก',
    recordedGps: 'GPS ที่บันทึก',
    deviation: 'จุดออกนอกเส้นทาง',
    noCoordinates: 'ไม่พบพิกัดเส้นทางในลิงก์ Google Maps นี้',
    mapControls: 'ตัวควบคุมแผนที่',
    mapStyle: 'รูปแบบแผนที่',
    roadmap: 'แผนที่',
    satellite: 'ดาวเทียม',
    showRoadmap: 'แสดงแผนที่ถนน',
    showSatellite: 'แสดงภาพถ่ายดาวเทียม',
    viewControls: 'มุมมองแผนที่',
    zoomIn: 'ซูมเข้า',
    zoomOut: 'ซูมออก',
    fitRoute: 'แสดงเส้นทางทั้งหมด',
    enterFullscreen: 'แสดงแผนที่เต็มหน้าจอ',
    exitFullscreen: 'ออกจากแผนที่เต็มหน้าจอ',
  },
};

function normalizePoint(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function gpsPoints(samples) {
  return samples
    .map(sample => ({ ...normalizePoint(sample?.deviceGps), capturedAt: new Date(sample?.capturedAt).getTime() }))
    .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    .sort((a, b) => (Number.isFinite(a.capturedAt) ? a.capturedAt : 0) - (Number.isFinite(b.capturedAt) ? b.capturedAt : 0));
}

function samplePoints(points, maximum = 220) {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * (points.length - 1) / (maximum - 1))]);
}

function project(point, bounds, width, height) {
  const x = bounds.maxLon === bounds.minLon ? width / 2 : ((point.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
  const y = bounds.maxLat === bounds.minLat ? height / 2 : height - ((point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
  return { x: 18 + x * 0.92, y: 18 + y * 0.92 };
}

function CoordinateFallback({ anchors, gps, deviations = [], label, message }) {
  const points = [...anchors, ...gps, ...deviations];
  if (anchors.length < 2 || points.length < 2) return <div className="route-map-empty">{label}: {message}</div>;
  const bounds = {
    minLat: Math.min(...points.map(point => point.latitude)), maxLat: Math.max(...points.map(point => point.latitude)),
    minLon: Math.min(...points.map(point => point.longitude)), maxLon: Math.max(...points.map(point => point.longitude)),
  };
  const width = 520;
  const height = 260;
  const line = anchors.map(point => { const projected = project(point, bounds, width, height); return `${projected.x},${projected.y}`; }).join(' ');
  return <div className="route-map-fallback">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><pattern id="route-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#e6eaee" strokeWidth="1" /></pattern></defs>
      <rect width="100%" height="100%" fill="#f8fafb" /><rect width="100%" height="100%" fill="url(#route-grid)" />
      <polyline points={line} fill="none" stroke="#e31b23" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity=".22" />
      <polyline points={line} fill="none" stroke="#e31b23" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {gps.map((point, index) => { const projected = project(point, bounds, width, height); return <circle key={index} cx={projected.x} cy={projected.y} r="4.5" fill="#087ca7" stroke="#fff" strokeWidth="2" />; })}
      {deviations.map((point, index) => { const projected = project(point, bounds, width, height); return <circle key={`deviation-${index}`} cx={projected.x} cy={projected.y} r="7" fill="#B92B3A" stroke="#fff" strokeWidth="2.5" />; })}
    </svg>
  </div>;
}

function markerIcon(google, color, scale = 5) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 2,
  };
}

export default function RouteMap({ anchors = [], samples = [], deviationEvents = [], label = 'Route map', lang = 'en' }) {
  const t = copy[lang] || copy.en;
  const bodyRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapBoundsRef = useRef(null);
  const routePoints = useMemo(() => anchors.map(normalizePoint).filter(Boolean), [anchors]);
  const recordedPoints = useMemo(() => gpsPoints(samples), [samples]);
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
    if (routePoints.length < 2) { setState('empty'); return undefined; }
    let cancelled = false;
    let map = null;
    const overlays = [];

    async function renderMap() {
      try {
        const google = await loadGoogleMaps(lang);
        if (cancelled || !containerRef.current) return;
        map = new google.maps.Map(containerRef.current, {
          center: { lat: routePoints[0].latitude, lng: routePoints[0].longitude },
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
        try {
          const computed = await computeGoogleDrivingRoute(routePoints, lang);
          if (cancelled) return;
          displayedRoute = computed.path.map(normalizePoint).filter(Boolean);
        } catch (error) {
          console.error('[RouteMap] Google driving route failed:', error);
          routeState = 'route-unavailable';
        }

        const routePath = displayedRoute.map(point => ({ lat: point.latitude, lng: point.longitude }));
        const gpsPath = recordedPoints.map(point => ({ lat: point.latitude, lng: point.longitude }));
        overlays.push(new google.maps.Polyline({
          map, path: routePath, strokeColor: '#E31B23', strokeOpacity: 0.95, strokeWeight: 5, zIndex: 20,
        }));
        if (gpsPath.length > 1) overlays.push(new google.maps.Polyline({
          map, path: gpsPath, strokeColor: '#087CA7', strokeOpacity: 0.9, strokeWeight: 4, zIndex: 30,
        }));

        const pointLayer = new google.maps.Data({ map });
        pointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point(routePath[0]), properties: { color: '#14865B', scale: 7 } }));
        pointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point(routePath.at(-1)), properties: { color: '#7A1424', scale: 7 } }));
        for (const point of samplePoints(gpsPath)) {
          pointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point(point), properties: { color: '#087CA7', scale: 5 } }));
        }
        for (const point of deviationPoints) {
          pointLayer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point({ lat: point.latitude, lng: point.longitude }), properties: { color: '#B92B3A', scale: 9 } }));
        }
        pointLayer.setStyle(feature => ({
          clickable: false,
          icon: markerIcon(google, feature.getProperty('color'), feature.getProperty('scale')),
          zIndex: 50,
        }));
        overlays.push(pointLayer);

        const bounds = new google.maps.LatLngBounds();
        for (const point of [...routePath, ...gpsPath, ...deviationPoints.map(point => ({ lat: point.latitude, lng: point.longitude }))]) bounds.extend(point);
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
  }, [deviationPoints, lang, recordedPoints, routePoints]);

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
  return <div className="route-map" role="region" aria-label={label}>
    <div ref={bodyRef} className={`route-map-body${isFullscreen ? ' is-fullscreen' : ''}`}>
      {!fallback ? <div ref={containerRef} className="route-map-canvas" /> : <CoordinateFallback anchors={routePoints} gps={recordedPoints} deviations={deviationPoints} label={label} message={t.noCoordinates} />}
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
    <div className="route-map-legend"><span><i className="route-legend-line" />{t.savedRoute}</span><span><i className="gps-legend-dot" />{t.recordedGps}</span>{deviationPoints.length ? <span><i className="route-deviation-dot" />{t.deviation}</span> : null}</div>
  </div>;
}
