'use client';

import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { MapTrifoldIcon } from '@phosphor-icons/react/dist/csr/MapTrifold';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PrinterIcon } from '@phosphor-icons/react/dist/csr/Printer';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useEffect, useRef, useState } from 'react';
import { formatReportCoordinate, formatReportDateTime } from '../lib/report-view';
import { adminFetch, adminFetchReportGpsSamples } from './dashboard-api';
import RouteMap from './route-map';
import RouteSelector from './route-selector';

const copy = {
  en: {
    title: 'GPS detail', close: 'Close', vehicle: 'Vehicle', driver: 'Driver', activity: 'Activity', time: 'Time',
    device: 'GPS points', last: 'Last GPS fix', captured: 'GPS fix time', coordinates: 'Coordinates', speedLabel: 'Speed', heading: 'Heading',
    loading: 'Loading GPS points…', failed: 'Could not load GPS detail.', empty: 'No GPS points are linked to this job yet.',
    previous: 'Previous', next: 'Next', page: 'Page', of: 'of', print: 'Print job', speed: 'km/h', degrees: '°', routeMap: 'Route vs GPS map', openRoute: 'Open saved route', withinRoute: 'Within route', deviated: 'Route deviation', deviationBody: 'GPS stayed outside the route corridor for', deviationBegan: 'Deviation began', deviationLocation: 'GPS location', deviationDistance: 'Off route', deviationDuration: 'Confirmed duration', seconds: 'seconds', km: 'km', noRoute: 'No route is assigned to this job yet.', assignedRoute: 'Assigned route', noAssignedRoute: 'No route', savingRoute: 'Saving route…', routeSaveFailed: 'Could not update the assigned route.', routeScope: 'Apply change to', thisJob: 'This job', thisJobHint: 'Only this saved job.', workPeriod: 'Work period', workPeriodHint: 'This job and every job in the same work period.', workPeriodSaved: 'Route applied to {count} jobs in this work period.', routeSaved: 'Route updated for this job.', routeRemoved: 'Route removed from this job.', editRoute: 'Edit route', closeRouteEditor: 'Close editor', cancel: 'Cancel', applyRoute: 'Apply route', showPoints: 'Show GPS points', hidePoints: 'Hide GPS points', recordedPoints: '{count} recorded points',
  },
  th: {
    title: 'รายละเอียด GPS', close: 'ปิด', vehicle: 'รถ', driver: 'พขร.', activity: 'กิจกรรม', time: 'เวลา',
    device: 'จุด GPS', last: 'พิกัด GPS ล่าสุด', captured: 'เวลาพิกัด GPS', coordinates: 'พิกัด', speedLabel: 'ความเร็ว', heading: 'ทิศทาง',
    loading: 'กำลังโหลดจุด GPS…', failed: 'ไม่สามารถโหลดรายละเอียด GPS', empty: 'ยังไม่มีจุด GPS ที่เชื่อมกับงานนี้',
    previous: 'ก่อนหน้า', next: 'ถัดไป', page: 'หน้า', of: 'จาก', print: 'พิมพ์งาน', speed: 'กม./ชม.', degrees: '°', routeMap: 'แผนที่เส้นทางเทียบกับ GPS', openRoute: 'เปิดเส้นทางที่บันทึก', withinRoute: 'อยู่ในเส้นทาง', deviated: 'ออกนอกเส้นทาง', deviationBody: 'GPS อยู่นอกแนวเส้นทางต่อเนื่องเป็นเวลา', deviationBegan: 'เริ่มออกนอกเส้นทาง', deviationLocation: 'ตำแหน่ง GPS', deviationDistance: 'ห่างจากเส้นทาง', deviationDuration: 'ระยะเวลาที่ยืนยัน', seconds: 'วินาที', km: 'กม.', noRoute: 'ยังไม่ได้กำหนดเส้นทางให้งานนี้', assignedRoute: 'เส้นทางที่กำหนด', noAssignedRoute: 'ไม่มีเส้นทาง', savingRoute: 'กำลังบันทึกเส้นทาง…', routeSaveFailed: 'ไม่สามารถอัปเดตเส้นทางที่กำหนดได้', routeScope: 'ใช้การเปลี่ยนแปลงกับ', thisJob: 'งานนี้', thisJobHint: 'เฉพาะงานที่บันทึกนี้', workPeriod: 'รอบงาน', workPeriodHint: 'งานนี้และทุกงานในรอบงานเดียวกัน', workPeriodSaved: 'กำหนดเส้นทางให้ {count} งานในรอบงานนี้แล้ว', routeSaved: 'อัปเดตเส้นทางสำหรับงานนี้แล้ว', routeRemoved: 'นำเส้นทางออกจากงานนี้แล้ว', editRoute: 'แก้ไขเส้นทาง', closeRouteEditor: 'ปิดตัวแก้ไข', cancel: 'ยกเลิก', applyRoute: 'ใช้เส้นทาง', showPoints: 'แสดงจุด GPS', hidePoints: 'ซ่อนจุด GPS', recordedPoints: 'บันทึกแล้ว {count} จุด',
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
  const t = copy[lang] || copy.en;
  const closeRef = useRef(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [mapSamples, setMapSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [routeScope, setRouteScope] = useState('job');
  const [routeNotice, setRouteNotice] = useState('');
  const [routeEditorOpen, setRouteEditorOpen] = useState(false);
  const [draftRouteName, setDraftRouteName] = useState(report.routeName || '');
  const [samplesOpen, setSamplesOpen] = useState(false);

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
      const focusable = drawer ? [...drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')] : [];
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
    setPage(1);
    setRouteEditorOpen(false);
    setDraftRouteName(report.routeName || '');
    setRouteScope('job');
    setRouteError('');
    setRouteNotice('');
    setSamplesOpen(false);
  }, [report.id, report.routeName]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/gps?page=${page}&pageSize=50`, { signal: controller.signal })
      .then(data => {
        if (!active) return;
        setDetail(data);
        if (data.route) adminFetchReportGpsSamples(report.id, { signal: controller.signal }).then(all => active && setMapSamples(all)).catch(() => {});
        else setMapSamples([]);
      })
      .catch(errorValue => { if (active && errorValue?.name !== 'AbortError') setError(t.failed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [page, report.id, t.failed]);

  async function assignRoute() {
    if (routeBusy) return;
    setRouteBusy(true);
    setRouteError('');
    setRouteNotice('');
    try {
      const scope = routeScope;
      const routeName = draftRouteName || null;
      const assignment = await adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/route`, { method: 'PUT', body: JSON.stringify({ routeName, scope }) });
      const refreshed = await adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/gps?page=${page}&pageSize=50`, { cacheOffline: false });
      setDetail(refreshed);
      setDraftRouteName(refreshed.report?.routeName || '');
      if (refreshed.route) setMapSamples(await adminFetchReportGpsSamples(report.id));
      else setMapSamples([]);
      setRouteNotice(scope === 'work_period'
        ? t.workPeriodSaved.replace('{count}', String(assignment.reportIds?.length || 0))
        : routeName ? t.routeSaved : t.routeRemoved);
      setRouteEditorOpen(false);
      onRouteAssigned?.(assignment);
    } catch {
      setRouteError(t.routeSaveFailed);
    } finally {
      setRouteBusy(false);
    }
  }

  const summary = detail?.gpsSummary || {};
  const samples = Array.isArray(detail?.samples) ? detail.samples : [];
  const pageInfo = detail?.pageInfo || { page: 1, totalPages: 1 };
  const displayedReport = { ...report, ...(detail?.report || {}) };
  const routeDeviation = detail?.routeDeviation;
  const currentRouteName = displayedReport.routeName || '';
  const pointCount = Number(summary.deviceSamples || samples.length || 0);

  function toggleRouteEditor() {
    if (routeEditorOpen) {
      setDraftRouteName(currentRouteName);
      setRouteError('');
      setRouteEditorOpen(false);
      return;
    }
    setDraftRouteName(currentRouteName);
    setRouteScope('job');
    setRouteNotice('');
    setRouteEditorOpen(true);
  }

  return <div className="gps-drawer-layer">
    <button className="gps-drawer-scrim" type="button" aria-label={t.close} onClick={onClose} />
    <aside className="gps-drawer" role="dialog" aria-modal="true" aria-labelledby="gps-detail-title">
      <header className="gps-drawer-header">
        <div><span className="gps-job-icon" aria-hidden="true"><ClipboardTextIcon size={20} weight="bold" /></span><strong>{displayedReport.id}</strong></div>
        <button ref={closeRef} className="gps-drawer-close" type="button" onClick={onClose}><XIcon size={18} weight="bold" aria-hidden="true" />{t.close}</button>
      </header>
      <div className="gps-drawer-scroll">
        <dl className="gps-job-meta">
          <div><dt>{t.vehicle}</dt><dd>{displayedReport.vehicleNumber || '—'}</dd></div>
          <div><dt>{t.driver}</dt><dd>{displayedReport.driverName || '—'}</dd></div>
          <div><dt>{t.activity}</dt><dd>{displayedReport.mode || '—'}</dd></div>
          <div><dt>{t.time}</dt><dd>{time(displayedReport.startTime, lang)}–{time(displayedReport.endTime, lang)}</dd></div>
        </dl>

        <section className={`gps-route-assignment${routeEditorOpen ? ' editing' : ''}`} aria-labelledby="gps-route-assignment-label">
          <button className="route-assignment-summary" type="button" aria-expanded={routeEditorOpen} aria-controls="route-assignment-editor" onClick={toggleRouteEditor}>
            <span className="route-assignment-icon" aria-hidden="true"><MapTrifoldIcon size={19} weight="bold" /></span>
            <span className="route-assignment-copy"><small id="gps-route-assignment-label">{t.assignedRoute}</small><strong>{currentRouteName || t.noAssignedRoute}</strong></span>
            <span className="route-assignment-edit"><PencilSimpleIcon size={15} weight="bold" aria-hidden="true" />{routeEditorOpen ? t.closeRouteEditor : t.editRoute}</span>
            <CaretDownIcon className="route-assignment-caret" size={16} weight="bold" aria-hidden="true" />
          </button>
          {routeNotice && !routeEditorOpen ? <p className="route-assignment-notice" role="status"><CheckCircleIcon size={15} weight="fill" aria-hidden="true" />{routeNotice}</p> : null}
          {routeEditorOpen ? <div className="route-assignment-editor" id="route-assignment-editor">
            <RouteSelector busy={routeBusy} lang={lang} onSelect={setDraftRouteName} value={draftRouteName} />
            <fieldset className="route-assignment-scope">
              <legend>{t.routeScope}</legend>
              <div className="route-scope-options">
                <label className={routeScope === 'job' ? 'selected' : ''}><input checked={routeScope === 'job'} disabled={routeBusy} name="route-scope" onChange={() => setRouteScope('job')} type="radio" value="job" /><span><strong>{t.thisJob}</strong><small>{t.thisJobHint}</small></span></label>
                <label className={routeScope === 'work_period' ? 'selected' : ''}><input checked={routeScope === 'work_period'} disabled={routeBusy} name="route-scope" onChange={() => setRouteScope('work_period')} type="radio" value="work_period" /><span><strong>{t.workPeriod}</strong><small>{t.workPeriodHint}</small></span></label>
              </div>
            </fieldset>
            {routeError ? <p className="route-assignment-error" role="alert">{routeError}</p> : null}
            <div className="route-assignment-actions">
              <button className="secondary small-button" type="button" disabled={routeBusy} onClick={toggleRouteEditor}>{t.cancel}</button>
              <button className="primary small-button" type="button" disabled={routeBusy} onClick={assignRoute}>{routeBusy ? t.savingRoute : t.applyRoute}</button>
            </div>
          </div> : null}
        </section>

        <section className="gps-detail-section" aria-labelledby="gps-detail-title">
          <h2 id="gps-detail-title">{t.title}</h2>
          <dl className="gps-detail-summary">
            <div><dt>{t.device}</dt><dd>{pointCount}</dd></div>
            <div><dt>{t.last}</dt><dd>{summary.lastCapturedAt ? time(summary.lastCapturedAt, lang) : '—'}</dd></div>
          </dl>
        </section>

        {detail?.route ? <section className="gps-route-section">
          <div className="gps-route-heading"><h2>{t.routeMap}</h2><a href={detail.route.googleMapsUrl} target="_blank" rel="noreferrer">{t.openRoute}<ArrowSquareOutIcon size={14} weight="bold" aria-hidden="true" /></a></div>
          <RouteMap anchors={detail.route.anchors} samples={mapSamples.length ? mapSamples : samples} deviationEvents={routeDeviation?.events || []} label={t.routeMap} lang={lang} />
          {routeDeviation?.status === 'deviated' ? <details className="route-deviation-status deviated"><summary><span><WarningCircleIcon size={16} weight="fill" aria-hidden="true" /><strong>{t.deviated}</strong>{` · ${Math.round(routeDeviation.longestDurationSeconds)} ${t.seconds}`}</span><CaretDownIcon size={15} weight="bold" aria-hidden="true" /></summary><p>{`${t.deviationBody} ${Math.round(routeDeviation.longestDurationSeconds)} ${t.seconds}`}</p><div className="route-deviation-events">{(routeDeviation.events || []).map((event, index) => <dl key={`${event.startedAt}-${index}`}><div><dt>{t.deviationBegan}</dt><dd>{time(event.startedAt, lang)}</dd></div><div><dt>{t.deviationLocation}</dt><dd>{coordinate(event)}</dd></div><div><dt>{t.deviationDistance}</dt><dd>{distance(event.startDistanceKm, lang)}</dd></div><div><dt>{t.deviationDuration}</dt><dd>{Math.round(event.durationSeconds)} {t.seconds}</dd></div></dl>)}</div></details> : null}
          {routeDeviation?.status === 'within_route' ? <p className="route-deviation-status within-route"><CheckCircleIcon size={16} weight="fill" aria-hidden="true" /><strong>{t.withinRoute}</strong></p> : null}
        </section> : <div className="gps-route-missing"><MapTrifoldIcon size={22} weight="bold" aria-hidden="true" /><p>{t.noRoute}</p></div>}

        <section className={`gps-samples-panel${samplesOpen ? ' open' : ''}`}>
          <button className="gps-samples-disclosure" type="button" aria-expanded={samplesOpen} aria-controls="gps-samples-content" onClick={() => setSamplesOpen(current => !current)}>
            <ListBulletsIcon size={18} weight="bold" aria-hidden="true" />
            <span><strong>{samplesOpen ? t.hidePoints : t.showPoints}</strong><small>{t.recordedPoints.replace('{count}', String(pointCount))}</small></span>
            <CaretDownIcon size={16} weight="bold" aria-hidden="true" />
          </button>
          {samplesOpen ? <div className="gps-samples-content" id="gps-samples-content">
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
          </div> : null}
        </section>
      </div>
      <footer className="gps-drawer-footer"><small>{summary.lastCapturedAt ? formatReportDateTime(summary.lastCapturedAt, lang) : ''}</small><button className="primary gps-print-button" type="button" disabled={!displayedReport.workPeriodId} onClick={() => window.location.assign(`/print/portrait?vehicle=${encodeURIComponent(displayedReport.vehicleNumber || '')}&workPeriodId=${encodeURIComponent(displayedReport.workPeriodId || '')}&lang=${lang}`)}><PrinterIcon size={17} weight="bold" aria-hidden="true" />{t.print}</button></footer>
    </aside>
  </div>;
}
