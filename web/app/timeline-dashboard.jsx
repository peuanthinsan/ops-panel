'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { reportDateKey } from '../lib/report-view';
import { reportableOperations } from '../lib/actions';
import { paginateReports } from '../lib/report-pagination';
import { localizedDashboardReportError } from '../lib/dashboard-errors';
import { TIMELINE_AXIS_LABELS, timelinePosition } from '../lib/timeline-position';
import { adminFetch, adminFetchAllReports } from './dashboard-api';

const pageSize = 20;
const modeCopy = Object.fromEntries(reportableOperations.map(action => [action[2], { en: action[2], th: action[1] }]));
const text = {
  en: { eyebrow: 'DAILY OPERATIONS', title: 'Per-vehicle timeline', subtitle: 'See real saved jobs in sequence for each vehicle.', date: 'Date', search: 'Search vehicle or driver', printTimeline: 'Print timeline', load: 'Load', unload: 'Unload', stop: 'Stop / wait', other: 'Break / other', gaps: 'Gaps are driving or no recorded job', vehicleDriver: 'Vehicle / driver', loading: 'Loading timeline…', failed: 'Could not load reports.', empty: 'No saved jobs match this date and search.', emptyTitle: 'No timeline activity yet', emptyBody: 'Completed and cancelled tablet jobs will be arranged here by vehicle and time.', manageFleet: 'Manage fleet', showing: 'Showing', of: 'of', page: 'Page', previous: 'Previous', next: 'Next', cancelled: 'Cancelled' },
  th: { eyebrow: 'การปฏิบัติงานรายวัน', title: 'ไทม์ไลน์รายรถ', subtitle: 'ดูงานที่บันทึกจริงตามลำดับเวลาของรถแต่ละคัน', date: 'วันที่', search: 'ค้นหารถหรือคนขับ', printTimeline: 'พิมพ์ไทม์ไลน์', load: 'ขึ้นสินค้า', unload: 'ลงสินค้า', stop: 'หยุด / รอ', other: 'พัก / อื่น ๆ', gaps: 'ช่องว่างคือช่วงขับรถหรือไม่มีงานที่บันทึก', vehicleDriver: 'รถ / คนขับ', loading: 'กำลังโหลดไทม์ไลน์…', failed: 'ไม่สามารถโหลดรายงานได้', empty: 'ไม่พบงานที่บันทึกตรงกับวันที่และคำค้นหา', emptyTitle: 'ยังไม่มีกิจกรรมในไทม์ไลน์', emptyBody: 'งานที่จบและงานที่ยกเลิกจากแท็บเล็ตจะแสดงตามรถและเวลาในหน้านี้', manageFleet: 'จัดการรถ', showing: 'แสดง', of: 'จาก', page: 'หน้า', previous: 'ก่อนหน้า', next: 'ถัดไป', cancelled: 'ยกเลิก' },
};

function modeColor(mode) {
  if (mode === 'Load') return '#E31B23';
  if (mode === 'Unload') return '#7A1424';
  if (mode === 'Stop vehicle') return '#B57A00';
  return '#68727D';
}

function timelineSegment(report, lang, cancelledLabel) {
  const position = timelinePosition(report.startTime, report.endTime);
  if (!position) return null;
  const modeLabel = modeCopy[report.mode]?.[lang] || report.mode || '—';
  const cancelled = report.status === 'Cancelled';
  return {
    id: report.id || `${report.vehicleNumber}-${report.startTime}`,
    title: `${modeLabel}${cancelled ? ` · ${cancelledLabel}` : ''}`,
    style: { left: `${position.left}%`, width: `${Math.max(0.5, position.width)}%`, backgroundColor: modeColor(report.mode), opacity: cancelled ? 0.42 : 1 },
  };
}

