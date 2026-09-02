'use client';

import { useEffect, useRef, useState } from 'react';
import { formatReportCoordinate, formatReportDateTime, reportDateKey } from '../lib/report-view';
import { adminFetch, adminFetchReportGpsSamples } from './dashboard-api';
import RouteMap from './route-map';
import RouteSelector from './route-selector';

const copy = {
  en: {
    title: 'GPS detail', close: 'Close', vehicle: 'Vehicle', driver: 'Driver', activity: 'Activity', time: 'Time',
    device: 'GPS points', last: 'Last GPS fix', captured: 'GPS fix time', coordinates: 'Coordinates', speedLabel: 'Speed', heading: 'Heading',
    loading: 'Loading GPS points…', failed: 'Could not load GPS detail.', empty: 'No GPS points are linked to this job yet.',
    previous: 'Previous', next: 'Next', page: 'Page', of: 'of', print: 'Print job', speed: 'km/h', degrees: '°', routeMap: 'Route vs GPS map', openRoute: 'Open saved route', withinRoute: 'Within route', deviated: 'Route deviation', deviationBody: 'GPS stayed outside the route corridor for', deviationBegan: 'Deviation began', deviationLocation: 'GPS location', deviationDistance: 'Off route', deviationDuration: 'Confirmed duration', seconds: 'seconds', km: 'km', noRoute: 'No route is assigned to this job yet.', assignedRoute: 'Assigned route', noAssignedRoute: 'No route', savingRoute: 'Saving route…', routeSaveFailed: 'Could not update the assigned route.', routeScope: 'Apply route to', thisJob: 'This job only', workPeriod: 'Entire work period', workPeriodHint: 'Every job from the first job through Finish work, including jobs started later.', workPeriodSaved: 'Route applied to {count} jobs in this work period.',
  },
  th: {
    title: 'รายละเอียด GPS', close: 'ปิด', vehicle: 'รถ', driver: 'พขร.', activity: 'กิจกรรม', time: 'เวลา',
    device: 'จุด GPS', last: 'พิกัด GPS ล่าสุด', captured: 'เวลาพิกัด GPS', coordinates: 'พิกัด', speedLabel: 'ความเร็ว', heading: 'ทิศทาง',
    loading: 'กำลังโหลดจุด GPS…', failed: 'ไม่สามารถโหลดรายละเอียด GPS', empty: 'ยังไม่มีจุด GPS ที่เชื่อมกับงานนี้',
    previous: 'ก่อนหน้า', next: 'ถัดไป', page: 'หน้า', of: 'จาก', print: 'พิมพ์งาน', speed: 'กม./ชม.', degrees: '°', routeMap: 'แผนที่เส้นทางเทียบกับ GPS', openRoute: 'เปิดเส้นทางที่บันทึก', withinRoute: 'อยู่ในเส้นทาง', deviated: 'ออกนอกเส้นทาง', deviationBody: 'GPS อยู่นอกแนวเส้นทางต่อเนื่องเป็นเวลา', deviationBegan: 'เริ่มออกนอกเส้นทาง', deviationLocation: 'ตำแหน่ง GPS', deviationDistance: 'ห่างจากเส้นทาง', deviationDuration: 'ระยะเวลาที่ยืนยัน', seconds: 'วินาที', km: 'กม.', noRoute: 'ยังไม่ได้กำหนดเส้นทางให้งานนี้', assignedRoute: 'เส้นทางที่กำหนด', noAssignedRoute: 'ไม่มีเส้นทาง', savingRoute: 'กำลังบันทึกเส้นทาง…', routeSaveFailed: 'ไม่สามารถอัปเดตเส้นทางที่กำหนดได้', routeScope: 'กำหนดเส้นทางให้', thisJob: 'เฉพาะงานนี้', workPeriod: 'ทั้งรอบงาน', workPeriodHint: 'ใช้กับทุกงานตั้งแต่งานแรกจนถึงจบงาน รวมถึงงานที่เริ่มภายหลัง', workPeriodSaved: 'กำหนดเส้นทางให้ {count} งานในรอบงานนี้แล้ว',
  },
};

function time(value, lang) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function coordinate(point) {
  const latitude = formatReportCoordinate(point?.latitude);
  const longitude = formatReportCoordinate(point?.longitude);
  return latitude && longitude ? `${latitude}, ${longitude}` : '—';
}

