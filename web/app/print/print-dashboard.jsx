'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { operationActions } from '../../lib/actions';
import { formatReportCoordinate, reportDateKey } from '../../lib/report-view';
import { filterReports, hasRestrictiveReportFilters } from '../../lib/report-filter';
import { timelineReportMatchesFilters } from '../../lib/timeline-filter';
import { TIMELINE_AXIS_LABELS, bangkokMinuteOfDay, timelinePosition } from '../../lib/timeline-position';
import { adminFetch, adminFetchAllReports } from '../dashboard-api';
import { useReportSpeedSeries } from '../report-speed-series';
import SpeedTimelineOverlay from '../speed-timeline';

const MODE_META = Object.fromEntries(operationActions.map(action => [action[2], { number: action[0], th: action[1], en: action[2] }]));
const MODE_COLORS = { Load: '#D5283D', Unload: '#203854', 'Stop vehicle': '#DFA036', Driving: '#68727D' };

function validDate(value) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : reportDateKey(new Date().toISOString()); }
function dateValue(value) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; }
function time(value, lang) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date) : '—';
}
function shortTime(value, lang) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(date) : '—';
}
function longDate(dateKey, lang) {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00+07:00`));
}
function reportDate(dateKey, lang) {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-US', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00+07:00`));
}
function elapsed(start, end) {
  const startDate = dateValue(start);
  const endDate = dateValue(end);
  if (!startDate || !endDate) return '—';
  const totalSeconds = Math.max(0, Math.floor((endDate - startDate) / 1000));
  return `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
function elapsedSeconds(report) {
  const start = dateValue(report.startTime);
  const end = dateValue(report.endTime);
  return start && end ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}
function speed(report) {
  const value = Number(report.topSpeed ?? report.maxSpeed ?? report.maximumSpeed);
  return Number.isFinite(value) ? value : null;
}
function distance(report) {
  const value = Number(report.distanceKm ?? report.distance ?? report.gpsDistanceKm);
  return Number.isFinite(value) ? value : null;
}
function hasGps(report) { return Number(report.deviceGpsSamples) > 0; }
function isLookupPending(report) { return report.gpsLookupStatus === 'pending'; }
function modeLabel(report, lang) { return MODE_META[report.mode]?.[lang] || report.mode || '—'; }
function jobTypeClass(mode) {
  if (mode === 'Load') return 'load';
  if (mode === 'Unload') return 'unload';
  if (mode === 'Stop vehicle') return 'stop';
  return 'other';
}
function location(report, lang) {
  const latitude = formatReportCoordinate(report.lastDeviceLatitude ?? report.latitude);
  const longitude = formatReportCoordinate(report.lastDeviceLongitude ?? report.longitude);
  const coordinates = latitude && longitude ? `${latitude}, ${longitude}` : '';
  return { name: report.locationName || report.location || report.address || (lang === 'th' ? 'ไม่มีชื่อสถานที่' : 'Location unavailable'), coordinates };
}
function totalDuration(seconds) { return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function modeColor(mode) { return MODE_COLORS[mode] || '#68727D'; }
function portraitTimelinePosition(startValue, endValue, fallbackMinutes = 5) {
  const start = bangkokMinuteOfDay(startValue);
  const end = bangkokMinuteOfDay(endValue);
  const startDate = dateValue(startValue);
  const endDate = dateValue(endValue);
  if (start == null || !startDate) return null;
  const windowStart = 6 * 60;
  const windowEnd = 24 * 60;
  const crossesMidnight = Boolean(endDate && end != null && endDate > startDate && end < start);
  const rawEnd = crossesMidnight ? windowEnd : (end ?? start + fallbackMinutes);
  const boundedStart = Math.max(windowStart, Math.min(windowEnd, start));
  const boundedEnd = Math.max(boundedStart + fallbackMinutes, Math.min(windowEnd, rawEnd));
  if (boundedStart >= windowEnd) return null;
  return {
    left: ((boundedStart - windowStart) / (windowEnd - windowStart)) * 100,
    width: ((Math.min(windowEnd, boundedEnd) - boundedStart) / (windowEnd - windowStart)) * 100,
  };
}
function alertFor(report) {
  const explicit = Array.isArray(report.alerts) ? report.alerts : [];
  const hasHarshBraking = Boolean(report.harshBraking || report.harshBrake || Number(report.harshBrakingCount) > 0 || explicit.some(value => /brak/i.test(String(value))));
  if (hasHarshBraking) return { type: 'braking', label: 'Harsh Braking', th: 'เบรกกะทันหัน' };
  if (speed(report) > 90 || report.speeding === true || Number(report.speedingCount) > 0) return { type: 'speeding', label: `Speeding (${speed(report)} km/h)`, th: `ความเร็วเกินกำหนด (${speed(report)} กม./ชม.)` };
  return null;
}
function statusLabel(report, lang) {
  if (report.status === 'Cancelled') return lang === 'th' ? 'ยกเลิก' : 'Cancelled';
  if (hasGps(report)) return lang === 'th' ? 'พบ GPS' : 'GPS found';
  if (isLookupPending(report)) return lang === 'th' ? 'รอค้นหา GPS' : 'GPS pending';
  return report.status || (lang === 'th' ? 'บันทึกแล้ว' : 'Saved');
}

function useDocumentLanguage(lang) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}

function PrintToolbar({ lang, onPrint, backPath = '/', date = '', onDateChange = null }) {
  const reportDateInputRef = useRef(null);
  function openReportDate() {
    const nextDate = reportDateInputRef.current?.value || '';
    if (nextDate) onDateChange?.(nextDate);
  }
  return <div className="print-toolbar" role="toolbar" aria-label={lang === 'th' ? 'คำสั่งพิมพ์' : 'Print controls'}>
    <button type="button" onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.assign(backPath); }}>{lang === 'th' ? 'กลับแดชบอร์ด' : 'Back to dashboard'}</button>
    {onDateChange ? <><label className="print-date-control"><span>{lang === 'th' ? 'วันที่รายงาน' : 'Report date'}</span><input key={date} ref={reportDateInputRef} type="date" defaultValue={date} /></label><button type="button" onClick={openReportDate}>{lang === 'th' ? 'เปิดวันที่' : 'View date'}</button></> : null}
    <button className="primary" type="button" onClick={onPrint}>{lang === 'th' ? 'พิมพ์ / บันทึก PDF' : 'Print / Save PDF'}</button>
  </div>;
}

function PrintHeader({ subtitle, compact = false }) {
  return <header className={`print-header ${compact ? 'compact' : ''}`}>
    <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} loading="eager" />
    <div><strong><span>Songdee GPS</span> Ops Panel</strong><small>{subtitle}</small></div>
  </header>;
}

function usePrintData(filters, lang) {
  const [reports, setReports] = useState([]);
  const [bindings, setBindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [reportResult, bindingResult] = await Promise.all([
        adminFetchAllReports(filters),
        adminFetch('/api/admin/device-bindings').catch(() => ({ deviceBindings: [] })),
      ]);
      setReports(filterReports(reportResult, filters, lang));
      setBindings(bindingResult.deviceBindings || []);
    } catch (errorValue) { setError(errorValue instanceof Error ? errorValue.message : 'Request failed'); }
    finally { setLoading(false); }
  }, [filters, lang]);
  useEffect(() => { void load(); }, [load]);
  return { reports, bindings, loading, error, load };
}

function PrintState({ lang, loading, error, onRetry }) {
  if (loading) return <main className="print-state" role="status" aria-live="polite"><Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} loading="eager" /><p>{lang === 'th' ? 'กำลังจัดทำรายงาน…' : 'Preparing report…'}</p></main>;
  if (error) return <main className="print-state" role="alert"><h1>{lang === 'th' ? 'เปิดรายงานไม่ได้' : 'Could not open report'}</h1><p>{error}</p><button className="primary" type="button" onClick={onRetry}>{lang === 'th' ? 'ลองใหม่' : 'Try again'}</button></main>;
  return null;
}

function summaryForVehicle(vehicle, reports) {
  const rows = reports.filter(report => report.vehicleNumber === vehicle).sort((left, right) => new Date(left.startTime) - new Date(right.startTime));
  const start = rows[0]?.startTime;
  const end = [...rows].reverse().find(report => report.endTime)?.endTime;
  const topSpeed = rows.reduce((maximum, report) => Math.max(maximum, speed(report) ?? -1), -1);
  const knownDistances = rows.map(distance).filter(value => value != null);
  return {
    vehicle,
    rows,
    driver: rows.find(report => report.driverName)?.driverName || '—',
    driverId: rows.find(report => report.driverId)?.driverId || '',
    start,
    end,
    shift: elapsed(start, end),
    topSpeed: topSpeed >= 0 ? topSpeed : null,
    distance: knownDistances.length ? knownDistances.reduce((sum, value) => sum + value, 0) : null,
    gpsMatched: rows.filter(hasGps).length,
    cancelled: rows.filter(report => report.status === 'Cancelled').length,
    gpsPending: rows.filter(isLookupPending).length,
  };
}

function TimelineBar({ rows, lang, speedSeries }) {
  const details = rows.map(report => `${modeLabel(report, lang)}, ${time(report.startTime, lang)}–${time(report.endTime, lang)}, ${statusLabel(report, lang)}`);
  const label = details.length
    ? `${lang === 'th' ? 'ไทม์ไลน์งาน' : 'Job timeline'}: ${details.join('. ')}`
    : (lang === 'th' ? 'ไม่มีงานที่บันทึก' : 'No recorded jobs');
  return <div className="print-timeline-track" role="img" aria-label={label}>
    {rows.map(report => {
      const position = timelinePosition(report.startTime, report.endTime);
      if (!position) return null;
      return <span aria-hidden="true" key={report.id || `${report.vehicleNumber}-${report.startTime}`} title={modeLabel(report, lang)} style={{ left: `${position.left}%`, width: `${Math.max(.7, position.width)}%`, background: modeColor(report.mode), opacity: report.status === 'Cancelled' ? .35 : 1 }} />;
    })}
    <SpeedTimelineOverlay reports={rows} samplesByReportId={speedSeries.samplesByReportId} loading={speedSeries.loading} lang={lang} />
  </div>;
}

function paginateJobs(reports, pageSize = 16) {
  const ordered = [...reports].sort((left, right) => new Date(right.startTime) - new Date(left.startTime));
  return Array.from({ length: Math.ceil(ordered.length / pageSize) }, (_, index) => ordered.slice(index * pageSize, (index + 1) * pageSize));
}

function JobListPrintPage({ rows, lang, page, totalPages }) {
  return <section className="print-sheet landscape-sheet job-list-print-sheet">
    <div className="landscape-header-row"><PrintHeader compact subtitle={lang === 'th' ? 'รายการงานโดยละเอียด · Detailed job list' : 'Detailed job list · รายการงานโดยละเอียด'} /><strong className="print-job-count">{rows.length} {lang === 'th' ? 'งานในหน้านี้' : 'jobs on this page'}</strong></div>
    <table className="fleet-job-print-table">
      <caption className="sr-only">{lang === 'th' ? 'รายการงานโดยละเอียด' : 'Detailed job list'}</caption>
      <thead><tr><th scope="col">{lang === 'th' ? 'รถ / รหัสงาน' : 'Vehicle / job ID'}</th><th scope="col">{lang === 'th' ? 'พขร.' : 'Driver'}</th><th scope="col">{lang === 'th' ? 'กิจกรรม' : 'Activity'}</th><th scope="col">{lang === 'th' ? 'วันที่' : 'Date'}</th><th scope="col">{lang === 'th' ? 'เริ่ม–จบ' : 'Start–end'}</th><th scope="col">{lang === 'th' ? 'ระยะเวลา' : 'Duration'}</th><th scope="col">{lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'}</th><th scope="col">{lang === 'th' ? 'ตำแหน่ง GPS' : 'GPS position'}</th><th scope="col">GPS</th><th scope="col">{lang === 'th' ? 'สถานะ' : 'Status'}</th></tr></thead>
      <tbody>{rows.map(report => {
        const place = location(report, lang);
        const reportSpeed = speed(report);
        const gpsPoints = Number(report.deviceGpsSamples) || 0;
        return <tr className={report.status === 'Cancelled' ? 'cancelled' : ''} key={report.id || `${report.vehicleNumber}-${report.startTime}`}>
          <td><strong>{report.vehicleNumber || '—'}</strong><small>{report.id || '—'}</small></td>
          <td><strong>{report.driverName || '—'}</strong><small>{report.driverId || '—'}</small></td>
          <td>{modeLabel(report, lang)}</td>
          <td>{reportDateKey(report.startTime) || '—'}</td>
          <td>{time(report.startTime, lang)}–{time(report.endTime, lang)}</td>
          <td>{elapsed(report.startTime, report.endTime)}</td>
          <td className={reportSpeed > 90 ? 'speed-alert' : ''}>{reportSpeed == null ? '—' : reportSpeed}</td>
          <td><span>{place.name}</span><small>{place.coordinates || '—'}</small></td>
          <td className={gpsPoints ? 'print-success' : isLookupPending(report) ? 'print-warning' : ''}>{gpsPoints ? `${gpsPoints} ${lang === 'th' ? 'จุด' : 'points'}` : (lang === 'th' ? 'ไม่มีข้อมูล' : 'No data')}</td>
          <td className={report.status === 'Cancelled' ? 'print-danger' : 'print-success'}>{report.status === 'Cancelled' ? (lang === 'th' ? 'ยกเลิก' : 'Cancelled') : (lang === 'th' ? 'เสร็จสิ้น' : 'Completed')}</td>
        </tr>;
      })}</tbody>
    </table>
    <PrintFooter lang={lang} page={`${page}/${totalPages}`} />
  </section>;
}

export function LandscapePrintDashboard({ filters = {}, lang: requestedLang, timelineOnly = false, timelineFilters = null }) {
  const lang = requestedLang === 'en' ? 'en' : 'th';
  useDocumentLanguage(lang);
  const stableFilters = useMemo(() => filters, [JSON.stringify(filters)]);
  const { reports, bindings, loading, error, load } = usePrintData(stableFilters, lang);
  const timelineReports = useMemo(() => timelineOnly && timelineFilters
    ? reports.filter(report => timelineReportMatchesFilters(report, timelineFilters))
    : reports, [reports, timelineOnly, timelineFilters]);
  const speedSeries = useReportSpeedSeries(timelineReports);
  const timelinePages = useMemo(() => {
    const reportDates = [...new Set(timelineReports.map(report => reportDateKey(report.startTime)).filter(Boolean))].sort();
    const dates = reportDates.length
      ? reportDates
      : [validDate(stableFilters.endDate || stableFilters.startDate)];
    const restricted = hasRestrictiveReportFilters(stableFilters) || Boolean(timelineOnly && timelineFilters);
    const result = [];
    for (const date of dates) {
      const dayReports = timelineReports.filter(report => reportDateKey(report.startTime) === date);
      const vehicles = new Set([
        ...(restricted ? [] : bindings.map(binding => binding.vehicleNumber)),
        ...dayReports.map(report => report.vehicleNumber),
      ].filter(Boolean));
      const summaries = [...vehicles]
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        .map(vehicle => summaryForVehicle(vehicle, dayReports));
      const pageCount = Math.max(1, Math.ceil(summaries.length / 14));
      for (let index = 0; index < pageCount; index += 1) {
        result.push({ date, dayReports, rows: summaries.slice(index * 14, (index + 1) * 14) });
      }
    }
    return result;
  }, [bindings, stableFilters, timelineFilters, timelineOnly, timelineReports]);
  const detailedJobPages = useMemo(() => timelineOnly ? [] : paginateJobs(reports), [reports, timelineOnly]);
  if (loading || speedSeries.loading || error) return <PrintState lang={lang} loading={loading || speedSeries.loading} error={error} onRetry={load} />;
  const totalPages = timelinePages.length + detailedJobPages.length;
  return <main className="print-preview landscape-preview">
    <PrintToolbar lang={lang} backPath={timelineOnly ? '/timeline' : '/'} onPrint={() => window.print()} />
    {timelinePages.map((page, pageIndex) => {
      const totalDistance = page.rows.map(row => row.distance).filter(value => value != null).reduce((sum, value) => sum + value, 0);
      const knownDistance = page.rows.some(row => row.distance != null);
      const topSpeed = page.rows.reduce((maximum, row) => Math.max(maximum, row.topSpeed ?? -1), -1);
      return <section className="print-sheet landscape-sheet" key={`${page.date}-${pageIndex}`}>
      <div className="landscape-header-row"><PrintHeader compact subtitle={`${lang === 'th' ? 'สรุปรถทุกคันรายวัน' : 'Daily fleet summary'} · ${longDate(page.date, lang)}`} /><div className="print-legend"><span><i className="load" aria-hidden="true" />{lang === 'th' ? 'ขึ้นสินค้า' : 'Load'}</span><span><i className="unload" aria-hidden="true" />{lang === 'th' ? 'ลงสินค้า' : 'Unload'}</span><span><i className="stop" aria-hidden="true" />{lang === 'th' ? 'หยุดรอ' : 'Stop / wait'}</span><span><i className="other" aria-hidden="true" />{lang === 'th' ? 'พัก/อื่น ๆ' : 'Break / other'}</span></div></div>
      <div className="fleet-print-grid fleet-print-heading"><span>{lang === 'th' ? 'เบอร์รถ / พขร. (รูดบัตร)' : 'Vehicle / driver (card)'}</span><div>{TIMELINE_AXIS_LABELS.map(label => <span key={label}>{label}</span>)}</div><span>{lang === 'th' ? 'ชม.กะ' : 'Shift'}</span><span>{lang === 'th' ? 'งาน' : 'Jobs'}</span><span>{lang === 'th' ? 'กม.' : 'km'}</span><span>{lang === 'th' ? 'เร็วสูงสุด' : 'Max'}</span><span>{lang === 'th' ? 'พบ GPS' : 'GPS found'}</span></div>
      <div className="fleet-print-body">{page.rows.map(row => <div className="fleet-print-grid fleet-print-row" key={row.vehicle}>
        <div><strong>{row.vehicle}</strong><small>{row.rows.length ? `${row.driver} · ${time(row.start, lang)}–${time(row.end, lang)}` : (lang === 'th' ? 'ไม่ได้วิ่งงาน' : 'No recorded jobs')}</small></div>
        <TimelineBar rows={row.rows} lang={lang} speedSeries={speedSeries} />
        <span>{row.shift}</span><span>{row.rows.length}</span><span>{row.distance == null ? '—' : row.distance.toFixed(1)}</span><span className={row.topSpeed > 90 ? 'speed-alert' : ''}>{row.topSpeed ?? '—'}</span><span className={row.gpsPending ? 'print-warning' : 'print-success'}>{row.rows.length ? `${row.gpsMatched}/${row.rows.length}` : '—'}</span>
      </div>)}</div>
      <div className="fleet-print-total"><span>{lang === 'th' ? 'รวมทุกคัน' : 'Fleet total'}</span><strong>{page.dayReports.length} {lang === 'th' ? 'งาน' : 'jobs'}</strong><strong>{knownDistance ? `${totalDistance.toFixed(1)} km` : (lang === 'th' ? 'ระยะทาง —' : 'Distance —')}</strong><strong>{topSpeed >= 0 ? `${lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'} ${topSpeed}` : `${lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'} —`}</strong><strong className="print-success">GPS {page.dayReports.filter(hasGps).length}/{page.dayReports.length}</strong><strong className="print-danger">{lang === 'th' ? 'ยกเลิก' : 'Cancelled'} {page.dayReports.filter(report => report.status === 'Cancelled').length} · {lang === 'th' ? 'รอค้นหา' : 'Pending'} {page.dayReports.filter(isLookupPending).length}</strong></div>
      <PrintFooter lang={lang} page={`${pageIndex + 1}/${totalPages}`} />
    </section>})}
    {detailedJobPages.map((rows, pageIndex) => <JobListPrintPage key={`jobs-${pageIndex}`} rows={rows} lang={lang} page={timelinePages.length + pageIndex + 1} totalPages={totalPages} />)}
  </main>;
}

function Kpi({ label, value, note, danger = false }) { return <div className={danger ? 'print-kpi danger' : 'print-kpi'}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>; }
function PrintFooter({ lang, page }) { return <footer className="print-footer"><span>Songdee Ops Panel · GPS</span><span>{new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date())} · {lang === 'th' ? 'หน้า' : 'Page'} {page}</span></footer>; }

export function PortraitPrintDashboard({ date: requestedDate, vehicle: requestedVehicle, lang: requestedLang }) {
  const lang = requestedLang === 'en' ? 'en' : 'th';
  useDocumentLanguage(lang);
  const date = validDate(requestedDate);
  const portraitFilters = useMemo(() => ({ startDate: date, endDate: date }), [date]);
  const { reports, bindings, loading, error, load } = usePrintData(portraitFilters, lang);
  const vehicle = requestedVehicle || reports.find(report => report.vehicleNumber)?.vehicleNumber || bindings[0]?.vehicleNumber || '';
  const summary = useMemo(() => summaryForVehicle(vehicle, reports), [vehicle, reports]);
  const speedSeries = useReportSpeedSeries(summary.rows);
  if (loading || speedSeries.loading || error) return <PrintState lang={lang} loading={loading || speedSeries.loading} error={error} onRetry={load} />;
  const totalSeconds = summary.rows.reduce((sum, report) => sum + elapsedSeconds(report), 0);
  const shiftSeconds = summary.start && summary.end ? Math.max(0, Math.floor((dateValue(summary.end) - dateValue(summary.start)) / 1000)) : 0;
  const breakSeconds = Math.max(0, shiftSeconds - totalSeconds);
  const alerts = summary.rows.map(report => ({ report, alert: alertFor(report) })).filter(item => item.alert);
  const printedAt = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const documentId = `SD-${date.replaceAll('-', '')}-${vehicle || 'FLEET'}`;
  const durationShort = seconds => `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
  const timelineRows = summary.rows.map(report => {
    const position = portraitTimelinePosition(report.startTime, report.endTime);
    return position ? { report, position } : null;
  }).filter(Boolean);
  const visibleAlerts = alerts.slice(0, 3);
  const visibleJobs = summary.rows.slice(0, 8);
  function changeReportDate(nextDate) {
    if (!nextDate) return;
    const params = new URLSearchParams({ date: nextDate, lang });
    if (vehicle) params.set('vehicle', vehicle);
    window.location.assign(`/print/portrait?${params}`);
  }
  return <main className="print-preview portrait-preview">
    <PrintToolbar lang={lang} date={date} onDateChange={changeReportDate} onPrint={() => window.print()} />
    <section className="print-sheet portrait-sheet">
      <header className="report-masthead"><div className="report-brand"><Image src="/songdee-gps-pin.svg" alt="" width={62} height={76} /><div><strong>SONGDEE GPS</strong><span>FLEET &amp; FIELD OPERATIONS</span></div></div><div className="report-heading"><small>DAILY VEHICLE REPORT</small><h1>{lang === 'th' ? 'รายงานการเดินรถประจำวัน' : 'Daily Vehicle Report'}</h1><p>{lang === 'th' ? `เลขที่เอกสาร ${documentId} · พิมพ์เมื่อ ${printedAt}` : `Document ID ${documentId} · Printed ${printedAt}`}</p></div></header>
      <div className="trip-info-row"><div><small>{lang === 'th' ? 'ทะเบียนรถ' : 'Vehicle Plate'}</small><strong>{vehicle || '—'}</strong></div><div><small>{lang === 'th' ? 'คนขับ' : 'Driver'}</small><strong>{summary.driver}</strong></div><div><small>{lang === 'th' ? 'วันที่' : 'Date'}</small><strong>{reportDate(date, lang)}</strong></div><div><small>{lang === 'th' ? 'เวลาเริ่ม–สิ้นสุด' : 'Shift Start–End'}</small><strong>{shortTime(summary.start, lang)} – {shortTime(summary.end, lang)}</strong></div><div><small>{lang === 'th' ? 'สถานะ' : 'Status'}</small><strong className="trip-status">{lang === 'th' ? (summary.cancelled ? 'มีข้อยกเว้น' : 'เสร็จสิ้น') : (summary.cancelled ? 'Attention' : 'Completed')}</strong></div></div>
      <div className="report-kpi-grid"><Kpi label={lang === 'th' ? 'ระยะทางรวม' : 'Total Distance'} value={summary.distance == null ? '—' : summary.distance.toFixed(1)} note="km" /><Kpi label={lang === 'th' ? 'งานที่เสร็จ' : 'Jobs Completed'} value={summary.rows.length} note={lang === 'th' ? 'งาน' : 'jobs'} /><Kpi label={lang === 'th' ? 'เวลาทำงานรวม' : 'Total Working Time'} value={durationShort(totalSeconds)} note={lang === 'th' ? 'ชม.' : 'hrs'} /><Kpi label={lang === 'th' ? 'เวลาพัก / รอ' : 'Break / Wait Time'} value={durationShort(breakSeconds)} note={lang === 'th' ? 'ชม.' : 'hrs'} /></div>
      <section className="report-section"><div className="report-section-heading"><h2>{lang === 'th' ? 'ไทม์ไลน์การเดินรถ' : 'TRIP TIMELINE'}</h2><strong className={alerts.length ? 'timeline-alert-count' : 'timeline-clear'}>△ {alerts.length} {lang === 'th' ? 'การแจ้งเตือนระหว่างทาง' : alerts.length === 1 ? 'alert during this trip' : 'alerts during this trip'}</strong></div><div className="timeline-legend"><span><i className="load" />{lang === 'th' ? 'โหลดสินค้า' : 'Load'}</span><span><i className="unload" />{lang === 'th' ? 'ส่งสินค้า' : 'Unload'}</span><span><i className="stop" />{lang === 'th' ? 'จอด/รอ' : 'Stop / Wait'}</span><span><i className="other" />{lang === 'th' ? 'พัก/อื่นๆ' : 'Break / Other'}</span><span><i className="speed" />{lang === 'th' ? 'ความเร็ว (กม./ชม.)' : 'Speed (km/h)'}</span><span><i className="alert" />{lang === 'th' ? 'การแจ้งเตือน' : 'Alert'}</span></div><div className="trip-timeline" role="group" aria-label={lang === 'th' ? 'ไทม์ไลน์การเดินรถพร้อมกราฟความเร็ว' : 'Trip timeline with vehicle speed graph'}>{timelineRows.map(({ report, position }) => <span key={report.id || report.startTime} className="timeline-segment" style={{ left: `${position.left}%`, width: `${Math.max(.9, position.width)}%`, background: modeColor(report.mode), opacity: report.status === 'Cancelled' ? .45 : 1 }} />)}<SpeedTimelineOverlay reports={summary.rows} samplesByReportId={speedSeries.samplesByReportId} loading={speedSeries.loading} lang={lang} startMinute={6 * 60} endMinute={24 * 60} className="print-speed-overlay" />{alerts.map(({ report }) => { const position = portraitTimelinePosition(report.startTime, report.endTime); return position ? <span key={`flag-${report.id || report.startTime}`} className="timeline-flag" style={{ left: `${position.left}%` }} aria-hidden="true" /> : null; })}</div><div className="timeline-axis">{['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '24:00'].map(label => <span key={label}>{label}</span>)}</div><div className="alert-list">{visibleAlerts.map(({ report, alert }) => <span key={`alert-${report.id || report.startTime}`}>● {shortTime(report.startTime, lang)} · {lang === 'th' ? alert.th : alert.label}</span>)}{alerts.length > visibleAlerts.length ? <span>+{alerts.length - visibleAlerts.length} {lang === 'th' ? 'รายการ' : 'more'}</span> : null}</div></section>
      <section className="report-section job-section"><div className="report-section-heading"><h2>{lang === 'th' ? 'รายการงาน' : 'JOB LIST'}</h2><span>{lang === 'th' ? 'รายงานประจำวัน · แสดงสูงสุด 8 งาน' : 'Daily report · Up to 8 jobs shown'}</span></div><table className="simple-job-table"><caption className="sr-only">{lang === 'th' ? 'รายการงาน' : 'Job list'}</caption><thead><tr><th>{lang === 'th' ? 'เวลา' : 'TIME'}</th><th>{lang === 'th' ? 'ประเภท' : 'TYPE'}</th><th>{lang === 'th' ? 'สถานที่ / รายละเอียด' : 'LOCATION / DETAILS'}</th><th>{lang === 'th' ? 'ระยะเวลา' : 'DURATION'}</th></tr></thead><tbody>{visibleJobs.map(report => { const place = location(report, lang); return <tr key={report.id || report.startTime}><td>{shortTime(report.startTime, lang)}–{shortTime(report.endTime, lang)}</td><td><span className={`job-type ${jobTypeClass(report.mode)}`}>{modeLabel(report, lang)}</span></td><td>{place.name}</td><td>{elapsed(report.startTime, report.endTime).slice(0, 5)}</td></tr>; })}{summary.rows.length > visibleJobs.length ? <tr className="additional-jobs"><td colSpan={4}>+{summary.rows.length - visibleJobs.length} {lang === 'th' ? 'งานเพิ่มเติม ดูรายละเอียดในแดชบอร์ด' : 'additional jobs · see dashboard for details'}</td></tr> : null}</tbody></table>{!summary.rows.length ? <p className="print-empty">{lang === 'th' ? 'ไม่มีงานที่บันทึกสำหรับรถและวันที่นี้' : 'No saved jobs for this vehicle and date.'}</p> : null}</section>
      <footer className="signature-footer"><div><span />{lang === 'th' ? 'ลายเซ็นคนขับ / Driver' : 'Driver Signature'}</div><div><span />{lang === 'th' ? 'ลายเซ็นหัวหน้างาน / Supervisor' : 'Supervisor Signature'}</div><div><span />{lang === 'th' ? 'วันที่ตรวจสอบ / Reviewed date' : 'Reviewed Date'}</div></footer>
    </section>
  </main>;
}
