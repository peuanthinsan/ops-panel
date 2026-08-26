'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import Image from 'next/image';
import Link from 'next/link';
import { formatReportDate, formatReportDuration, reportDateKey } from '../lib/report-view';
import { reportableOperations } from '../lib/actions';
import { reportMatchesFilters } from '../lib/report-filter';
import { paginateReports } from '../lib/report-pagination';
import { reportModeColor } from '../lib/report-mode-meta';
import { localizedDashboardReportError } from '../lib/dashboard-errors';
import { timelineReportMatchesFilters } from '../lib/timeline-filter';
import { timelinePosition } from '../lib/timeline-position';
import { deriveTimelineAlerts } from '../lib/timeline-alerts';
import { adminFetch, adminFetchAllReports } from './dashboard-api';
import { useReportSpeedSeries } from './report-speed-series';
import SpeedTimelineOverlay from './speed-timeline';
import { TimelineAlertChips, TimelineAlertMarkers } from './timeline-alerts';

const pageSize = 20;
const emptySharedFilters = Object.freeze({});
const timelineModes = reportableOperations.map(action => action[2]);
const modeCopy = Object.fromEntries(reportableOperations.map(action => [action[2], { en: action[2], th: action[1] }]));
const text = {
  en: { eyebrow: 'DAILY OPERATIONS', title: 'Per-vehicle timeline', subtitle: 'See each work period continuously, including jobs after midnight.', date: 'Work started', search: 'Search vehicle or driver', printTimeline: 'Print timeline', filterJobs: 'Filter jobs', jobTypes: 'Job types', selectAll: 'Select all', clearAll: 'Clear', resetFilters: 'Reset filters', noneSelected: 'None', load: 'Load', unload: 'Unload', stop: 'Stop / wait', other: 'Break / other', speed: 'Speed (km/h)', alert: 'Alert', topSpeed: 'Top speed', gaps: 'Gaps are driving or no recorded job', vehicleDriver: 'Vehicle / driver', vehicleDriverDate: 'Vehicle / driver / work period', rowScale: 'Each row uses its own work-period scale', nextDay: '+1 day', loading: 'Loading timeline…', failed: 'Could not load reports.', empty: 'No saved jobs match this work-period range and search.', emptyCompleted: 'No completed jobs match this work-period range and search.', emptyCancelled: 'No cancelled jobs match this work-period range and search.', emptyNoStatus: 'Select at least one status to display timeline jobs.', emptyNoMode: 'Select at least one job type to display timeline jobs.', emptyTitle: 'No timeline activity yet', emptyBody: 'Completed and cancelled tablet jobs will be arranged by vehicle and work period.', manageFleet: 'Manage fleet', showing: 'Showing', of: 'of', page: 'Page', previous: 'Previous', next: 'Next', cancelled: 'Cancelled', completed: 'Completed', activity: 'Activity', status: 'Status', start: 'Start', end: 'End', duration: 'Duration', vehicle: 'Vehicle', driver: 'Driver', device: 'Device', gps: 'GPS points', location: 'Location', reportId: 'Report ID', unknown: 'Not available' },
  th: { eyebrow: 'การปฏิบัติงานรายวัน', title: 'ไทม์ไลน์รายรถ', subtitle: 'ดูแต่ละรอบงานอย่างต่อเนื่อง รวมถึงงานหลังเที่ยงคืน', date: 'วันที่เริ่มรอบงาน', search: 'ค้นหารถหรือคนขับ', printTimeline: 'พิมพ์ไทม์ไลน์', filterJobs: 'กรองงาน', jobTypes: 'ประเภทงาน', selectAll: 'เลือกทั้งหมด', clearAll: 'ล้าง', resetFilters: 'รีเซ็ตตัวกรอง', noneSelected: 'ไม่ได้เลือก', load: 'ขึ้นสินค้า', unload: 'ลงสินค้า', stop: 'หยุด / รอ', other: 'พัก / อื่น ๆ', speed: 'ความเร็ว (กม./ชม.)', alert: 'การแจ้งเตือน', topSpeed: 'ความเร็วสูงสุด', gaps: 'ช่องว่างคือช่วงขับรถหรือไม่มีงานที่บันทึก', vehicleDriver: 'รถ / คนขับ', vehicleDriverDate: 'รถ / คนขับ / รอบงาน', rowScale: 'แต่ละแถวใช้สเกลตามรอบงาน', nextDay: '+1 วัน', loading: 'กำลังโหลดไทม์ไลน์…', failed: 'ไม่สามารถโหลดรายงานได้', empty: 'ไม่พบงานที่บันทึกตรงกับช่วงรอบงานและคำค้นหา', emptyCompleted: 'ไม่พบงานที่เสร็จตรงกับช่วงรอบงานและคำค้นหา', emptyCancelled: 'ไม่พบงานที่ยกเลิกตรงกับช่วงรอบงานและคำค้นหา', emptyNoStatus: 'เลือกอย่างน้อยหนึ่งสถานะเพื่อแสดงงานในไทม์ไลน์', emptyNoMode: 'เลือกอย่างน้อยหนึ่งประเภทงานเพื่อแสดงงานในไทม์ไลน์', emptyTitle: 'ยังไม่มีกิจกรรมในไทม์ไลน์', emptyBody: 'งานที่จบและงานที่ยกเลิกจากแท็บเล็ตจะแสดงตามรถและรอบงาน', manageFleet: 'จัดการรถ', showing: 'แสดง', of: 'จาก', page: 'หน้า', previous: 'ก่อนหน้า', next: 'ถัดไป', cancelled: 'ยกเลิก', completed: 'เสร็จสิ้น', activity: 'กิจกรรม', status: 'สถานะ', start: 'เริ่ม', end: 'จบ', duration: 'ระยะเวลา', vehicle: 'รถ', driver: 'พขร.', device: 'อุปกรณ์', gps: 'จุด GPS', location: 'ตำแหน่ง', reportId: 'รหัสรายงาน', unknown: 'ไม่มีข้อมูล' },
};
const workPeriodStartedCopy = { en: 'Work period · started', th: 'รอบงาน · เริ่ม' };
const printWorkReportCopy = { en: 'Print work report', th: 'พิมพ์รายงานรอบงาน' };
const printPeriodGuidanceCopy = { en: 'Each timeline row is one work period. Print the row you need.', th: 'แต่ละแถวในไทม์ไลน์คือหนึ่งรอบงาน ให้พิมพ์แถวที่ต้องการ' };

