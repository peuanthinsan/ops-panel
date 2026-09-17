'use client';

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from './dashboard-api';
import { loadGoogleMaps } from '../lib/google-maps-loader';
import GatewayPayload from './gateway-payload';
import './gateway.css';
import './gateway-geofences.css';

const EMPTY = [];
const PAGE_SIZE = 20;
const SHAPE_COLORS = { circle: '#0B6F70', polygon: '#255AAB', polyline: '#8053A1' };
const shapeName = (type, thai) => ({
  circle: thai ? 'วงกลม' : 'Circle', polygon: thai ? 'รูปหลายเหลี่ยม' : 'Polygon',
  polyline: thai ? 'เส้น' : 'Polyline', unknown: thai ? 'ไม่ทราบรูปแบบ' : 'Unknown',
}[type] || (thai ? 'ไม่ทราบรูปแบบ' : 'Unknown'));
const validPoint = point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

function mappable(geometry) {
  if (geometry?.type === 'circle') return validPoint(geometry.center) && Number.isFinite(geometry.radiusMeters) && geometry.radiusMeters > 0;
  if (geometry?.type === 'polygon') return Array.isArray(geometry.paths) && geometry.paths.length > 0
    && geometry.paths.every(path => Array.isArray(path) && path.length >= 3 && path.every(validPoint));
  if (geometry?.type === 'polyline') return Array.isArray(geometry.path) && geometry.path.length >= 2 && geometry.path.every(validPoint);
  return false;
}

