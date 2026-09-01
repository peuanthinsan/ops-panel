'use client';

import Image from 'next/image';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { operationActions } from '../../lib/actions';
import { localizedDashboardReportError } from '../../lib/dashboard-errors';
import { formatReportDuration, reportDateKey } from '../../lib/report-view';
import { printReportLocation } from '../../lib/report-print-view';
import { filterReports, hasRestrictiveReportFilters } from '../../lib/report-filter';
import { reportModeColor } from '../../lib/report-mode-meta';
import { dailyReportIsComplete, paginateDailyReportJobs, DAILY_REPORT_FIRST_PAGE_JOB_LIMIT, DAILY_REPORT_CONTINUATION_JOB_LIMIT } from '../../lib/report-print-pages';
import { timelineReportMatchesFilters } from '../../lib/timeline-filter';
import { TIMELINE_AXIS_LABELS, bangkokMinuteOfDay, timelinePosition } from '../../lib/timeline-position';
import { deriveTimelineAlerts } from '../../lib/timeline-alerts';
import { adminFetch, adminFetchAllReports } from '../dashboard-api';
import { useReportSpeedSeries } from '../report-speed-series';
import SpeedTimelineOverlay from '../speed-timeline';
import { TimelineAlertChips, TimelineAlertMarkers } from '../timeline-alerts';

const MODE_META = Object.fromEntries(operationActions.map(action => [action[2], { number: action[0], th: action[1], en: action[2] }]));