export default function TimelineDashboard({ lang }) {
  const t = text[lang];
  const [reports, setReports] = useState([]);
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestInFlight = useRef(false);
  const initializedDate = useRef(false);

  const loadReports = useCallback(async ({ silent = false } = {}) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!silent) setLoading(true);
    setError('');
    try {
      let targetDate = date;
      if (!targetDate) {
        const latest = await adminFetch('/api/reports?page=1&pageSize=1');
        targetDate = reportDateKey(latest.reports?.[0]?.startTime) || reportDateKey(new Date().toISOString());
      }
      const nextReports = await adminFetchAllReports({ startDate: targetDate, endDate: targetDate }, 5000);
      setReports(nextReports);
      if (!initializedDate.current) {
        setDate(targetDate);
        initializedDate.current = true;
      }
    } catch (errorValue) {
      setError(localizedDashboardReportError(errorValue instanceof Error ? errorValue.message : '', lang, t.failed));
    } finally {
      requestInFlight.current = false;
      if (!silent) setLoading(false);
    }
  }, [date, lang, t.failed]);

  useEffect(() => {
    void loadReports();
    const refreshVisible = () => { if (document.visibilityState === 'visible') void loadReports({ silent: true }); };
    const timer = window.setInterval(refreshVisible, 30_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [loadReports]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const grouped = new Map();
    for (const report of reports) {
      if (date && reportDateKey(report.startTime) !== date) continue;
      const searchable = `${report.vehicleNumber || ''} ${report.driverName || ''} ${report.driverId || ''}`.toLowerCase();
      if (query && !searchable.includes(query)) continue;
      const key = `${report.vehicleNumber || '—'}\u0000${report.driverName || '—'}`;
      if (!grouped.has(key)) grouped.set(key, { vehicle: report.vehicleNumber || '—', driver: report.driverName || '—', reports: [] });
      grouped.get(key).reports.push(report);
    }
    return [...grouped.values()].map(row => ({
      ...row,
      segments: row.reports.map(report => timelineSegment(report, lang, t.cancelled)).filter(Boolean),
    })).filter(row => row.segments.length).sort((left, right) => left.vehicle.localeCompare(right.vehicle, undefined, { numeric: true }));
  }, [reports, date, search, lang, t.cancelled]);
  const timelinePage = useMemo(() => paginateReports(rows, page, pageSize), [rows, page]);
  useEffect(() => { setPage(1); }, [date, search]);

  function printTimeline() {
    if (!date) return;
    const params = new URLSearchParams({ view: 'timeline', lang, startDate: date, endDate: date });
    if (search.trim()) params.set('search', search.trim());
    window.location.assign(`/print/landscape?${params}`);
  }

  return (
    <main className="main timeline-workspace" id="main-content" tabIndex={-1}>
      <div className="page-header">
        <div><div className="eyebrow">{t.eyebrow}</div><h1>{t.title}</h1><p>{t.subtitle}</p></div>
        <div className="timeline-header-actions"><label className="date-input"><span>{t.date}</span><input type="date" value={date} onChange={event => { initializedDate.current = true; setDate(event.target.value); }} /></label><button className="primary" type="button" disabled={!date || loading} onClick={printTimeline}>{t.printTimeline}</button></div>
      </div>
      <section className="panel timeline-panel" aria-busy={loading}>
        <div className="timeline-toolbar">
          <label className="timeline-search"><span className="sr-only">{t.search}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t.search} /></label>
          <div className="timeline-legend" aria-label={lang === 'en' ? 'Timeline legend' : 'คำอธิบายสีไทม์ไลน์'}>
            <span><i className="legend-load" />{t.load}</span><span><i className="legend-unload" />{t.unload}</span><span><i className="legend-stop" />{t.stop}</span><span><i className="legend-other" />{t.other}</span><small>{t.gaps}</small>
          </div>
        </div>
        <div className="timeline-scroll" tabIndex={0}>
          <div className="timeline-grid timeline-axis"><span>{t.vehicleDriver}</span><div>{TIMELINE_AXIS_LABELS.map(label => <span key={label}>{label}</span>)}</div></div>
          {timelinePage.items.map(row => <div className="timeline-grid timeline-row" key={`${row.vehicle}-${row.driver}`}><div><strong>{row.vehicle}</strong><small>{row.driver}</small></div><div className="timeline-track">{row.segments.map(segment => <span key={segment.id} className="timeline-segment" style={segment.style} title={segment.title}><span className="sr-only">{segment.title}</span></span>)}</div></div>)}
        </div>
        {loading ? <p className="empty" role="status">{t.loading}</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {!loading && !error && !rows.length ? reports.length ? <div className="empty-state compact-empty-state"><h3>{t.empty}</h3></div> : <div className="empty-state compact-empty-state">
          <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} />
          <h3>{t.emptyTitle}</h3>
          <p>{t.emptyBody}</p>
          <Link className="primary button-link" href="/admin">{t.manageFleet}</Link>
        </div> : null}
        {rows.length ? <div className="table-footer"><span>{t.showing} {timelinePage.start}–{timelinePage.end} {t.of} {rows.length}</span><div className="pager"><button className="small-button secondary" type="button" disabled={timelinePage.page <= 1} onClick={() => setPage(value => value - 1)}>{t.previous}</button><span>{t.page} {timelinePage.page} / {timelinePage.totalPages}</span><button className="small-button secondary" type="button" disabled={timelinePage.page >= timelinePage.totalPages} onClick={() => setPage(value => value + 1)}>{t.next}</button></div></div> : null}
      </section>
    </main>
  );
}