function calendarDayOffset(startDay, actualDay) {
  const start = Date.parse(`${startDay}T00:00:00Z`);
  const actual = Date.parse(`${actualDay}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(actual) ? Math.max(0, Math.round((actual - start) / 86_400_000)) : 0;
}

function formatTimelineDateTime(value, lang) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(date);
}

function formatTimelineTime(value, lang) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(date);
}

function timelineLocation(report, fallback) {
  if (report.locationName || report.location || report.address) return report.locationName || report.location || report.address;
  const latitude = Number(report.lastDeviceLatitude ?? report.latitude);
  const longitude = Number(report.lastDeviceLongitude ?? report.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : fallback;
}

function timelineSpeed(report, lang, fallback) {
  const value = Number(report.topSpeed ?? report.maxSpeed ?? report.maximumSpeed);
  if (!Number.isFinite(value)) return fallback;
  return `${Number(value.toFixed(1)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${lang === 'th' ? 'กม./ชม.' : 'km/h'}`;
}

function timelineSegment(report, lang, labels, scaleStart, scaleEnd) {
  const start = Date.parse(report.startTime);
  const end = Date.parse(report.endTime);
  const duration = Math.max(60_000, scaleEnd - scaleStart);
  const position = Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(scaleStart) && Number.isFinite(scaleEnd)
    ? { left: ((start - scaleStart) / duration) * 100, width: (Math.max(60_000, end - start) / duration) * 100 }
    : timelinePosition(report.startTime, report.endTime);
  if (!position) return null;
  const modeLabel = modeCopy[report.mode]?.[lang] || report.mode || '—';
  const cancelled = report.status === 'Cancelled';
  const finishWork = report.mode === 'Finish work';
  const detail = {
    activity: modeLabel,
    status: cancelled ? labels.cancelled : labels.completed,
    start: formatTimelineDateTime(report.startTime, lang),
    end: formatTimelineDateTime(report.endTime, lang),
    duration: formatReportDuration(report.startTime, report.endTime, report.duration),
    vehicle: report.vehicleNumber || labels.unknown,
    driver: report.driverName || labels.unknown,
    device: report.deviceId || labels.unknown,
    gps: String(Number(report.deviceGpsSamples) || 0),
    speed: timelineSpeed(report, lang, labels.unknown),
    location: timelineLocation(report, labels.unknown),
    reportId: report.id || labels.unknown,
  };
  return {
    id: report.id || `${report.vehicleNumber}-${report.startTime}`,
    tooltipId: `timeline-tooltip-${String(report.id || `${report.vehicleNumber}-${report.startTime}`).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    title: `${modeLabel}${cancelled ? ` · ${labels.cancelled}` : ''}`,
    finishWork,
    detail,
    accessibleLabel: `${labels.activity}: ${detail.activity}. ${labels.status}: ${detail.status}. ${labels.start}: ${detail.start}. ${labels.end}: ${detail.end}. ${labels.duration}: ${detail.duration}. ${labels.topSpeed}: ${detail.speed}. ${labels.vehicle}: ${detail.vehicle}. ${labels.driver}: ${detail.driver}. ${labels.device}: ${detail.device}. ${labels.gps}: ${detail.gps}. ${labels.location}: ${detail.location}. ${labels.reportId}: ${detail.reportId}.`,
    style: { left: `${position.left}%`, width: `${Math.max(0.01, position.width)}%`, backgroundColor: reportModeColor(report.mode), opacity: cancelled ? 0.42 : 1 },
  };
}

export default function TimelineDashboard({ lang, embedded = false, sourceReports = null, sourceLoading = false, sourceError = '', sharedFilters = null, onPrintWorkPeriod = null, printPeriodGuidance = false }) {
  const t = text[lang];
  const [reports, setReports] = useState([]);
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedModes, setSelectedModes] = useState(() => new Set(timelineModes));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tooltip, setTooltip] = useState(null);
  const timelineRequestSequence = useRef(0);
  const initializedDate = useRef(false);
  const usesSourceReports = Array.isArray(sourceReports);
  const sharedQuery = embedded ? sharedFilters || emptySharedFilters : emptySharedFilters;
  const effectiveStartDate = embedded ? String(sharedQuery.startDate || '') : date;
  const effectiveEndDate = embedded ? String(sharedQuery.endDate || '') : date;
  const showRowDate = !effectiveStartDate || effectiveStartDate !== effectiveEndDate;
  const timelineReports = usesSourceReports ? sourceReports : reports;
  const timelineLoading = usesSourceReports ? sourceLoading : loading;
  const timelineError = usesSourceReports ? sourceError : error;

  const loadReports = useCallback(async ({ silent = false } = {}) => {
    if (usesSourceReports) return;
    const requestId = ++timelineRequestSequence.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      let targetStartDate = effectiveStartDate;
      let targetEndDate = effectiveEndDate;
      if (!embedded && !targetStartDate) {
        const latest = await adminFetch('/api/reports?page=1&pageSize=1');
        targetStartDate = latest.reports?.[0]?.workPeriodDate || reportDateKey(latest.reports?.[0]?.workPeriodStartTime || latest.reports?.[0]?.startTime) || reportDateKey(new Date().toISOString());
        targetEndDate = targetStartDate;
      }
      const requestFilters = embedded ? sharedQuery : { startDate: targetStartDate, endDate: targetEndDate };
      const nextReports = await adminFetchAllReports(requestFilters);
      if (requestId !== timelineRequestSequence.current) return;
      setReports(nextReports);
      if (!initializedDate.current && !embedded) {
        setDate(targetStartDate);
        initializedDate.current = true;
      }
    } catch (errorValue) {
      if (requestId !== timelineRequestSequence.current) return;
      setError(localizedDashboardReportError(errorValue instanceof Error ? errorValue.message : '', lang, t.failed));
    } finally {
      if (requestId === timelineRequestSequence.current && !silent) setLoading(false);
    }
  }, [effectiveEndDate, effectiveStartDate, embedded, lang, sharedQuery, t.failed, usesSourceReports]);

  useEffect(() => {
    if (usesSourceReports) return undefined;
    void loadReports();
    const refreshVisible = () => { if (document.visibilityState === 'visible') void loadReports({ silent: true }); };
    const timer = window.setInterval(refreshVisible, 30_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [loadReports, usesSourceReports]);

  useEffect(() => {
    if (!usesSourceReports || embedded) return;
    const availableDates = [...new Set(sourceReports.map(report => report.workPeriodDate || reportDateKey(report.workPeriodStartTime || report.startTime)).filter(Boolean))].sort().reverse();
    if (!availableDates.length || availableDates.includes(date)) return;
    initializedDate.current = true;
    setDate(availableDates[0]);
  }, [date, embedded, sourceReports, usesSourceReports]);

  const rows = useMemo(() => {
    const query = embedded ? '' : search.trim().toLowerCase();
    const grouped = new Map();
    const activeFilters = { showCompleted, showCancelled, selectedModes };
    for (let reportIndex = 0; reportIndex < timelineReports.length; reportIndex += 1) {
      const report = timelineReports[reportIndex];
      const day = report.workPeriodDate || reportDateKey(report.workPeriodStartTime || report.startTime);
      const actualDay = reportDateKey(report.startTime);
      if (effectiveStartDate && day < effectiveStartDate) continue;
      if (effectiveEndDate && day > effectiveEndDate) continue;
      if (embedded ? !reportMatchesFilters(report, sharedQuery, lang) : !timelineReportMatchesFilters(report, activeFilters)) continue;
      const searchable = `${report.vehicleNumber || ''} ${report.driverName || ''} ${report.driverId || ''}`.toLowerCase();
      if (query && !searchable.includes(query)) continue;
      const key = `${report.workPeriodId || day}\u0000${actualDay}\u0000${report.vehicleNumber || '—'}`;
      if (!grouped.has(key)) grouped.set(key, { date: day, actualDate: actualDay, dayOffset: calendarDayOffset(day, actualDay), periodStart: Date.parse(report.workPeriodStartTime || report.startTime) || 0, vehicle: report.vehicleNumber || '—', driver: report.driverName || '—', order: reportIndex, reports: [] });
      grouped.get(key).reports.push(report);
    }
    return [...grouped.values()].map(row => {
      const reportTimes = row.reports.flatMap(report => [Date.parse(report.startTime), Date.parse(report.endTime)]).filter(Number.isFinite);
      const scaleStart = reportTimes.length ? Math.min(...reportTimes) : row.periodStart;
      const scaleEnd = reportTimes.length ? Math.max(...reportTimes, scaleStart + 60_000) : scaleStart + 60_000;
      const segments = row.reports.map(report => timelineSegment(report, lang, t, scaleStart, scaleEnd)).filter(Boolean);
      const laneEnds = [];
      segments.forEach(segment => {
        const start = Number.parseFloat(segment.style.left) || 0;
        const width = Math.max(0.01, Number.parseFloat(segment.style.width) || 0);
        let lane = laneEnds.findIndex(end => start >= end);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = start + width;
        // Keep the job markers on one compact timeline row. Overlapping jobs
        // still remain individually focusable/clickable in the same track.
        segment.lane = 0;
      });
      return { ...row, laneCount: 1, scaleStart, scaleEnd, scaleDuration: Math.max(1, (scaleEnd - scaleStart) / 60_000), segments };
    }).filter(row => row.segments.length).sort((left, right) => right.periodStart - left.periodStart || left.actualDate.localeCompare(right.actualDate) || left.order - right.order);
  }, [timelineReports, effectiveStartDate, effectiveEndDate, embedded, search, sharedQuery, showCompleted, showCancelled, selectedModes, lang, t]);
  const timelinePage = useMemo(() => paginateReports(rows, page, pageSize), [rows, page]);
  const speedReports = useMemo(() => timelinePage.items.flatMap(row => row.reports), [timelinePage.items]);
  const speedSeries = useReportSpeedSeries(speedReports);
  const alertsByRow = useMemo(() => new Map(timelinePage.items.map(row => [row, speedSeries.loading ? [] : deriveTimelineAlerts(row.reports, speedSeries.samplesByReportId)])), [timelinePage.items, speedSeries.loading, speedSeries.samplesByReportId]);
  const statusSummary = [showCompleted ? t.completed : '', showCancelled ? t.cancelled : ''].filter(Boolean).join(' + ') || t.noneSelected;
  const emptyFilterMessage = !showCompleted && !showCancelled
    ? t.emptyNoStatus
    : selectedModes.size === 0
      ? t.emptyNoMode
      : showCancelled && !showCompleted
        ? t.emptyCancelled
        : showCompleted && !showCancelled
          ? t.emptyCompleted
          : t.empty;
  useEffect(() => { setPage(1); setTooltip(null); }, [effectiveStartDate, effectiveEndDate, embedded, search, sharedQuery, showCompleted, showCancelled, selectedModes]);
  useEffect(() => {
    if (!tooltip) return undefined;
    const close = event => { if (event.type !== 'keydown' || event.key === 'Escape') setTooltip(null); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', close);
    };
  }, [tooltip]);

  function openTooltip(event, segment, pinned) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left + (rect.width / 2) - (width / 2)), window.innerWidth - width - 12);
    const above = rect.top > 270;
    setTooltip({ segment, pinned, width, left, top: above ? rect.top - 10 : rect.bottom + 10, above });
  }

  function printTimeline() {
    const printStartDate = effectiveStartDate || effectiveEndDate;
    const printEndDate = effectiveEndDate || effectiveStartDate;
    if (!printStartDate) return;
    const params = new URLSearchParams({ view: 'timeline', lang, startDate: printStartDate, endDate: printEndDate });
    if (search.trim()) params.set('search', search.trim());
    params.set('timelineFilter', '1');
    params.set('timelineShowCompleted', showCompleted ? '1' : '0');
    params.set('timelineShowCancelled', showCancelled ? '1' : '0');
    for (const mode of selectedModes) params.append('timelineMode', mode);
    if (showCompleted !== showCancelled) params.set('status', showCompleted ? 'Completed' : 'Cancelled');
    if (selectedModes.size === 1) params.set('mode', [...selectedModes][0]);
    window.location.assign(`/print/landscape?${params}`);
  }

  function toggleMode(mode) {
    setSelectedModes(current => {
      const next = new Set(current);
      if (next.has(mode)) next.delete(mode); else next.add(mode);
      return next;
    });
  }

  function resetFilters() {
    setShowCompleted(true);
    setShowCancelled(false);
    setSelectedModes(new Set(timelineModes));
  }

  const TimelineWorkspace = embedded ? 'section' : 'main';
  const TimelineHeading = embedded ? 'h2' : 'h1';

  return (
    <TimelineWorkspace className={embedded ? 'timeline-embedded-workspace' : 'main timeline-workspace'} id={embedded ? undefined : 'main-content'} tabIndex={embedded ? undefined : -1} aria-label={embedded ? t.title : undefined}>
      <div className={embedded ? 'section-heading timeline-embedded-heading' : 'page-header'}>
        <div>{embedded ? null : <div className="eyebrow">{t.eyebrow}</div>}<TimelineHeading>{t.title}</TimelineHeading><p>{t.subtitle}</p></div>
        {embedded ? null : <div className="timeline-header-actions"><label className="date-input"><span>{t.date}</span><input type="date" value={date} onChange={event => { initializedDate.current = true; setDate(event.target.value); }} /></label><button className="primary" type="button" disabled={!date || timelineLoading} onClick={printTimeline}>{t.printTimeline}</button></div>}
      </div>
      <section className="panel timeline-panel" aria-busy={timelineLoading}>
        <div className={`timeline-toolbar ${embedded ? 'timeline-toolbar-shared' : ''}`}>
          {embedded ? null : <div className="timeline-controls">
            <label className="timeline-search"><span className="sr-only">{t.search}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t.search} /></label>
            <details className="timeline-filter-menu" onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
              <summary aria-controls="timeline-filter-options"><span>{t.filterJobs}</span><small>{selectedModes.size}/{timelineModes.length} · {statusSummary}</small></summary>
              <div className="timeline-filter-popover" id="timeline-filter-options">
                <fieldset><legend>{t.status}</legend><div className="timeline-filter-status-grid">
                  <label className={`timeline-checkbox-chip completed-chip ${showCompleted ? 'selected' : ''}`}><input type="checkbox" checked={showCompleted} onChange={() => setShowCompleted(current => !current)} /><span>{t.completed}</span></label>
                  <label className={`timeline-checkbox-chip cancelled-chip ${showCancelled ? 'selected' : ''}`}><input type="checkbox" checked={showCancelled} onChange={() => setShowCancelled(current => !current)} /><span>{t.cancelled}</span></label>
                </div></fieldset>
                <fieldset><legend>{t.jobTypes}</legend><div className="timeline-filter-mode-grid">{reportableOperations.map(action => {
                  const mode = action[2];
                  const checked = selectedModes.has(mode);
                  return <label className={`timeline-checkbox-chip ${checked ? 'selected' : ''}`} key={mode}><input type="checkbox" checked={checked} onChange={() => toggleMode(mode)} /><span>{modeCopy[mode]?.[lang] || mode}</span></label>;
                })}</div></fieldset>
                <div className="timeline-filter-actions"><button className="small-button secondary" type="button" onClick={() => setSelectedModes(new Set(timelineModes))}>{t.selectAll}</button><button className="small-button secondary" type="button" onClick={() => setSelectedModes(new Set())}>{t.clearAll}</button><button className="small-button secondary timeline-filter-reset" type="button" onClick={resetFilters}>{t.resetFilters}</button></div>
              </div>
            </details>
          </div>}
          <div className="timeline-legend" role="group" aria-label={lang === 'en' ? 'Timeline legend' : 'คำอธิบายสีไทม์ไลน์'}>
            {reportableOperations.map(([number, thai, english]) => <span key={number}><i style={{ backgroundColor: reportModeColor(english) }} aria-hidden="true" /><b className="timeline-mode-number">{number}</b>{lang === 'th' ? thai : english}</span>)}<span><i className="legend-speed" aria-hidden="true" />{t.speed}</span><span><CaretDownIcon className="legend-alert-icon" weight="fill" aria-hidden="true" />{t.alert}</span><small>{t.gaps}</small>
          </div>
        </div>
        {printPeriodGuidance ? <div className="timeline-period-guidance" role="note"><strong>{lang === 'en' ? 'Choose a timeline row below' : 'เลือกแถวไทม์ไลน์ด้านล่าง'}</strong><span>{printPeriodGuidanceCopy[lang]}</span></div> : null}
        <div className={`timeline-scroll ${printPeriodGuidance ? 'print-period-guidance-active' : ''}`} id="timeline-results" tabIndex={0} aria-label={lang === 'en' ? 'Scrollable vehicle activity timeline' : 'ไทม์ไลน์กิจกรรมรถ เลื่อนได้'}>
          <div className="timeline-grid timeline-axis"><span>{showRowDate ? t.vehicleDriverDate : t.vehicleDriver}</span><div className="timeline-axis-scale-note">{t.rowScale}</div></div>
          {timelinePage.items.map(row => { const rowAlerts = alertsByRow.get(row) || []; return <div className={`timeline-grid timeline-row ${rowAlerts.length ? 'timeline-row-has-alerts' : ''}`} key={`${row.date}-${row.actualDate}-${row.vehicle}`} role="group" aria-label={`${t.vehicle}: ${row.vehicle}. ${t.driver}: ${row.driver}. ${t.date}: ${formatReportDate(row.date, lang)}${row.dayOffset ? `, ${t.nextDay}` : ''}. ${rowAlerts.length} ${t.alert}.`}><div><strong>{row.vehicle}</strong><small>{row.driver}</small><small className="timeline-row-period">{workPeriodStartedCopy[lang]} {formatTimelineTime(row.periodStart, lang)}</small>{showRowDate || row.dayOffset ? <small className="timeline-row-date">{formatReportDate(row.actualDate, lang)}{row.dayOffset ? ` · +${row.dayOffset} ${lang === 'th' ? 'วัน' : row.dayOffset === 1 ? 'day' : 'days'}` : ''}</small> : null}{onPrintWorkPeriod ? <button className="timeline-print-button" type="button" onClick={() => onPrintWorkPeriod(row.reports[0])} disabled={!row.reports[0]?.vehicleNumber || !row.reports[0]?.workPeriodId}>{printWorkReportCopy[lang]}</button> : null}</div><div className="timeline-row-chart"><div className="timeline-row-scale" aria-hidden="true"><span>{formatTimelineTime(row.scaleStart, lang)}</span><span>{formatTimelineTime(row.scaleEnd, lang)}</span></div><div className="timeline-track timeline-speed-track" style={{ '--timeline-lane-count': row.laneCount }}>{row.segments.map(segment => <button
            key={segment.id}
            type="button"
            className={`timeline-segment timeline-lane-${segment.lane || 0} ${segment.finishWork ? 'finish-work-marker' : ''}`}
            style={{ ...segment.style, '--timeline-lane': segment.lane }}
            aria-label={segment.accessibleLabel}
            aria-describedby={tooltip?.segment.id === segment.id ? segment.tooltipId : undefined}
            aria-expanded={tooltip?.segment.id === segment.id && tooltip.pinned}
            onMouseEnter={event => openTooltip(event, segment, false)}
            onMouseLeave={() => setTooltip(current => current?.segment.id === segment.id && !current.pinned ? null : current)}
            onFocus={event => openTooltip(event, segment, false)}
            onBlur={() => setTooltip(current => current?.segment.id === segment.id ? null : current)}
            onClick={event => tooltip?.segment.id === segment.id && tooltip.pinned ? setTooltip(null) : openTooltip(event, segment, true)}
          ><span className="sr-only">{segment.title}</span>{segment.finishWork ? <span className={`timeline-finish-marker ${segment.detail.status === t.cancelled ? 'cancelled' : ''}`} aria-hidden="true" /> : null}</button>)}<SpeedTimelineOverlay reports={row.reports} samplesByReportId={speedSeries.samplesByReportId} loading={speedSeries.loading} lang={lang} originTime={new Date(row.scaleStart).toISOString()} startMinute={0} endMinute={row.scaleDuration} /><TimelineAlertMarkers alerts={rowAlerts} lang={lang} /></div><TimelineAlertChips alerts={rowAlerts} lang={lang} /></div></div>; })}
        </div>
        {tooltip ? <aside className="timeline-detail-tooltip" id={tooltip.segment.tooltipId} role="tooltip" style={{ left: tooltip.left, top: tooltip.top, width: tooltip.width, transform: tooltip.above ? 'translateY(-100%)' : undefined }}>
          <div className="timeline-tooltip-heading"><strong>{tooltip.segment.detail.activity}</strong><span className={`status-badge status-${tooltip.segment.detail.status === t.cancelled ? 'cancelled' : 'completed'}`}>{tooltip.segment.detail.status}</span></div>
          <dl>
            <div><dt>{t.start}</dt><dd>{tooltip.segment.detail.start}</dd></div><div><dt>{t.end}</dt><dd>{tooltip.segment.detail.end}</dd></div>
            <div><dt>{t.duration}</dt><dd>{tooltip.segment.detail.duration}</dd></div><div><dt>{t.topSpeed}</dt><dd>{tooltip.segment.detail.speed}</dd></div>
            <div><dt>{t.vehicle}</dt><dd>{tooltip.segment.detail.vehicle}</dd></div>
            <div><dt>{t.driver}</dt><dd>{tooltip.segment.detail.driver}</dd></div><div><dt>{t.device}</dt><dd>{tooltip.segment.detail.device}</dd></div>
            <div><dt>{t.gps}</dt><dd>{tooltip.segment.detail.gps}</dd></div><div><dt>{t.location}</dt><dd>{tooltip.segment.detail.location}</dd></div>
            <div className="tooltip-report-id"><dt>{t.reportId}</dt><dd>{tooltip.segment.detail.reportId}</dd></div>
          </dl>
        </aside> : null}
        {timelineLoading ? <p className="empty" role="status">{t.loading}</p> : null}
        {timelineError ? <p className="error" role="alert">{timelineError}</p> : null}
        {!timelineLoading && !timelineError && !rows.length ? timelineReports.length || embedded ? <div className="empty-state compact-empty-state"><h3>{embedded ? t.empty : emptyFilterMessage}</h3></div> : <div className="empty-state compact-empty-state">
          <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} />
          <h3>{t.emptyTitle}</h3>
          <p>{t.emptyBody}</p>
          <Link className="primary button-link" href="/admin">{t.manageFleet}</Link>
        </div> : null}
        {rows.length ? <div className="table-footer"><span aria-live="polite">{t.showing} {timelinePage.start}–{timelinePage.end} {t.of} {rows.length}</span><div className="pager"><button className="small-button secondary" type="button" disabled={timelinePage.page <= 1} onClick={() => setPage(value => value - 1)}>{t.previous}</button><span>{t.page} {timelinePage.page} / {timelinePage.totalPages}</span><button className="small-button secondary" type="button" disabled={timelinePage.page >= timelinePage.totalPages} onClick={() => setPage(value => value + 1)}>{t.next}</button></div></div> : null}
      </section>
    </TimelineWorkspace>
  );
}