function speed(point, t) {
  if (point?.speedMps == null) return '—';
  const metersPerSecond = Number(point?.speedMps);
  return Number.isFinite(metersPerSecond) ? `${Math.round(metersPerSecond * 3.6)} ${t.speed}` : '—';
}

function heading(point, t) {
  const degrees = Number(point?.headingDegrees);
  return Number.isFinite(degrees) ? `${Math.round(degrees)}${t.degrees}` : '—';
}

function distance(value, lang) {
  const kilometers = Number(value);
  return Number.isFinite(kilometers) ? `${kilometers.toFixed(2)} ${lang === 'th' ? 'กม.' : 'km'}` : '—';
}

export default function JobGpsDrawer({ report, lang, onClose, onRouteAssigned }) {
  const t = copy[lang];
  const closeRef = useRef(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [mapSamples, setMapSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [routeScope, setRouteScope] = useState('work_period');
  const [routeNotice, setRouteNotice] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const drawer = closeRef.current?.closest('[role="dialog"]');
      const focusable = drawer ? [...drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')] : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/gps?page=${page}&pageSize=50`, { signal: controller.signal })
      .then(data => { if (active) { setDetail(data); if (data.route) adminFetchReportGpsSamples(report.id, { signal: controller.signal }).then(all => active && setMapSamples(all)).catch(() => {}); } })
      .catch(errorValue => { if (active && errorValue?.name !== 'AbortError') setError(t.failed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [page, report.id, t.failed]);

  async function assignRoute(routeName) {
    if (routeBusy) return;
    setRouteBusy(true);
    setRouteError('');
    setRouteNotice('');
    try {
      const scope = routeScope;
      const assignment = await adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/route`, { method: 'PUT', body: JSON.stringify({ routeName: routeName || null, scope }) });
      const refreshed = await adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/gps?page=${page}&pageSize=50`, { cacheOffline: false });
      setDetail(refreshed);
      if (refreshed.route) setMapSamples(await adminFetchReportGpsSamples(report.id));
      else setMapSamples([]);
      if (scope === 'work_period') setRouteNotice(t.workPeriodSaved.replace('{count}', String(assignment.reportIds?.length || 0)));
      onRouteAssigned?.(assignment);
    } catch { setRouteError(t.routeSaveFailed); }
    finally { setRouteBusy(false); }
  }

  const summary = detail?.gpsSummary || {};
  const samples = Array.isArray(detail?.samples) ? detail.samples : [];
  const pageInfo = detail?.pageInfo || { page: 1, totalPages: 1 };
  const displayedReport = detail?.report || report;
  const routeDeviation = detail?.routeDeviation;

  return <div className="gps-drawer-layer">
    <button className="gps-drawer-scrim" type="button" aria-label={t.close} onClick={onClose} />
    <aside className="gps-drawer" role="dialog" aria-modal="true" aria-labelledby="gps-detail-title">
      <header className="gps-drawer-header">
        <div><span className="gps-job-icon" aria-hidden="true">≡</span><strong>{displayedReport.id}</strong></div>
        <button ref={closeRef} className="gps-drawer-close" type="button" onClick={onClose}><span aria-hidden="true">×</span>{t.close}</button>
      </header>
      <div className="gps-drawer-scroll">
        <dl className="gps-job-meta">
          <div><dt>{t.vehicle}</dt><dd>{displayedReport.vehicleNumber || '—'}</dd></div>
          <div><dt>{t.driver}</dt><dd>{displayedReport.driverName || '—'}</dd></div>
          <div><dt>{t.activity}</dt><dd>{displayedReport.mode || '—'}</dd></div>
          <div><dt>{t.time}</dt><dd>{time(displayedReport.startTime, lang)}–{time(displayedReport.endTime, lang)}</dd></div>
        </dl>
        <div className="gps-route-assignment">
          <RouteSelector busy={routeBusy} error={routeError} lang={lang} onSelect={assignRoute} value={displayedReport.routeName || ''} />
          <fieldset className="route-assignment-scope">
            <legend>{t.routeScope}</legend>
            <label><input checked={routeScope === 'work_period'} disabled={routeBusy} name="route-scope" onChange={() => setRouteScope('work_period')} type="radio" value="work_period" /><span>{t.workPeriod}</span></label>
            <small>{t.workPeriodHint}</small>
            <label><input checked={routeScope === 'job'} disabled={routeBusy} name="route-scope" onChange={() => setRouteScope('job')} type="radio" value="job" /><span>{t.thisJob}</span></label>
          </fieldset>
          {routeNotice ? <p className="route-assignment-notice" role="status">{routeNotice}</p> : null}
        </div>
        <section className="gps-detail-section">
          <h2 id="gps-detail-title">{t.title}</h2>
          <dl className="gps-detail-summary">
            <div><dt>{t.device}</dt><dd>{Number(summary.deviceSamples || 0)}</dd></div>
            <div><dt>{t.last}</dt><dd>{summary.lastCapturedAt ? time(summary.lastCapturedAt, lang) : '—'}</dd></div>
          </dl>
        </section>
        {detail?.route ? <section className="gps-route-section"><div className="gps-route-heading"><h2>{t.routeMap}</h2><a href={detail.route.googleMapsUrl} target="_blank" rel="noreferrer">{t.openRoute}</a></div><RouteMap anchors={detail.route.anchors} samples={mapSamples.length ? mapSamples : samples} deviationEvents={routeDeviation?.events || []} label={t.routeMap} lang={lang} />{routeDeviation?.status === 'deviated' ? <div className="route-deviation-status deviated"><p><strong>{t.deviated}</strong>{` · ${t.deviationBody} ${Math.round(routeDeviation.longestDurationSeconds)} ${t.seconds}`}</p><div className="route-deviation-events">{(routeDeviation.events || []).map((event, index) => <dl key={`${event.startedAt}-${index}`}><div><dt>{t.deviationBegan}</dt><dd>{time(event.startedAt, lang)}</dd></div><div><dt>{t.deviationLocation}</dt><dd>{coordinate(event)}</dd></div><div><dt>{t.deviationDistance}</dt><dd>{distance(event.startDistanceKm, lang)}</dd></div><div><dt>{t.deviationDuration}</dt><dd>{Math.round(event.durationSeconds)} {t.seconds}</dd></div></dl>)}</div></div> : null}{routeDeviation?.status === 'within_route' ? <p className="route-deviation-status within-route"><strong>{t.withinRoute}</strong></p> : null}</section> : <p className="gps-route-missing">{t.noRoute}</p>}
        {loading ? <p className="gps-detail-state" role="status">{t.loading}</p> : null}
        {error ? <p className="error gps-detail-state" role="alert">{error}</p> : null}
        {!loading && !error && !samples.length ? <p className="gps-detail-state">{t.empty}</p> : null}
        {samples.length ? <div className="gps-sample-table-wrap" tabIndex={0} aria-label={t.title}>
          <table className="gps-sample-table">
            <caption className="sr-only">{t.title}</caption>
            <thead><tr><th scope="col">{t.captured}</th><th scope="col">{t.coordinates}</th><th scope="col">{t.speedLabel}</th><th scope="col">{t.heading}</th></tr></thead>
            <tbody>{samples.map(sample => <tr key={sample.id}>
              <td data-label={t.captured}>{time(sample.capturedAt, lang)}</td>
              <td data-label={t.coordinates}><strong>{coordinate(sample.deviceGps)}</strong></td>
              <td data-label={t.speedLabel}>{speed(sample.deviceGps, t)}</td>
              <td data-label={t.heading}>{heading(sample.deviceGps, t)}</td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {pageInfo.totalPages > 1 ? <nav className="gps-detail-pager" aria-label={`${t.page} ${pageInfo.page} ${t.of} ${pageInfo.totalPages}`}><button type="button" className="secondary small-button" disabled={pageInfo.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t.previous}</button><span>{t.page} {pageInfo.page} {t.of} {pageInfo.totalPages}</span><button type="button" className="secondary small-button" disabled={pageInfo.page >= pageInfo.totalPages} onClick={() => setPage(value => value + 1)}>{t.next}</button></nav> : null}
      </div>
      <footer className="gps-drawer-footer"><button className="primary" type="button" disabled={!displayedReport.workPeriodId} onClick={() => window.location.assign(`/print/portrait?vehicle=${encodeURIComponent(displayedReport.vehicleNumber || '')}&workPeriodId=${encodeURIComponent(displayedReport.workPeriodId || '')}&lang=${lang}`)}>{t.print}</button><small>{summary.lastCapturedAt ? formatReportDateTime(summary.lastCapturedAt, lang) : ''}</small></footer>
    </aside>
  </div>;
}