function stamp(value, thai) {
  if (!value || !Number.isFinite(Date.parse(value))) return thai ? 'ไม่ทราบ' : 'Unknown';
  return new Intl.DateTimeFormat(thai ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

function Field({ label, children }) {
  return <div><dt>{label}</dt><dd>{children == null || children === '' ? '—' : children}</dd></div>;
}

const GeofenceMap = memo(function GeofenceMap({ fences, selectedKey, onSelect, lang, loading }) {
  const thai = lang === 'th';
  const t = (en, th) => thai ? th : en;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef(new Map());
  const boundsRef = useRef(null);
  const initialLangRef = useRef(lang);
  const zoomListenerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [failedKeys, setFailedKeys] = useState(EMPTY);
  const drawable = useMemo(() => fences.filter(fence => fence.canMap), [fences]);
  const failedFences = drawable.filter(fence => failedKeys.includes(fence.key));

  const fit = useCallback(bounds => {
    const map = mapRef.current;
    if (!map || !bounds || bounds.isEmpty()) return;
    zoomListenerRef.current?.remove();
    map.fitBounds(bounds, 40);
    zoomListenerRef.current = window.google.maps.event.addListenerOnce(map, 'idle', () => {
      if (mapRef.current === map && map.getZoom() > 18) map.setZoom(18);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const previousAuthFailure = window.gm_authFailure;
    const authFailure = () => {
      if (!cancelled) setError('authorization');
      if (typeof previousAuthFailure === 'function') previousAuthFailure();
    };
    window.gm_authFailure = authFailure;
    const timer = window.setTimeout(() => { if (!cancelled) setError('timeout'); }, 25000);
    loadGoogleMaps(initialLangRef.current).then(google => {
      if (cancelled || !containerRef.current) return;
      window.clearTimeout(timer);
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: { lat: 13.7563, lng: 100.5018 }, zoom: 6,
        mapTypeId: 'roadmap', mapTypeControl: true, streetViewControl: false,
        fullscreenControl: true, zoomControl: true, rotateControl: false,
        gestureHandling: 'cooperative', clickableIcons: false,
      });
      setError(current => current === 'timeout' ? '' : current);
      setReady(true);
    }).catch(cause => {
      if (!cancelled) { window.clearTimeout(timer); setError(cause?.message || 'unavailable'); }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      zoomListenerRef.current?.remove();
      if (window.gm_authFailure === authFailure) window.gm_authFailure = previousAuthFailure;
      for (const { shape, listener } of overlaysRef.current.values()) { listener.remove(); shape.setMap(null); }
      overlaysRef.current.clear();
      if (mapRef.current) window.google?.maps?.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const google = window.google;
    const bounds = new google.maps.LatLngBounds();
    const overlays = new Map();
    const failed = [];
    for (const fence of drawable) {
      let shape;
      try {
        const geometry = fence.geometry;
        const options = {
          map: mapRef.current, clickable: true, draggable: false, editable: false,
          strokeColor: SHAPE_COLORS[geometry.type], strokeWeight: 2, strokeOpacity: .85,
          fillColor: SHAPE_COLORS[geometry.type], fillOpacity: .12, zIndex: 1,
        };
        const fenceBounds = new google.maps.LatLngBounds();
        if (geometry.type === 'circle') {
          shape = new google.maps.Circle({ ...options, center: geometry.center, radius: geometry.radiusMeters });
          const circleBounds = shape.getBounds();
          if (!circleBounds || circleBounds.isEmpty()) throw new Error('No circle bounds');
          fenceBounds.union(circleBounds);
        } else if (geometry.type === 'polygon') {
          shape = new google.maps.Polygon({ ...options, paths: geometry.paths });
          geometry.paths.forEach(path => path.forEach(point => fenceBounds.extend(point)));
        } else {
          shape = new google.maps.Polyline({ ...options, path: geometry.path });
          geometry.path.forEach(point => fenceBounds.extend(point));
        }
        const listener = shape.addListener('click', () => onSelect(fence.key));
        overlays.set(fence.key, { shape, listener, bounds: fenceBounds, type: geometry.type });
        bounds.union(fenceBounds);
      } catch {
        shape?.setMap(null);
        failed.push(fence.key);
      }
    }
    overlaysRef.current = overlays;
    boundsRef.current = bounds;
    setFailedKeys(failed);
    fit(bounds);
    return () => {
      for (const { shape, listener } of overlays.values()) { listener.remove(); shape.setMap(null); }
      if (overlaysRef.current === overlays) overlaysRef.current = new Map();
    };
  }, [drawable, fit, onSelect, ready]);

  useEffect(() => {
    for (const [key, { shape, type }] of overlaysRef.current) {
      const selected = key === selectedKey;
      shape.setOptions({
        strokeColor: selected ? '#E31B23' : SHAPE_COLORS[type], strokeWeight: selected ? 4 : 2,
        fillColor: selected ? '#E31B23' : SHAPE_COLORS[type], fillOpacity: selected ? .23 : .12,
        strokeOpacity: selected ? 1 : .85, zIndex: selected ? 100 : 1,
      });
    }
  }, [selectedKey, drawable, ready]);

  const selectedCanMap = drawable.some(fence => fence.key === selectedKey) && !failedKeys.includes(selectedKey);
  return <section className="gw-panel gf-map-panel" aria-label={t('Geofence map', 'แผนที่ขอบเขตพื้นที่')}>
    <div className="gw-panel-title"><h2>{t('Map', 'แผนที่')} <span className="gw-count">{drawable.length - failedFences.length} {t('boundaries', 'ขอบเขต')}</span></h2>
      <div className="gw-actions gf-map-actions">
        <button type="button" className="gw-button" disabled={!ready || !!error || !drawable.length} onClick={() => fit(boundsRef.current)}>{t('Fit filtered', 'แสดงตามตัวกรอง')}</button>
        <button type="button" className="gw-button" disabled={!ready || !!error || !selectedCanMap} onClick={() => fit(overlaysRef.current.get(selectedKey)?.bounds)}>{t('Fit selected', 'แสดงพื้นที่ที่เลือก')}</button>
      </div>
    </div>
    <div className="gf-map-frame">
      <div ref={containerRef} className="gf-map-canvas" aria-label={t('Google Maps, select a boundary to inspect it', 'Google Maps เลือกขอบเขตเพื่อดูรายละเอียด')} />
      {error ? <div className="gf-map-message" role="alert"><strong>{t('Google Maps is unavailable', 'ไม่สามารถแสดง Google Maps ได้')}</strong><p>{t('The geofence list and JSON are still available.', 'ยังสามารถดูรายการขอบเขตและ JSON ได้')}</p><p>{error === 'authorization' ? t('Map authorization failed. Check the map configuration.', 'การอนุญาตใช้งานแผนที่ไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าแผนที่') : error === 'timeout' ? t('The map took too long to load. Check your connection and reload the page.', 'ใช้เวลาโหลดแผนที่นานเกินไป กรุณาตรวจสอบการเชื่อมต่อแล้วโหลดหน้าใหม่') : error}</p></div>
        : !ready ? <div className="gf-map-message" role="status">{t('Loading Google Maps…', 'กำลังโหลด Google Maps…')}</div>
          : !drawable.length ? <div className="gf-map-empty" role="status">{loading ? t('Fetching geofences…', 'กำลังเรียกข้อมูลขอบเขต…') : t('No mapped boundaries in this selection.', 'ไม่มีขอบเขตที่แสดงบนแผนที่ได้ในรายการนี้')}</div> : null}
    </div>
    <div className="gf-map-legend"><span><i className="gf-swatch gf-polygon" />{shapeName('polygon', thai)}</span><span><i className="gf-swatch gf-circle" />{shapeName('circle', thai)}</span><span><i className="gf-swatch gf-polyline" />{shapeName('polyline', thai)}</span><span><i className="gf-swatch gf-selected" />{t('Selected', 'ที่เลือก')}</span></div>
    <p className="gw-small">{t('All mapped matches are shown, including records on other list pages. Select a boundary or a list entry to inspect it.', 'แสดงทุกขอบเขตที่ตรงกับตัวกรอง รวมถึงรายการในหน้าอื่น เลือกขอบเขตหรือรายการเพื่อดูรายละเอียด')}</p>
    {failedFences.length > 0 && <div className="gw-notice gw-warning"><span>{failedFences.length} {t('boundaries could not be drawn. Select a record to inspect its source data.', 'ขอบเขตไม่สามารถวาดได้ เลือกรายการเพื่อดูข้อมูลต้นฉบับ')}</span><ul>{failedFences.map(fence => <li key={fence.key}><button type="button" className="gw-event-button" onClick={() => onSelect(fence.key)}>{fence.name || fence.id}</button></li>)}</ul></div>}
  </section>;
});

function GeofenceInspector({ fence, sourceName, thai }) {
  const t = (en, th) => thai ? th : en;
  const unknown = t('Unknown', 'ไม่ทราบ');
  if (!fence) return <section className="gw-panel gf-inspector"><div className="gf-inspector-empty"><h2>{t('Inspect a geofence', 'ดูรายละเอียดขอบเขต')}</h2><p>{t('Choose a boundary on the map or select a record from the list.', 'เลือกขอบเขตบนแผนที่หรือเลือกรายการเพื่อดูรายละเอียด')}</p></div></section>;
  const geometry = fence.geometry;
  return <section className="gw-panel gf-inspector" aria-label={t('Selected geofence details', 'รายละเอียดขอบเขตที่เลือก')}>
    <div className="gw-panel-title"><div><span className="gw-label">{t('Selected geofence', 'ขอบเขตที่เลือก')}</span><h2>{fence.name || fence.id}</h2></div><span className={`gw-tag ${fence.canMap ? 'gw-neutral' : ''}`}>{fence.canMap ? shapeName(geometry.type, thai) : t('Cannot map', 'แสดงบนแผนที่ไม่ได้')}</span></div>
    {fence.description && <p className="gf-description">{fence.description}</p>}
    <dl className="gw-fields gf-detail-fields">
      <Field label={t('ID', 'รหัส')}>{fence.id}</Field><Field label={t('Source', 'แหล่งข้อมูล')}>{sourceName}</Field>
      <Field label={t('Group', 'กลุ่ม')}>{fence.group}</Field><Field label={t('Category', 'หมวดหมู่')}>{fence.category}</Field>
      <Field label={t('Type', 'ประเภท')}>{shapeName(fence.type, thai)}</Field>
      <Field label={t('Enabled', 'เปิดใช้งาน')}>{fence.enabled === true ? t('Yes', 'ใช่') : fence.enabled === false ? t('No', 'ไม่ใช่') : unknown}</Field>
      {geometry?.type === 'circle' && <><Field label={t('Center (latitude, longitude)', 'จุดศูนย์กลาง (ละติจูด, ลองจิจูด)')}>{validPoint(geometry.center) ? `${geometry.center.lat}, ${geometry.center.lng}` : unknown}</Field><Field label={t('Radius', 'รัศมี')}>{Number.isFinite(geometry.radiusMeters) ? `${geometry.radiusMeters.toLocaleString(thai ? 'th-TH' : 'en-GB')} ${t('m', 'เมตร')}` : unknown}</Field></>}
      {geometry?.type === 'polygon' && <><Field label={t('Paths', 'แนวขอบเขต')}>{Array.isArray(geometry.paths) ? geometry.paths.length : unknown}</Field><Field label={t('Vertices', 'จุดขอบเขต')}>{Array.isArray(geometry.paths) ? geometry.paths.reduce((sum, path) => sum + (Array.isArray(path) ? path.length : 0), 0) : unknown}</Field></>}
      {geometry?.type === 'polyline' && <Field label={t('Vertices', 'จุดบนเส้น')}>{Array.isArray(geometry.path) ? geometry.path.length : unknown}</Field>}
    </dl>
    {!fence.canMap && <div className="gw-notice gw-warning">{t('This record has no supported, valid geometry. Its source details are retained below.', 'รายการนี้ไม่มีพิกัดที่ถูกต้องในรูปแบบที่รองรับ ข้อมูลต้นฉบับยังแสดงอยู่ด้านล่าง')}</div>}
    {fence.warnings?.length > 0 && <div className="gw-notice gw-warning"><strong>{t('Source notes', 'หมายเหตุจากข้อมูลต้นทาง')}</strong><ul>{fence.warnings.map((warning, index) => <li key={index}>{String(warning)}</li>)}</ul></div>}
    <details className="gw-detail"><summary>{t('Map geometry JSON', 'JSON พิกัดแผนที่')}</summary><pre className="gw-code"><code>{JSON.stringify(geometry, null, 2) || 'null'}</code></pre></details>
    <details open className="gw-detail"><summary>{t('Source JSON · sanitized', 'JSON ต้นฉบับ · ซ่อนข้อมูลลับ')}</summary><GatewayPayload key={fence.key} value={fence.raw} title={t('Geofence source payload', 'ข้อมูลขอบเขตต้นฉบับ')} filename={`geofence-${fence.source}-${fence.id}`} thai={thai} sourceLabel={sourceName} /></details>
  </section>;
}

export default function GatewayGeofences({ lang = 'en' }) {
  const thai = lang === 'th';
  const t = (en, th) => thai ? th : en;
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [group, setGroup] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState('');
  const requestRef = useRef(null);
  const mountedRef = useRef(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());

  const refresh = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await adminFetch('/api/admin/gateway/geofences', { cacheOffline: false, cache: 'no-store', timeoutMs: 45000, signal: controller.signal });
      if (!result || typeof result.configured !== 'boolean' || !Array.isArray(result.fences) || !Array.isArray(result.sources)) throw new Error('The server returned an invalid geofence response.');
      if (mountedRef.current && requestRef.current === controller && !controller.signal.aborted) { setSnapshot(result); setError(''); }
    } catch (cause) {
      if (mountedRef.current && requestRef.current === controller && !controller.signal.aborted) setError(cause?.message || 'Could not fetch geofences.');
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; if (mountedRef.current) setLoading(false); }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => { mountedRef.current = false; requestRef.current?.abort(); requestRef.current = null; };
  }, [refresh]);

  const records = useMemo(() => {
    const occurrences = new Map();
    return (snapshot?.fences || EMPTY).map(fence => {
      const baseKey = `${fence.source}:${fence.id}`;
      const occurrence = occurrences.get(baseKey) || 0;
      occurrences.set(baseKey, occurrence + 1);
      return { ...fence, key: `${baseKey}:${occurrence}`, canMap: mappable(fence.geometry) };
    });
  }, [snapshot]);
  const sources = snapshot?.sources || EMPTY;
  const sourceNames = useMemo(() => new Map(sources.map(item => [item.id, item.name || item.id])), [sources]);
  const sourceOptions = useMemo(() => [...new Set([...sources.map(item => item.id), ...records.map(fence => fence.source), ...(source ? [source] : [])])].filter(Boolean).sort(), [records, source, sources]);
  const groups = useMemo(() => [...new Set([...records.map(fence => fence.group), ...(group ? [group] : [])])].filter(Boolean).sort((a, b) => a.localeCompare(b)), [records, group]);
  const filtered = useMemo(() => records.filter(fence => (!source || fence.source === source) && (!group || fence.group === group) && (!type || fence.type === type)
    && (!deferredQuery || [fence.name, fence.id, fence.source, sourceNames.get(fence.source), fence.group, fence.category, fence.description].filter(value => value != null).join(' ').toLocaleLowerCase().includes(deferredQuery))), [records, source, group, type, deferredQuery, sourceNames]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRecords = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = records.find(fence => fence.key === selectedKey) || null;
  const selectedVisible = selected && filtered.some(fence => fence.key === selectedKey);
  const mappedCount = records.filter(fence => fence.canMap).length;
  const hasFilters = Boolean(query || source || group || type);
  const selectFence = useCallback(key => {
    setSelectedKey(key);
    const index = filtered.findIndex(fence => fence.key === key);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
  }, [filtered]);
  const coverageComplete = snapshot?.coverage?.complete === true;
  const total = Number.isFinite(snapshot?.coverage?.total) ? snapshot.coverage.total : null;

  function resetFilters() { setQuery(''); setSource(''); setGroup(''); setType(''); setPage(1); }
  function showSelected() {
    if (!selected) return;
    resetFilters();
    setPage(Math.floor(records.findIndex(fence => fence.key === selectedKey) / PAGE_SIZE) + 1);
  }
  function exportAll() {
    if (!snapshot) return;
    setExportError(false);
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `geofences-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(t('Download started: all fetched records, source status and coverage. Current filters do not limit the export.', 'เริ่มดาวน์โหลดทุกรายการที่ได้รับ พร้อมสถานะแหล่งข้อมูลและความครบถ้วน ตัวกรองไม่จำกัดข้อมูลที่ดาวน์โหลด'));
    } catch { setExportError(true); setExportMessage(t('Could not start the JSON download.', 'เริ่มดาวน์โหลด JSON ไม่สำเร็จ')); }
  }

  return <main id="main-content" className="gw-page gf-page gf-view">
    <div className="gf-heading"><div><h1>{t('Geofences', 'ขอบเขตพื้นที่')}</h1><p>{t('Browse existing boundaries and inspect their source data.', 'ดูขอบเขตพื้นที่ที่มีอยู่และตรวจสอบข้อมูลต้นฉบับ')}</p></div><div className="gw-actions"><button type="button" className="gw-button" disabled={!snapshot} onClick={exportAll}>{t('Download all JSON', 'ดาวน์โหลด JSON ทั้งหมด')}</button><button type="button" className="gw-button" onClick={refresh} disabled={loading}>{loading ? t('Fetching…', 'กำลังเรียกข้อมูล…') : t('Refresh geofences', 'รีเฟรชขอบเขต')}</button></div></div>
    {error && <div className="gw-notice gw-error" role="alert"><strong>{t('Could not refresh geofences.', 'รีเฟรชข้อมูลขอบเขตไม่ได้')}</strong><span>{error}</span>{snapshot && <span>{t('Showing the last successful response below.', 'ด้านล่างแสดงข้อมูลที่เรียกสำเร็จครั้งล่าสุด')}</span>}</div>}
    {exportMessage && <p className={`gw-notice ${exportError ? 'gw-error' : 'gw-neutral-notice'}`} role={exportError ? 'alert' : 'status'}>{exportMessage}</p>}
    <section className="gw-panel gf-overview" aria-label={t('Geofence data coverage', 'ความครบถ้วนของข้อมูลขอบเขต')}>
      <div className="gf-totals"><div><span>{t('Fetched records', 'รายการที่ได้รับ')}</span><strong>{snapshot ? records.length.toLocaleString() : '—'}</strong></div><div><span>{t('With map geometry', 'มีพิกัดแผนที่')}</span><strong>{snapshot ? mappedCount.toLocaleString() : '—'}</strong></div><div><span>{t('Cannot map', 'แสดงบนแผนที่ไม่ได้')}</span><strong>{snapshot ? (records.length - mappedCount).toLocaleString() : '—'}</strong></div><div><span>{t('Source coverage', 'ความครบถ้วนจากต้นทาง')}</span><strong className="gf-coverage">{!snapshot ? '—' : coverageComplete ? t('Complete', 'ครบถ้วน') : snapshot.coverage?.complete === false ? t('Incomplete', 'ไม่ครบถ้วน') : t('Unknown', 'ไม่ทราบ')}</strong></div></div>
      <p className="gw-small">{snapshot ? <>{t('Fetched', 'เรียกข้อมูลเมื่อ')} {stamp(snapshot.generatedAt, thai)} · {t('Bangkok time', 'เวลาไทย')} · {t('Source total', 'จำนวนจากต้นทาง')}: {total === null ? t('Unknown', 'ไม่ทราบ') : total.toLocaleString()}</> : loading ? t('Fetching configured geofence sources…', 'กำลังเรียกข้อมูลจากแหล่งขอบเขตที่ตั้งค่าไว้…') : t('No geofence response is available.', 'ยังไม่มีข้อมูลตอบกลับของขอบเขต')}</p>
      {snapshot && !coverageComplete && <div className="gw-notice gw-warning gf-coverage-notice">{t('Coverage is not confirmed complete. The list and export contain only the records returned by the sources below.', 'ยังยืนยันความครบถ้วนไม่ได้ รายการและไฟล์ดาวน์โหลดมีเฉพาะข้อมูลที่ได้รับจากแหล่งข้อมูลด้านล่าง')}</div>}
      {sources.length > 0 && <div className="gf-sources">{sources.map((item, index) => <div className="gf-source" key={`${item.id}:${index}`}><div className="gf-source-title"><strong>{item.name || item.id}</strong><span className={`gw-tag ${item.status === 'ok' && item.complete === true ? 'gw-neutral' : ''}`}>{item.status === 'ok' ? item.complete === true ? t('Complete', 'ครบถ้วน') : item.complete === false ? t('Partial', 'บางส่วน') : t('Coverage unknown', 'ไม่ทราบความครบถ้วน') : item.status === 'unconfigured' ? t('Not configured', 'ยังไม่ตั้งค่า') : item.status === 'error' ? t('Source error', 'ต้นทางมีข้อผิดพลาด') : t('Unknown status', 'ไม่ทราบสถานะ')}</span></div><p>{t('Source total', 'จำนวนจากต้นทาง')}: {Number.isFinite(item.total) ? item.total.toLocaleString() : t('Unknown', 'ไม่ทราบ')} · {t('Fetched', 'เรียกข้อมูลเมื่อ')}: {stamp(item.fetchedAt, thai)}</p>{item.error && <p className="gf-source-error">{item.error}</p>}</div>)}</div>}
    </section>
    {snapshot?.configured === false && <div className="gw-notice gw-warning"><strong>{t('No geofence source is configured.', 'ยังไม่ได้ตั้งค่าแหล่งข้อมูลขอบเขต')}</strong><span>{t('Configure a geofence source to load existing boundaries. Source setup details appear above.', 'ตั้งค่าแหล่งข้อมูลขอบเขตเพื่อโหลดพื้นที่ที่มีอยู่ ดูรายละเอียดการตั้งค่าต้นทางด้านบน')}</span></div>}
    {snapshot && !loading && !records.length && <div className="gw-notice gw-neutral-notice"><strong>{coverageComplete ? t('The configured sources returned no geofences.', 'แหล่งข้อมูลที่ตั้งค่าไว้ไม่ส่งขอบเขตพื้นที่กลับมา') : t('No geofences have been returned.', 'ยังไม่ได้รับขอบเขตพื้นที่')}</strong><span>{coverageComplete ? t('Refresh after geofences are available in the source system.', 'รีเฟรชเมื่อมีข้อมูลขอบเขตในระบบต้นทาง') : t('Review source status above; an empty response does not confirm that no geofences exist.', 'ตรวจสอบสถานะแหล่งข้อมูลด้านบน การไม่พบข้อมูลยังไม่ยืนยันว่าไม่มีขอบเขตพื้นที่')}</span></div>}
    <section className="gw-panel gf-filters" aria-label={t('Filter geofences', 'กรองขอบเขต')}>
      <label className="gf-search"><span>{t('Search geofences', 'ค้นหาขอบเขต')}</span><input type="search" value={query} placeholder={t('Name, ID, group or category', 'ชื่อ รหัส กลุ่ม หรือหมวดหมู่')} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label><span>{t('Source', 'แหล่งข้อมูล')}</span><select value={source} onChange={event => { setSource(event.target.value); setPage(1); }}><option value="">{t('All sources', 'ทุกแหล่งข้อมูล')}</option>{sourceOptions.map(value => <option key={value} value={value}>{sourceNames.get(value) || value}</option>)}</select></label>
      <label><span>{t('Group', 'กลุ่ม')}</span><select value={group} onChange={event => { setGroup(event.target.value); setPage(1); }}><option value="">{t('All groups', 'ทุกกลุ่ม')}</option>{groups.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>{t('Type', 'ประเภท')}</span><select value={type} onChange={event => { setType(event.target.value); setPage(1); }}><option value="">{t('All types', 'ทุกประเภท')}</option>{['circle', 'polygon', 'polyline', 'unknown'].map(value => <option key={value} value={value}>{shapeName(value, thai)}</option>)}</select></label>
      <button type="button" className="gw-button" onClick={resetFilters} disabled={!hasFilters}>{t('Reset', 'ล้างตัวกรอง')}</button>
    </section>
    {selected && !selectedVisible && <div className="gw-notice gw-neutral-notice"><span>{t('The selected geofence is outside the current filters.', 'ขอบเขตที่เลือกอยู่นอกตัวกรองปัจจุบัน')}</span><button type="button" className="gw-button" onClick={showSelected}>{t('Show selected record', 'แสดงรายการที่เลือก')}</button></div>}
    <div className="gf-workspace">
      <section className="gw-panel gf-catalog" aria-label={t('Geofence records', 'รายการขอบเขต')}>
        <div className="gw-panel-title"><h2>{t('Records', 'รายการ')} <span className="gw-count">{filtered.length.toLocaleString()} / {records.length.toLocaleString()}</span></h2></div>
        <p className="gf-catalog-note" role="status">{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} ${t('of', 'จาก')} ${filtered.length.toLocaleString()} ${t('matches', 'รายการที่ตรงกัน')}` : loading ? t('Fetching records…', 'กำลังเรียกข้อมูล…') : t('No matching records', 'ไม่พบรายการที่ตรงกัน')}</p>
        {pageRecords.length > 0 ? <ul className="gf-records">{pageRecords.map(fence => <li key={fence.key}><button type="button" className={`gf-record ${selectedKey === fence.key ? 'gf-record-selected' : ''}`} aria-pressed={selectedKey === fence.key} onClick={() => selectFence(fence.key)}><span className="gf-record-title">{fence.name || fence.id || t('Unnamed geofence', 'ขอบเขตไม่มีชื่อ')}</span><span className="gf-record-id">{fence.id}</span><span className="gf-record-meta">{sourceNames.get(fence.source) || fence.source}{fence.group ? ` · ${fence.group}` : ''}</span><span className="gf-record-tags"><span>{shapeName(fence.type, thai)}</span>{!fence.canMap && <span className="gf-record-warning">{t('Cannot map', 'แสดงบนแผนที่ไม่ได้')}</span>}{fence.warnings?.length > 0 && <span className="gf-record-warning">{t('Source notes', 'มีหมายเหตุ')}</span>}</span></button></li>)}</ul> : <div className="gf-list-empty"><p>{loading ? t('Waiting for source data.', 'กำลังรอข้อมูลต้นทาง') : hasFilters ? t('Try a different search or reset the filters.', 'ลองค้นหาคำอื่นหรือล้างตัวกรอง') : t('Source records will appear here when available.', 'ข้อมูลจากต้นทางจะแสดงที่นี่เมื่อมีข้อมูล')}</p>{hasFilters && <button type="button" className="gw-button" onClick={resetFilters}>{t('Reset filters', 'ล้างตัวกรอง')}</button>}</div>}
        <nav className="gf-pagination" aria-label={t('Geofence list pages', 'หน้ารายการขอบเขต')}><button type="button" className="gw-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('Previous', 'ก่อนหน้า')}</button><label><span className="sr-only">{t('Page', 'หน้า')}</span><select value={currentPage} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: totalPages }, (_, index) => <option key={index + 1} value={index + 1}>{t('Page', 'หน้า')} {index + 1} / {totalPages}</option>)}</select></label><button type="button" className="gw-button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>{t('Next', 'ถัดไป')}</button></nav>
      </section>
      <GeofenceMap fences={filtered} selectedKey={selectedKey} onSelect={selectFence} lang={lang} loading={loading} />
      <GeofenceInspector fence={selected} sourceName={selected ? sourceNames.get(selected.source) || selected.source : ''} thai={thai} />
    </div>
  </main>;
}
