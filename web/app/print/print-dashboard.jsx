'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { operationActions } from '../../lib/actions';
import { formatReportCoordinate, reportDateKey } from '../../lib/report-view';
import { filterReports, hasRestrictiveReportFilters } from '../../lib/report-filter';
import { timelineReportMatchesFilters } from '../../lib/timeline-filter';
import { TIMELINE_AXIS_LABELS, timelinePosition } from '../../lib/timeline-position';
import { adminFetch, adminFetchAllReports } from '../dashboard-api';

const MODE_META = Object.fromEntries(operationActions.map(action => [action[2], { number: action[0], th: action[1], en: action[2] }]));
const MODE_COLORS = { Load: '#E31B23', Unload: '#7A1424', 'Stop vehicle': '#B57A00', Driving: '#06264B' };

function validDate(value) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : reportDateKey(new Date().toISOString()); }
function dateValue(value) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; }
function time(value, lang) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date) : '—';
}
function longDate(dateKey, lang) {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00+07:00`));
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
function location(report, lang) {
  const latitude = formatReportCoordinate(report.lastDeviceLatitude ?? report.latitude);
  const longitude = formatReportCoordinate(report.lastDeviceLongitude ?? report.longitude);
  const coordinates = latitude && longitude ? `${latitude}, ${longitude}` : '';
  return { name: report.locationName || report.location || report.address || (lang === 'th' ? 'ไม่มีชื่อสถานที่' : 'Location unavailable'), coordinates };
}
function totalDuration(seconds) { return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function modeColor(mode) { return MODE_COLORS[mode] || '#68727D'; }
function statusLabel(report, lang) {
  if (report.status === 'Cancelled') return lang === 'th' ? 'ยกเลิก' : 'Cancelled';
  if (hasGps(report)) return lang === 'th' ? 'พบ GPS' : 'GPS found';
  if (isLookupPending(report)) return lang === 'th' ? 'รอค้นหา GPS' : 'GPS pending';
  return report.status || (lang === 'th' ? 'บันทึกแล้ว' : 'Saved');
}

function PrintToolbar({ lang, onPrint, backPath = '/' }) {
  return <div className="print-toolbar" role="toolbar" aria-label={lang === 'th' ? 'คำสั่งพิมพ์' : 'Print controls'}>
    <button type="button" onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.assign(backPath); }}>{lang === 'th' ? 'กลับแดชบอร์ด' : 'Back to dashboard'}</button>
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
  if (loading) return <main className="print-state"><Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} loading="eager" /><p>{lang === 'th' ? 'กำลังจัดทำรายงาน…' : 'Preparing report…'}</p></main>;
  if (error) return <main className="print-state"><h1>{lang === 'th' ? 'เปิดรายงานไม่ได้' : 'Could not open report'}</h1><p>{error}</p><button className="primary" type="button" onClick={onRetry}>{lang === 'th' ? 'ลองใหม่' : 'Try again'}</button></main>;
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

function TimelineBar({ rows, lang }) {
  return <div className="print-timeline-track" aria-label={lang === 'th' ? 'ไทม์ไลน์งาน' : 'Job timeline'}>
    {rows.map(report => {
      const position = timelinePosition(report.startTime, report.endTime);
      if (!position) return null;
      return <span key={report.id || `${report.vehicleNumber}-${report.startTime}`} title={modeLabel(report, lang)} style={{ left: `${position.left}%`, width: `${Math.max(.7, position.width)}%`, background: modeColor(report.mode), opacity: report.status === 'Cancelled' ? .35 : 1 }} />;
    })}
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
      <thead><tr><th>{lang === 'th' ? 'รถ / รหัสงาน' : 'Vehicle / job ID'}</th><th>{lang === 'th' ? 'พขร.' : 'Driver'}</th><th>{lang === 'th' ? 'กิจกรรม' : 'Activity'}</th><th>{lang === 'th' ? 'วันที่' : 'Date'}</th><th>{lang === 'th' ? 'เริ่ม–จบ' : 'Start–end'}</th><th>{lang === 'th' ? 'ระยะเวลา' : 'Duration'}</th><th>{lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'}</th><th>{lang === 'th' ? 'ตำแหน่ง GPS' : 'GPS position'}</th><th>GPS</th><th>{lang === 'th' ? 'สถานะ' : 'Status'}</th></tr></thead>
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
  const stableFilters = useMemo(() => filters, [JSON.stringify(filters)]);
  const { reports, bindings, loading, error, load } = usePrintData(stableFilters, lang);
  const timelineReports = useMemo(() => timelineOnly && timelineFilters
    ? reports.filter(report => timelineReportMatchesFilters(report, timelineFilters))
    : reports, [reports, timelineOnly, timelineFilters]);
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
  if (loading || error) return <PrintState lang={lang} loading={loading} error={error} onRetry={load} />;
  const totalPages = timelinePages.length + detailedJobPages.length;
  return <main className="print-preview landscape-preview">
    <PrintToolbar lang={lang} backPath={timelineOnly ? '/timeline' : '/'} onPrint={() => window.print()} />
    {timelinePages.map((page, pageIndex) => {
      const totalDistance = page.rows.map(row => row.distance).filter(value => value != null).reduce((sum, value) => sum + value, 0);
      const knownDistance = page.rows.some(row => row.distance != null);
      const topSpeed = page.rows.reduce((maximum, row) => Math.max(maximum, row.topSpeed ?? -1), -1);
      return <section className="print-sheet landscape-sheet" key={`${page.date}-${pageIndex}`}>
      <div className="landscape-header-row"><PrintHeader compact subtitle={`${lang === 'th' ? 'สรุปรถทุกคันรายวัน' : 'Daily fleet summary'} · ${longDate(page.date, lang)}`} /><div className="print-legend"><span><i className="load" />{lang === 'th' ? 'ขึ้นสินค้า' : 'Load'}</span><span><i className="unload" />{lang === 'th' ? 'ลงสินค้า' : 'Unload'}</span><span><i className="stop" />{lang === 'th' ? 'หยุดรอ' : 'Stop / wait'}</span><span><i className="other" />{lang === 'th' ? 'พัก/อื่น ๆ' : 'Break / other'}</span></div></div>
      <div className="fleet-print-grid fleet-print-heading"><span>{lang === 'th' ? 'เบอร์รถ / พขร. (รูดบัตร)' : 'Vehicle / driver (card)'}</span><div>{TIMELINE_AXIS_LABELS.map(label => <span key={label}>{label}</span>)}</div><span>{lang === 'th' ? 'ชม.กะ' : 'Shift'}</span><span>{lang === 'th' ? 'งาน' : 'Jobs'}</span><span>{lang === 'th' ? 'กม.' : 'km'}</span><span>{lang === 'th' ? 'เร็วสูงสุด' : 'Max'}</span><span>{lang === 'th' ? 'พบ GPS' : 'GPS found'}</span></div>
      <div className="fleet-print-body">{page.rows.map(row => <div className="fleet-print-grid fleet-print-row" key={row.vehicle}>
        <div><strong>{row.vehicle}</strong><small>{row.rows.length ? `${row.driver} · ${time(row.start, lang)}–${time(row.end, lang)}` : (lang === 'th' ? 'ไม่ได้วิ่งงาน' : 'No recorded jobs')}</small></div>
        <TimelineBar rows={row.rows} lang={lang} />
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
  const date = validDate(requestedDate);
  const portraitFilters = useMemo(() => ({ startDate: date, endDate: date }), [date]);
  const { reports, bindings, loading, error, load } = usePrintData(portraitFilters, lang);
  const vehicle = requestedVehicle || reports.find(report => report.vehicleNumber)?.vehicleNumber || bindings[0]?.vehicleNumber || '';
  const summary = useMemo(() => summaryForVehicle(vehicle, reports), [vehicle, reports]);
  const fleetSummaries = useMemo(() => [...new Set([...bindings.map(binding => binding.vehicleNumber), ...reports.map(report => report.vehicleNumber)].filter(Boolean))].sort().map(value => summaryForVehicle(value, reports)), [bindings, reports]);
  const modeTotals = useMemo(() => {
    const totals = new Map();
    for (const report of summary.rows) totals.set(report.mode || 'Other', (totals.get(report.mode || 'Other') || 0) + elapsedSeconds(report));
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  }, [summary.rows]);
  const driverSummaries = useMemo(() => {
    const drivers = new Map();
    for (const row of fleetSummaries) {
      if (row.driver === '—') continue;
      const current = drivers.get(row.driver) || { name: row.driver, vehicles: new Set(), jobs: 0, seconds: 0, topSpeed: null, cancelled: 0 };
      current.vehicles.add(row.vehicle); current.jobs += row.rows.length; current.seconds += row.rows.reduce((sum, report) => sum + elapsedSeconds(report), 0); current.topSpeed = Math.max(current.topSpeed ?? -1, row.topSpeed ?? -1); current.cancelled += row.cancelled;
      drivers.set(row.driver, current);
    }
    return [...drivers.values()];
  }, [fleetSummaries]);
  if (loading || error) return <PrintState lang={lang} loading={loading} error={error} onRetry={load} />;
  const totalSeconds = summary.rows.reduce((sum, report) => sum + elapsedSeconds(report), 0);
  return <main className="print-preview portrait-preview">
    <PrintToolbar lang={lang} onPrint={() => window.print()} />
    <section className="print-sheet portrait-sheet">
      <div className="portrait-header-row"><PrintHeader subtitle={lang === 'th' ? 'รายงานประจำวันรายคัน · Daily vehicle report' : 'Daily vehicle report · รายงานประจำวันรายคัน'} /><div className="report-number"><small>{lang === 'th' ? 'เลขที่รายงาน' : 'Report no.'}</small><strong>SD-{date.replaceAll('-', '')}-{vehicle || 'FLEET'}</strong></div></div>
      <div className="vehicle-print-title"><h1>{lang === 'th' ? 'รถ' : 'Vehicle'} {vehicle || '—'}</h1><strong>{longDate(date, lang)}</strong><span className={summary.gpsPending ? 'print-warning' : 'print-success'}>✓ GPS {summary.gpsMatched}/{summary.rows.length}</span></div>
      <div className="print-kpis"><Kpi label={lang === 'th' ? 'พขร. (รูดบัตร)' : 'Driver (card)'} value={summary.driver} note={summary.driverId || '—'} /><Kpi label={lang === 'th' ? 'เริ่มกะ – จบกะ' : 'Shift start – end'} value={`${time(summary.start, lang)} – ${time(summary.end, lang)}`} note={summary.shift} /><Kpi label={lang === 'th' ? 'งานที่บันทึก' : 'Recorded jobs'} value={`${summary.rows.length}`} note={`${lang === 'th' ? 'ยกเลิก' : 'Cancelled'} ${summary.cancelled}`} /><Kpi label={lang === 'th' ? 'ระยะทาง (GPS)' : 'Distance (GPS)'} value={summary.distance == null ? '—' : `${summary.distance.toFixed(1)} km`} note={`${lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'} ${summary.topSpeed ?? '—'}`} /><Kpi label={lang === 'th' ? 'เวลางานจริง' : 'Recorded work'} value={totalDuration(totalSeconds)} note={lang === 'th' ? 'รวมเวลางานที่เสร็จแล้ว' : 'Completed job time'} /><Kpi danger label={lang === 'th' ? 'ข้อยกเว้น' : 'Exceptions'} value={`${summary.cancelled + summary.gpsPending}`} note={lang === 'th' ? 'ยกเลิก + รอค้นหา GPS' : 'Cancelled + GPS pending'} /></div>
      <h2 className="print-section-title">{lang === 'th' ? 'ไทม์ไลน์กิจกรรม' : 'ACTIVITY TIMELINE'}</h2>
      <table className="portrait-job-table"><thead><tr><th>{lang === 'th' ? 'เริ่ม' : 'Start'}</th><th>{lang === 'th' ? 'จบ' : 'End'}</th><th>{lang === 'th' ? 'กิจกรรม' : 'Activity'}</th><th>{lang === 'th' ? 'ระยะเวลา' : 'Duration'}</th><th>{lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'}</th><th>{lang === 'th' ? 'สถานที่ (GPS)' : 'Location (GPS)'}</th><th>{lang === 'th' ? 'สถานะ' : 'Status'}</th></tr></thead><tbody>{summary.rows.map(report => {
        const place = location(report, lang); const reportSpeed = speed(report); const meta = MODE_META[report.mode];
        return <tr className={report.status === 'Cancelled' ? 'cancelled' : ''} key={report.id || report.startTime}><td>{time(report.startTime, lang)}</td><td>{time(report.endTime, lang)}</td><td><i style={{ background: modeColor(report.mode) }}>{meta?.number || '·'}</i><strong>{modeLabel(report, lang)}</strong></td><td>{elapsed(report.startTime, report.endTime)}</td><td className={reportSpeed > 90 ? 'speed-alert' : ''}>{reportSpeed == null ? '—' : reportSpeed === 0 ? (lang === 'th' ? 'จอดนิ่ง' : 'Stationary') : reportSpeed}</td><td><span>{place.name}</span><small>{place.coordinates || '—'}</small></td><td className={report.status === 'Cancelled' ? 'print-danger' : isLookupPending(report) ? 'print-warning' : 'print-success'}>{statusLabel(report, lang)}</td></tr>;
      })}</tbody></table>
      {!summary.rows.length ? <p className="print-empty">{lang === 'th' ? 'ไม่มีงานที่บันทึกสำหรับรถและวันที่นี้' : 'No saved jobs for this vehicle and date.'}</p> : null}
      <div className="portrait-bottom-grid"><div><h2 className="print-section-title">{lang === 'th' ? 'รวมเวลาแยกตามกิจกรรม' : 'TIME BY ACTIVITY'}</h2>{modeTotals.map(([mode, seconds]) => <div className="mode-total" key={mode}><span>{MODE_META[mode]?.[lang] || mode}</span><div><i style={{ width: `${Math.max(3, totalSeconds ? seconds / totalSeconds * 100 : 0)}%`, background: modeColor(mode) }} /></div><strong>{totalDuration(seconds)}</strong></div>)}</div><div><h2 className="print-section-title">{lang === 'th' ? 'ข้อยกเว้นและหมายเหตุ' : 'EXCEPTIONS & NOTES'}</h2><ul className="exception-list">{summary.cancelled ? <li>{lang === 'th' ? `ยกเลิก ${summary.cancelled} งาน` : `${summary.cancelled} cancelled jobs`}</li> : null}{summary.gpsPending ? <li>{lang === 'th' ? `รอค้นหา GPS ${summary.gpsPending} งาน` : `${summary.gpsPending} jobs waiting for GPS lookup`}</li> : null}{!summary.cancelled && !summary.gpsPending ? <li>{lang === 'th' ? 'ไม่พบข้อยกเว้น' : 'No exceptions recorded'}</li> : null}</ul></div></div>
      <PrintFooter lang={lang} page="1/2" />
    </section>
    <section className="print-sheet portrait-sheet">
      <PrintHeader compact subtitle={`${lang === 'th' ? 'สรุปรายคนขับและรายคัน' : 'Driver and vehicle summary'} · ${longDate(date, lang)}`} />
      <h2 className="print-section-title large-gap">{lang === 'th' ? 'สรุปรายคนขับ (จากการรูดบัตร)' : 'DRIVER SUMMARY (CARD IDENTIFICATION)'}</h2>
      <table className="summary-print-table"><thead><tr><th>{lang === 'th' ? 'พขร.' : 'Driver'}</th><th>{lang === 'th' ? 'รถ' : 'Vehicles'}</th><th>{lang === 'th' ? 'ชม.ทำงาน' : 'Work time'}</th><th>{lang === 'th' ? 'งาน' : 'Jobs'}</th><th>{lang === 'th' ? 'เร็วสูงสุด' : 'Max speed'}</th><th>{lang === 'th' ? 'ข้อยกเว้น' : 'Exceptions'}</th></tr></thead><tbody>{driverSummaries.map(driver => <tr key={driver.name}><td><strong>{driver.name}</strong></td><td>{[...driver.vehicles].join(', ')}</td><td>{totalDuration(driver.seconds)}</td><td>{driver.jobs}</td><td className={driver.topSpeed > 90 ? 'speed-alert' : ''}>{driver.topSpeed >= 0 ? driver.topSpeed : '—'}</td><td>{driver.cancelled}</td></tr>)}</tbody></table>
      <h2 className="print-section-title large-gap">{lang === 'th' ? 'สรุปรายคัน' : 'VEHICLE SUMMARY'}</h2>
      <table className="summary-print-table"><thead><tr><th>{lang === 'th' ? 'รถ' : 'Vehicle'}</th><th>{lang === 'th' ? 'พขร.' : 'Driver'}</th><th>{lang === 'th' ? 'กะ' : 'Shift'}</th><th>{lang === 'th' ? 'งาน' : 'Jobs'}</th><th>{lang === 'th' ? 'พบ GPS' : 'GPS found'}</th><th>{lang === 'th' ? 'ยกเลิก' : 'Cancelled'}</th></tr></thead><tbody>{fleetSummaries.map(row => <tr key={row.vehicle}><td><strong>{row.vehicle}</strong></td><td>{row.driver}</td><td>{row.shift}</td><td>{row.rows.length}</td><td className={row.gpsPending ? 'print-warning' : 'print-success'}>{row.gpsMatched}/{row.rows.length}</td><td>{row.cancelled}</td></tr>)}</tbody></table>
      <PrintFooter lang={lang} page="2/2" />
    </section>
  </main>;
}