function validDate(value) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : reportDateKey(new Date().toISOString()); }
function dateValue(value) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; }
function time(value, lang) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date) : '—';
}
function axisTime(value) { return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value; }
function longDate(dateKey, lang) {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00+07:00`));
}
function reportDate(dateKey, lang) {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-US', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00+07:00`));
}
function elapsed(start, end) {
  return formatReportDuration(start, end);
}
function elapsedSeconds(report) {
  const parts = formatReportDuration(report.startTime, report.endTime, report.duration).split(':').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? Math.max(0, Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]))
    : 0;
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
function totalDuration(seconds) { return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function portraitTimelinePosition(startValue, endValue, originValue, spanMinutes, fallbackMinutes = 5) {
  const origin = Date.parse(originValue);
  const startTime = Date.parse(startValue);
  const endTime = Date.parse(endValue);
  if (!Number.isFinite(origin) || !Number.isFinite(startTime)) return null;
  const start = Math.max(0, (startTime - origin) / 60_000);
  const end = Number.isFinite(endTime) ? (endTime - origin) / 60_000 : start + fallbackMinutes;
  const boundedStart = Math.min(spanMinutes, start);
  const boundedEnd = Math.max(boundedStart + fallbackMinutes, Math.min(spanMinutes, end));
  if (boundedStart >= spanMinutes) return null;
  return {
    left: (boundedStart / spanMinutes) * 100,
    width: ((Math.min(spanMinutes, boundedEnd) - boundedStart) / spanMinutes) * 100,
  };
}

function periodAxis(startValue, endValue, lang) {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const startDay = reportDateKey(startValue);
  return Array.from({ length: 9 }, (_, index) => {
    const value = new Date(start + ((end - start) * index / 8)).toISOString();
    const dayOffset = calendarDayOffset(startDay, reportDateKey(value));
    return `${time(value, lang)}${dayOffset ? ` +${dayOffset}` : ''}`;
  });
}

function calendarDayOffset(startDay, actualDay) {
  const start = Date.parse(`${startDay}T00:00:00Z`);
  const actual = Date.parse(`${actualDay}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(actual) ? Math.max(0, Math.round((actual - start) / 86_400_000)) : 0;
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

function PrintToolbar({ lang, onPrint, backPath = '/' }) {
  return <div className="print-toolbar" role="toolbar" aria-label={lang === 'th' ? 'คำสั่งพิมพ์' : 'Print controls'}>
    <button type="button" onClick={() => window.location.assign(backPath)}>{lang === 'th' ? 'กลับแดชบอร์ด' : 'Back to dashboard'}</button>
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
    } catch (errorValue) { setError(localizedDashboardReportError(errorValue instanceof Error ? errorValue.message : '', lang, lang === 'th' ? 'ไม่สามารถโหลดรายงานได้' : 'Could not load reports.')); }
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

function MissingVehiclePrintState({ lang }) {
  return <main className="print-state" role="alert"><Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} loading="eager" /><h1>{lang === 'th' ? 'กรุณาเลือกรถ' : 'Vehicle required'}</h1><p>{lang === 'th' ? 'เลือกรถหนึ่งคันในหน้ารายงานก่อนเปิดรายงานประจำวัน' : 'Select exactly one vehicle on the Reports page before opening a daily report.'}</p><button className="primary" type="button" onClick={() => window.location.assign('/')}>{lang === 'th' ? 'กลับไปหน้ารายงาน' : 'Back to Reports'}</button></main>;
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
    dayFinished: rows[0]?.workPeriodComplete ?? dailyReportIsComplete(rows),
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
      return <span aria-hidden="true" key={report.id || `${report.vehicleNumber}-${report.startTime}`} title={modeLabel(report, lang)} style={{ left: `${position.left}%`, width: `${Math.max(.7, position.width)}%`, background: reportModeColor(report.mode), opacity: report.status === 'Cancelled' ? .35 : 1 }} />;
    })}
    <SpeedTimelineOverlay reports={rows} samplesByReportId={speedSeries.samplesByReportId} loading={speedSeries.loading} lang={lang} interactive={false} />
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
        const place = printReportLocation(report, lang);
        const reportSpeed = speed(report);
        const gpsPoints = Number(report.deviceGpsSamples) || 0;
        return <tr className={report.status === 'Cancelled' ? 'cancelled' : ''} key={report.id || `${report.vehicleNumber}-${report.startTime}`}>
          <td><strong>{report.vehicleNumber || '—'}</strong><small>{report.id || '—'}</small></td>
          <td><strong>{report.driverName || '—'}</strong><small>{report.driverId || '—'}</small></td>
          <td>{modeLabel(report, lang)}</td>
          <td>{reportDateKey(report.startTime) || '—'}</td>
          <td>{time(report.startTime, lang)}–{time(report.endTime, lang)}</td>
          <td>{formatReportDuration(report.startTime, report.endTime, report.duration)}</td>
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
    const reportDates = [...new Set(timelineReports.map(report => report.workPeriodDate || reportDateKey(report.workPeriodStartTime || report.startTime)).filter(Boolean))].sort();
    const dates = reportDates.length
      ? reportDates
      : [validDate(stableFilters.endDate || stableFilters.startDate)];
    const restricted = hasRestrictiveReportFilters(stableFilters) || Boolean(timelineOnly && timelineFilters);
    const result = [];
    for (const date of dates) {
      const dayReports = timelineReports.filter(report => (report.workPeriodDate || reportDateKey(report.workPeriodStartTime || report.startTime)) === date);
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
      <div className="landscape-header-row"><PrintHeader compact subtitle={`${lang === 'th' ? 'สรุปรถทุกคันรายวัน' : 'Daily fleet summary'} · ${longDate(page.date, lang)}`} /><div className="print-legend">{operationActions.map(([number, thai, english]) => <span key={number}><i style={{ backgroundColor: reportModeColor(english) }} aria-hidden="true" /><b>{number}</b>{lang === 'th' ? thai : english}</span>)}</div></div>
      <div className="fleet-print-grid fleet-print-heading"><span>{lang === 'th' ? 'เบอร์รถ / พขร. (รูดบัตร)' : 'Vehicle / driver (card)'}</span><div>{TIMELINE_AXIS_LABELS.map(label => <span key={label}>{axisTime(label)}</span>)}</div><span>{lang === 'th' ? 'ชม.กะ' : 'Shift'}</span><span>{lang === 'th' ? 'งาน' : 'Jobs'}</span><span>{lang === 'th' ? 'กม.' : 'km'}</span><span>{lang === 'th' ? 'เร็วสูงสุด' : 'Max'}</span><span>{lang === 'th' ? 'พบ GPS' : 'GPS found'}</span></div>
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

function DailyReportMasthead({ lang, documentId, printedAt, page, totalPages, continued = false }) {
  const pageLabel = totalPages > 1 ? ` · ${lang === 'th' ? 'หน้า' : 'Page'} ${page}/${totalPages}` : '';
  return <header className="report-masthead"><div className="report-brand"><Image src="/songdee-gps-pin.svg" alt="" width={62} height={76} /><div><strong>SONGDEE GPS</strong><span>FLEET &amp; FIELD OPERATIONS</span></div></div><div className="report-heading"><small>DAILY VEHICLE REPORT</small><h1>{lang === 'th' ? (continued ? 'รายการงานประจำวัน (ต่อ)' : 'รายงานการเดินรถประจำวัน') : (continued ? 'Daily Vehicle Report · Jobs Continued' : 'Daily Vehicle Report')}</h1><p>{lang === 'th' ? `เลขที่เอกสาร ${documentId} · พิมพ์เมื่อ ${printedAt}${pageLabel}` : `Document ID ${documentId} · Printed ${printedAt}${pageLabel}`}</p></div></header>;
}

function DailyTripInfo({ lang, vehicle, summary, date }) {
  const endDayOffset = calendarDayOffset(date, reportDateKey(summary.end));
  return <div className="trip-info-row"><div><small>{lang === 'th' ? 'ทะเบียนรถ' : 'Vehicle Plate'}</small><strong>{vehicle || '—'}</strong></div><div><small>{lang === 'th' ? 'คนขับ' : 'Driver'}</small><strong>{summary.driver}</strong></div><div><small>{lang === 'th' ? 'วันที่เริ่มรอบงาน' : 'Work Started'}</small><strong>{reportDate(date, lang)}</strong></div><div><small>{lang === 'th' ? 'เวลาเริ่ม–สิ้นสุด' : 'Work Start–End'}</small><strong>{time(summary.start, lang)} – {time(summary.end, lang)}{endDayOffset ? ` +${endDayOffset}` : ''}</strong></div><div><small>{lang === 'th' ? 'สถานะ' : 'Status'}</small><strong className={`trip-status ${summary.dayFinished ? '' : 'trip-status-open'}`}>{lang === 'th' ? (summary.dayFinished ? 'เสร็จสิ้น' : 'ยังไม่จบงาน') : (summary.dayFinished ? 'Completed' : 'In progress')}</strong></div></div>;
}

function DailyJobTable({ rows, lang }) {
  return <table className="simple-job-table"><caption className="sr-only">{lang === 'th' ? 'รายการงาน' : 'Job list'}</caption><thead><tr><th>{lang === 'th' ? 'เวลา' : 'TIME'}</th><th>{lang === 'th' ? 'ประเภท' : 'TYPE'}</th><th>{lang === 'th' ? 'สถานที่ / รายละเอียด' : 'LOCATION / DETAILS'}</th><th>{lang === 'th' ? 'ระยะเวลา' : 'DURATION'}</th></tr></thead><tbody>{rows.map(report => { const place = printReportLocation(report, lang); const dayOffset = calendarDayOffset(report.workPeriodDate || reportDateKey(rows[0]?.startTime), reportDateKey(report.startTime)); return <tr key={report.id || report.startTime}><td>{time(report.startTime, lang)}–{time(report.endTime, lang)}{dayOffset ? <small className="print-next-day">+{dayOffset} {lang === 'th' ? 'วัน' : dayOffset === 1 ? 'day' : 'days'}</small> : null}</td><td><span className={`job-type ${jobTypeClass(report.mode)}`} style={{ backgroundColor: reportModeColor(report.mode) }}>{modeLabel(report, lang)}</span></td><td>{place.name}</td><td>{formatReportDuration(report.startTime, report.endTime, report.duration)}</td></tr>; })}</tbody></table>;
}

function DailySignatureFooter({ lang }) {
  return <footer className="signature-footer"><div><span />{lang === 'th' ? 'ลายเซ็นคนขับ / Driver' : 'Driver Signature'}</div><div><span />{lang === 'th' ? 'ลายเซ็นหัวหน้างาน / Supervisor' : 'Supervisor Signature'}</div><div><span />{lang === 'th' ? 'วันที่ตรวจสอบ / Reviewed date' : 'Reviewed Date'}</div></footer>;
}

function dailyJobRangeLabel(lang, start, end, total) {
  if (!total) return lang === 'th' ? 'ไม่มีงานในวันนี้' : 'No jobs for this day';
  if (start === 1 && end === total) return lang === 'th' ? `งานทั้งหมด ${total} รายการ` : `All ${total} daily jobs`;
  return lang === 'th' ? `งาน ${start}–${end} จาก ${total}` : `Jobs ${start}–${end} of ${total}`;
}

export function PortraitPrintDashboard({ date: requestedDate, workPeriodId: requestedWorkPeriodId, vehicle: requestedVehicle, lang: requestedLang }) {
  const lang = requestedLang === 'en' ? 'en' : 'th';
  useDocumentLanguage(lang);
  const vehicle = String(requestedVehicle || '').trim();
  const workPeriodId = String(requestedWorkPeriodId || '').trim();
  const fallbackDate = validDate(requestedDate);
  const portraitFilters = useMemo(() => ({ ...(workPeriodId ? { workPeriodId } : { startDate: fallbackDate, endDate: fallbackDate }), ...(vehicle ? { vehicle: [vehicle] } : {}) }), [fallbackDate, vehicle, workPeriodId]);
  const { reports, loading, error, load } = usePrintData(portraitFilters, lang);
  const summary = useMemo(() => summaryForVehicle(vehicle, reports), [vehicle, reports]);
  const date = summary.rows[0]?.workPeriodDate || reportDateKey(summary.start) || fallbackDate;
  const speedSeries = useReportSpeedSeries(summary.rows);
  if (!vehicle) return <MissingVehiclePrintState lang={lang} />;
  if (loading || speedSeries.loading || error) return <PrintState lang={lang} loading={loading || speedSeries.loading} error={error} onRetry={load} />;
  const totalSeconds = summary.rows.reduce((sum, report) => sum + elapsedSeconds(report), 0);
  const shiftSeconds = summary.start && summary.end ? Math.max(0, Math.floor((dateValue(summary.end) - dateValue(summary.start)) / 1000)) : 0;
  const timelineSpanMinutes = Math.max(5, Math.ceil(shiftSeconds / 60));
  const breakSeconds = Math.max(0, shiftSeconds - totalSeconds);
  const timelineOrigin = summary.start || '';
  const alerts = deriveTimelineAlerts(summary.rows, speedSeries.samplesByReportId).map(alert => ({ ...alert, minute: Math.max(0, (Date.parse(alert.capturedAt) - Date.parse(timelineOrigin)) / 60_000) }));
  const printedAt = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  const documentId = `SD-${date.replaceAll('-', '')}-${vehicle}`;
  const timelineRows = summary.rows.map(report => {
    const position = portraitTimelinePosition(report.startTime, report.endTime, timelineOrigin, timelineSpanMinutes);
    return position ? { report, position } : null;
  }).filter(Boolean);
  const jobPages = paginateDailyReportJobs(summary.rows);
  return <main className="print-preview portrait-preview">
    <PrintToolbar lang={lang} onPrint={() => window.print()} />
    <section className="print-sheet portrait-sheet">
      <DailyReportMasthead lang={lang} documentId={documentId} printedAt={printedAt} page={1} totalPages={jobPages.totalPages} />
      <DailyTripInfo lang={lang} vehicle={vehicle} summary={summary} date={date} />
      <div className="report-kpi-grid"><Kpi label={lang === 'th' ? 'ระยะทางรวม' : 'Total Distance'} value={summary.distance == null ? '—' : summary.distance.toFixed(1)} note="km" /><Kpi label={lang === 'th' ? 'งานที่เสร็จ' : 'Jobs Completed'} value={summary.rows.length} note={lang === 'th' ? 'งาน' : 'jobs'} /><Kpi label={lang === 'th' ? 'เวลาทำงานรวม' : 'Total Working Time'} value={totalDuration(totalSeconds)} note={lang === 'th' ? 'ชม.' : 'hrs'} /><Kpi label={lang === 'th' ? 'เวลาพัก / รอ' : 'Break / Wait Time'} value={totalDuration(breakSeconds)} note={lang === 'th' ? 'ชม.' : 'hrs'} /></div>
      <section className="report-section"><div className="report-section-heading"><h2>{lang === 'th' ? 'ไทม์ไลน์การเดินรถ' : 'TRIP TIMELINE'}</h2><strong className={alerts.length ? 'timeline-alert-count' : 'timeline-clear'}><WarningIcon weight="bold" aria-hidden="true" /> {alerts.length} {lang === 'th' ? 'การแจ้งเตือนระหว่างทาง' : alerts.length === 1 ? 'alert during this trip' : 'alerts during this trip'}</strong></div><div className="timeline-legend">{operationActions.map(([number, thai, english]) => <span key={number}><i style={{ backgroundColor: reportModeColor(english) }} /><b>{number}</b>{lang === 'th' ? thai : english}</span>)}<span><i className="speed" />{lang === 'th' ? 'ความเร็ว (กม./ชม.)' : 'Speed (km/h)'}</span><span><i className="alert" />{lang === 'th' ? 'การแจ้งเตือน' : 'Alert'}</span></div><div className="trip-timeline" role="group" aria-label={lang === 'th' ? 'ไทม์ไลน์การเดินรถพร้อมกราฟความเร็วและการแจ้งเตือน' : 'Trip timeline with vehicle speed graph and alerts'}>{timelineRows.map(({ report, position }) => <span key={report.id || report.startTime} className="timeline-segment" style={{ left: `${position.left}%`, width: `${Math.max(.9, position.width)}%`, background: reportModeColor(report.mode), opacity: report.status === 'Cancelled' ? .45 : 1 }} />)}<SpeedTimelineOverlay reports={summary.rows} samplesByReportId={speedSeries.samplesByReportId} loading={speedSeries.loading} lang={lang} startMinute={0} endMinute={timelineSpanMinutes} originTime={timelineOrigin} className="print-speed-overlay" interactive={false} /><TimelineAlertMarkers alerts={alerts} lang={lang} startMinute={0} endMinute={timelineSpanMinutes} interactive={false} /></div><div className="timeline-axis">{periodAxis(summary.start, summary.end, lang).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div><TimelineAlertChips alerts={alerts} lang={lang} limit={3} className="alert-list" /></section>
      <section className="report-section job-section"><div className="report-section-heading"><h2>{lang === 'th' ? 'รายการงาน' : 'JOB LIST'}</h2><span>{dailyJobRangeLabel(lang, 1, jobPages.firstPage.length, summary.rows.length)}</span></div><DailyJobTable rows={jobPages.firstPage} lang={lang} />{!summary.rows.length ? <p className="print-empty">{lang === 'th' ? 'ไม่มีงานที่บันทึกสำหรับรถและวันที่นี้' : 'No saved jobs for this vehicle and date.'}</p> : null}</section>
      {!jobPages.continuationPages.length ? <DailySignatureFooter lang={lang} /> : null}
    </section>
    {jobPages.continuationPages.map((pageRows, pageIndex) => {
      const pageNumber = pageIndex + 2;
      const start = DAILY_REPORT_FIRST_PAGE_JOB_LIMIT + (pageIndex * DAILY_REPORT_CONTINUATION_JOB_LIMIT) + 1;
      const end = start + pageRows.length - 1;
      return <section className="print-sheet portrait-sheet report-continuation-sheet" key={`daily-jobs-${pageNumber}`}>
        <DailyReportMasthead lang={lang} documentId={documentId} printedAt={printedAt} page={pageNumber} totalPages={jobPages.totalPages} continued />
        <DailyTripInfo lang={lang} vehicle={vehicle} summary={summary} date={date} />
        <section className="report-section job-section continuation-job-section"><div className="report-section-heading"><h2>{lang === 'th' ? 'รายการงาน (ต่อ)' : 'JOB LIST — CONTINUED'}</h2><span>{dailyJobRangeLabel(lang, start, end, summary.rows.length)}</span></div><DailyJobTable rows={pageRows} lang={lang} /></section>
        {pageNumber === jobPages.totalPages ? <DailySignatureFooter lang={lang} /> : null}
      </section>;
    })}
  </main>;
}
