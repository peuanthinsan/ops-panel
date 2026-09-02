'use client';

import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { MapTrifoldIcon } from '@phosphor-icons/react/dist/csr/MapTrifold';
import { MapPinLineIcon } from '@phosphor-icons/react/dist/csr/MapPinLine';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PrinterIcon } from '@phosphor-icons/react/dist/csr/Printer';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useEffect, useRef, useState } from 'react';
import { displayGpsLookupMessage, formatReportCoordinate, formatReportDateTime } from '../lib/report-view';
import { adminFetch, adminFetchReportGpsSamples } from './dashboard-api';
import RouteMap from './route-map';
import RouteSelector from './route-selector';

const copy = {
  en: {
    title: 'GPS detail', close: 'Close', vehicle: 'Vehicle', driver: 'Driver', activity: 'Activity', time: 'Time',
    device: 'GPS points', last: 'Last GPS fix', captured: 'GPS fix time', coordinates: 'Coordinates', speedLabel: 'Speed', heading: 'Heading',
    loading: 'Loading GPS points…', loadingHint: 'Checking the saved GPS detail for this job.', failed: 'Could not load GPS detail.', failedHint: 'Showing the GPS count saved with the job.', empty: 'No GPS points are linked to this job yet.', lookupStatus: 'GPS lookup', gpsReady: 'GPS trail ready', gpsReadyHint: '{count} time-matched points are linked to this job.', gpsMissing: 'No GPS point yet', gpsMissingHint: 'Retry the time-based lookup without leaving this job.', gpsNotApplicable: 'GPS lookup not required', gpsNotApplicableHint: 'This cancelled job stays in the audit record without a GPS lookup.', lookupPending: 'Lookup in progress', retry: 'Retry GPS lookup', retrying: 'Looking up GPS…', retryFailed: 'Could not retry the GPS lookup.', retryComplete: 'GPS lookup completed.', retryNoData: 'Lookup completed, but no GPS points matched this job.', retryUnavailable: 'GPS lookup is not available for this job.', retryLookupFailed: 'The GPS provider could not complete this lookup.', retryFinished: 'GPS lookup finished.',
    previous: 'Previous', next: 'Next', page: 'Page', of: 'of', print: 'Print job', speed: 'km/h', degrees: '°', routeMap: 'Route vs GPS map', openRoute: 'Open saved route', withinRoute: 'Within route', deviated: 'Route deviation', deviationBody: 'GPS stayed outside the route corridor for', deviationBegan: 'Deviation began', deviationLocation: 'GPS location', deviationDistance: 'Off route', deviationDuration: 'Confirmed duration', seconds: 'seconds', km: 'km', noRoute: 'No route is assigned to this job yet.', assignedRoute: 'Assigned route', noAssignedRoute: 'No route', savingRoute: 'Saving route…', routeSaveFailed: 'Could not update the assigned route.', routeScope: 'Apply change to', thisJob: 'This job', thisJobHint: 'Only this saved job.', workPeriod: 'Work period', workPeriodHint: 'This job and every job in the same work period.', workPeriodSaved: 'Route applied to {count} jobs in this work period.', routeSaved: 'Route updated for this job.', routeRemoved: 'Route removed from this job.', editRoute: 'Edit route', closeRouteEditor: 'Close editor', cancel: 'Cancel', applyRoute: 'Apply route', showPoints: 'Show GPS points', hidePoints: 'Hide GPS points', recordedPoints: '{count} recorded points',
  },
  th: {
    title: 'รายละเอียด GPS', close: 'ปิด', vehicle: 'รถ', driver: 'พขร.', activity: 'กิจกรรม', time: 'เวลา',
    device: 'จุด GPS', last: 'พิกัด GPS ล่าสุด', captured: 'เวลาพิกัด GPS', coordinates: 'พิกัด', speedLabel: 'ความเร็ว', heading: 'ทิศทาง',
    loading: 'กำลังโหลดจุด GPS…', loadingHint: 'กำลังตรวจสอบรายละเอียด GPS ที่บันทึกไว้สำหรับงานนี้', failed: 'ไม่สามารถโหลดรายละเอียด GPS', failedHint: 'กำลังแสดงจำนวนจุด GPS ที่บันทึกไว้กับงาน', empty: 'ยังไม่มีจุด GPS ที่เชื่อมกับงานนี้', lookupStatus: 'การค้นหา GPS', gpsReady: 'พร้อมดูเส้นทาง GPS', gpsReadyHint: 'พบจุด GPS ที่ตรงกับเวลางาน {count} จุด', gpsMissing: 'ยังไม่พบพิกัด GPS', gpsMissingHint: 'ค้นหาตามเวลาของงานนี้อีกครั้งได้โดยไม่ต้องออกจากหน้านี้', gpsNotApplicable: 'ไม่ต้องค้นหา GPS', gpsNotApplicableHint: 'งานที่ยกเลิกนี้ยังคงอยู่ในประวัติโดยไม่ต้องค้นหา GPS', lookupPending: 'กำลังค้นหาข้อมูล', retry: 'ค้นหา GPS อีกครั้ง', retrying: 'กำลังค้นหา GPS…', retryFailed: 'ไม่สามารถค้นหา GPS อีกครั้งได้', retryComplete: 'ค้นหาข้อมูล GPS แล้ว', retryNoData: 'ค้นหาแล้ว แต่ไม่พบจุด GPS ที่ตรงกับงานนี้', retryUnavailable: 'ไม่สามารถค้นหา GPS สำหรับงานนี้ได้', retryLookupFailed: 'ผู้ให้บริการ GPS ไม่สามารถค้นหาข้อมูลนี้ได้', retryFinished: 'ค้นหา GPS เสร็จแล้ว',
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

function pointCountValue(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function retryFeedbackFor(data, lang, t) {
  const status = data.report?.gpsLookupStatus;
  if (status === 'no_data') return { tone: 'neutral', text: t.retryNoData };
  if (status === 'lookup_unavailable') return { tone: 'error', text: t.retryUnavailable };
  if (status === 'lookup_failed') return { tone: 'error', text: t.retryLookupFailed };
  if (status === 'not_applicable') return { tone: 'neutral', text: t.gpsNotApplicable };
  if (['paired', 'partial', 'device_only'].includes(status) || data.gpsReconciliation?.gpsSync) {
    const sourceMessage = displayGpsLookupMessage(
      data.gpsReconciliation?.deviceSource?.message,
      lang,
      data.gpsReconciliation?.gpsSync ? 1 : pointCountValue(data.report?.deviceGpsSamples),
    );
    return { tone: 'success', text: lang === 'th' ? t.retryComplete : sourceMessage || t.retryComplete };
  }
  return { tone: 'neutral', text: t.retryFinished };
}

export default function JobGpsDrawer({ report, lang, onClose, onReportUpdated, onRouteAssigned }) {
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
  const [retrying, setRetrying] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState(null);

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
    setRetryFeedback(null);
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

  async function retryLookup() {
    if (retrying) return;
    setRetrying(true);
    setRetryFeedback(null);
    setError('');
    let data;
    try {
      data = await adminFetch('/api/admin/reports/retry', { method: 'POST', body: JSON.stringify({ reportId: report.id }) });
    } catch {
      setRetryFeedback({ tone: 'error', text: t.retryFailed });
      setRetrying(false);
      return;
    }

    const mutatedReport = { ...report, ...(data.report || {}) };
    setDetail(current => current?.report?.id === report.id ? { ...current, report: { ...(current.report || {}), ...mutatedReport } } : current);
    setRetryFeedback(retryFeedbackFor(data, lang, t));
    onReportUpdated?.(mutatedReport);

    try {
      const refreshed = await adminFetch(`/api/admin/reports/${encodeURIComponent(report.id)}/gps?page=${page}&pageSize=50`, { cacheOffline: false });
      setDetail(refreshed);
      if (refreshed.route) setMapSamples(await adminFetchReportGpsSamples(report.id).catch(() => []));
      else setMapSamples([]);
    } catch {
      setError(t.failed);
    } finally {
      setRetrying(false);
    }
  }

  const activeDetail = detail?.report?.id === report.id ? detail : null;
  const summary = activeDetail?.gpsSummary || {};
  const samples = Array.isArray(activeDetail?.samples) ? activeDetail.samples : [];
  const pageInfo = activeDetail?.pageInfo || { page: 1, totalPages: 1 };
  const displayedReport = { ...report, ...(activeDetail?.report || {}) };
  const routeDeviation = activeDetail?.routeDeviation;
  const currentRouteName = displayedReport.routeName || '';
  const reportPointCount = pointCountValue(report.deviceGpsSamples);
  const detailPointCount = pointCountValue(summary.deviceSamples ?? samples.length);
  const pointCount = loading || error || retrying || !activeDetail ? reportPointCount : detailPointCount;
  const lookupPending = displayedReport.gpsLookupStatus === 'pending';
  const lookupNotApplicable = displayedReport.status === 'Cancelled' || displayedReport.gpsLookupStatus === 'not_applicable';
  const retryAllowed = !lookupNotApplicable && (!displayedReport.driverName || !pointCount || ['pending', 'no_data', 'lookup_failed', 'lookup_unavailable'].includes(displayedReport.gpsLookupStatus));
  const lookupBusy = !error && (loading || retrying || !activeDetail);
  const lookupCardState = lookupBusy
    ? 'is-loading'
    : lookupNotApplicable && !pointCount
      ? 'is-neutral'
      : error || (!pointCount && retryAllowed) ? 'needs-attention' : 'is-ready';
  const lookupTitle = lookupBusy
    ? retrying ? t.retrying : t.loading
    : error ? t.failed
      : pointCount ? t.gpsReady
        : lookupNotApplicable ? t.gpsNotApplicable
          : lookupPending ? t.lookupPending : t.gpsMissing;
  const lookupHint = lookupBusy
    ? retrying ? t.lookupPending : t.loadingHint
    : error ? t.failedHint
      : pointCount ? t.gpsReadyHint.replace('{count}', String(pointCount))
        : lookupNotApplicable ? t.gpsNotApplicableHint : t.gpsMissingHint;

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

        <section className={`gps-lookup-card ${lookupCardState}`} aria-labelledby="gps-detail-title">
          <span className="gps-lookup-icon" aria-hidden="true"><MapPinLineIcon size={22} weight="bold" /></span>
          <div className="gps-lookup-copy">
            <h2 id="gps-detail-title">{t.title}</h2>
            <strong>{lookupTitle}</strong>
            <p>{lookupHint}</p>
          </div>
          <dl className="gps-lookup-metrics">
            <div><dt>{t.device}</dt><dd>{pointCount}</dd></div>
            <div><dt>{t.last}</dt><dd>{summary.lastCapturedAt ? time(summary.lastCapturedAt, lang) : '—'}</dd></div>
          </dl>
          {retryAllowed ? <button className="gps-retry-button" type="button" aria-label={`${t.retry}: ${displayedReport.id}`} disabled={lookupBusy} onClick={retryLookup}><ArrowsClockwiseIcon className={retrying ? 'is-spinning' : undefined} size={17} weight="bold" aria-hidden="true" /><span>{retrying ? t.retrying : t.retry}</span></button> : null}
          {retryFeedback ? <p className={`gps-lookup-feedback${retryFeedback.tone === 'neutral' ? '' : ` ${retryFeedback.tone}`}`} role={retryFeedback.tone === 'error' ? 'alert' : 'status'}>
            {retryFeedback.tone === 'success' ? <CheckCircleIcon size={16} weight="fill" aria-hidden="true" /> : retryFeedback.tone === 'error' ? <WarningCircleIcon size={16} weight="fill" aria-hidden="true" /> : <MapPinLineIcon size={16} weight="fill" aria-hidden="true" />}
            {retryFeedback.text}
          </p> : null}
        </section>

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

        {activeDetail?.route ? <section className="gps-route-section">
          <div className="gps-route-heading"><h2>{t.routeMap}</h2><a href={activeDetail.route.googleMapsUrl} target="_blank" rel="noreferrer">{t.openRoute}<ArrowSquareOutIcon size={14} weight="bold" aria-hidden="true" /></a></div>
          <RouteMap anchors={activeDetail.route.anchors} samples={mapSamples.length ? mapSamples : samples} deviationEvents={routeDeviation?.events || []} label={t.routeMap} lang={lang} />
          {routeDeviation?.status === 'deviated' ? <details className="route-deviation-status deviated"><summary><span><WarningCircleIcon size={16} weight="fill" aria-hidden="true" /><strong>{t.deviated}</strong>{` · ${Math.round(routeDeviation.longestDurationSeconds)} ${t.seconds}`}</span><CaretDownIcon size={15} weight="bold" aria-hidden="true" /></summary><p>{`${t.deviationBody} ${Math.round(routeDeviation.longestDurationSeconds)} ${t.seconds}`}</p><div className="route-deviation-events">{(routeDeviation.events || []).map((event, index) => <dl key={`${event.startedAt}-${index}`}><div><dt>{t.deviationBegan}</dt><dd>{time(event.startedAt, lang)}</dd></div><div><dt>{t.deviationLocation}</dt><dd>{coordinate(event)}</dd></div><div><dt>{t.deviationDistance}</dt><dd>{distance(event.startDistanceKm, lang)}</dd></div><div><dt>{t.deviationDuration}</dt><dd>{Math.round(event.durationSeconds)} {t.seconds}</dd></div></dl>)}</div></details> : null}
          {routeDeviation?.status === 'within_route' && pointCount > 0 ? <p className="route-deviation-status within-route"><CheckCircleIcon size={16} weight="fill" aria-hidden="true" /><strong>{t.withinRoute}</strong></p> : null}
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
