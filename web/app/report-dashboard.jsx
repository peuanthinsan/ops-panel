'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  formatReportCoordinate,
  formatReportDate,
  formatReportDateTime,
  formatReportDuration,
  displayGpsLookupMessage,
  reportDateKey,
} from '../lib/report-view';
import { reportableOperations } from '../lib/actions';
import { localizedDashboardReportError } from '../lib/dashboard-errors';
import { adminFetch } from './dashboard-api';
import SearchableCombobox from './searchable-combobox';
import JobGpsDrawer from './job-gps-drawer';
import TimelineDashboard from './timeline-dashboard';

const reportPageSize = 100;
const modes = reportableOperations.map(action => action[2]);
const modeCopy = Object.fromEntries(reportableOperations.map(action => [action[2], [action[2], action[1]]]));
const statusCopy = {
  Completed: ['Completed', 'เสร็จสิ้น'],
  Cancelled: ['Cancelled', 'ยกเลิก'],
};
const gpsCopy = {
  'Pending GPS lookup': ['Pending GPS lookup', 'กำลังรอค้นหา GPS'],
  'GPS paired': ['GPS found', 'พบข้อมูล GPS'],
  'GPS partially paired': ['GPS found', 'พบข้อมูล GPS'],
  'GPS matched': ['GPS found', 'พบข้อมูล GPS'],
  'No GPS point': ['No GPS point', 'ไม่มีพิกัด GPS'],
  'GPS lookup failed': ['GPS lookup failed', 'ค้นหา GPS ไม่สำเร็จ'],
  'GPS unavailable': ['GPS unavailable', 'GPS ไม่พร้อมใช้งาน'],
  pending: ['Pending lookup', 'รอค้นหา'],
  paired: ['GPS found', 'พบข้อมูล GPS'],
  partial: ['GPS found', 'พบข้อมูล GPS'],
  device_only: ['GPS found', 'พบข้อมูล GPS'],
  no_data: ['No GPS data', 'ไม่มีข้อมูล GPS'],
  lookup_failed: ['Lookup failed', 'ค้นหาไม่สำเร็จ'],
  lookup_unavailable: ['Lookup unavailable', 'ค้นหาไม่ได้'],
  not_applicable: ['Not applicable', 'ไม่เกี่ยวข้อง'],
};
const gpsUiText = {
  en: {
    subtitle: 'Review saved jobs, their timeline, and time-matched GPS records.', gpsMatched: 'GPS found', gpsMatchedSub: 'jobs with a GPS point', needsAttention: 'Needs attention', needsAttentionSub: 'jobs with no GPS point', gpsFound: 'GPS found', noData: 'No GPS data', viewGps: 'View GPS', gpsCoverage: 'GPS', lastPosition: 'Last position', samples: 'points',
  },
  th: {
    subtitle: 'ตรวจสอบงานที่บันทึก ไทม์ไลน์ และข้อมูล GPS ที่ตรงตามเวลา', gpsMatched: 'พบข้อมูล GPS', gpsMatchedSub: 'งานที่พบพิกัด GPS', needsAttention: 'ต้องตรวจสอบ', needsAttentionSub: 'งานที่ไม่พบพิกัด GPS', gpsFound: 'พบข้อมูล GPS', noData: 'ไม่มีข้อมูล GPS', viewGps: 'ดู GPS', gpsCoverage: 'GPS', lastPosition: 'ตำแหน่งล่าสุด', samples: 'จุด',
  },
};
const text = {
  en: {
    eyebrowToday: 'TODAY', title: 'Operations reports', subtitle: 'Review, filter, print, and retry every saved vehicle job.', filtersTitle: 'Shared report filters', sharedFiltersHint: 'The header vehicle selector, search, filters, and column sorting apply to both the timeline and Job List.', search: 'Search reports', searchPlaceholder: 'Vehicle, device, driver, activity, report ID, GPS, speed, or location', dateRange: 'Date range', allDates: 'All dates', today: 'Today', last7: 'Last 7 days', month: 'This month', apply: 'Apply', cancel: 'Cancel', previousMonth: 'Previous month', nextMonth: 'Next month', report: 'Report ID', vehicle: 'Vehicle', allVehicles: 'All vehicles', device: 'Device', allDevices: 'All devices', driver: 'Driver', allDrivers: 'All drivers', mode: 'Activity', allModes: 'All activities', status: 'Status', allStatuses: 'All statuses', gps: 'GPS', allGps: 'All GPS states', sortHint: 'Click a column header to sort. Shift-click to sort by up to three columns.', clear: 'Clear', refresh: 'Refresh', refreshing: 'Refreshing…', print: 'Print daily report', printVehicle: 'Print vehicle report', printVehicleRequired: 'Select exactly one vehicle in the header.', printVehicleSelected: 'Daily report vehicle', jobs: 'Total jobs', jobsSub: 'in the selected range', active: 'Vehicles operating', activeSub: 'vehicles with saved work', queued: 'GPS lookup pending', queuedSub: 'waiting for GPS data', cancelled: 'Cancelled jobs', cancelledSub: 'kept in the audit record', activity: 'Job list', date: 'Date', start: 'Start time', end: 'End time', duration: 'Total time', durationFormat: 'HH:MM:SS', topSpeed: 'Top speed', location: 'Location (GPS)', noJobs: 'No jobs match the current filters.', emptyTitle: 'No jobs recorded yet', emptyBody: 'Connect a tablet to a vehicle, then complete or cancel a job. It will appear here automatically.', noMatchTitle: 'No matching jobs', noMatchBody: 'Try a different date range, search, or filter.', manageFleet: 'Manage fleet', failed: 'Could not load reports.', loading: 'Loading reports…', retry: 'Retry GPS lookup', retrying: 'Looking up…', actions: 'Actions', deviceSamples: 'GPS', lastPoint: 'Last point', previous: 'Previous', next: 'Next', page: 'Page', of: 'of', showing: 'Showing', total: 'total', fleet: 'fleet', unknownLocation: 'No GPS point', stationary: 'Stationary', speedUnit: 'km/h',
  },
  th: {
    eyebrowToday: 'วันนี้', title: 'รายงานการวิ่งงาน', subtitle: 'ตรวจสอบ กรอง พิมพ์ และค้นหาข้อมูล GPS ของงานรถที่บันทึก', filtersTitle: 'ตัวกรองรายงานร่วม', sharedFiltersHint: 'ตัวเลือกรถในส่วนหัว การค้นหา ตัวกรอง และการเรียงตามคอลัมน์ใช้กับทั้งไทม์ไลน์และรายการงาน', search: 'ค้นหารายงาน', searchPlaceholder: 'รถ อุปกรณ์ พขร. กิจกรรม รหัสรายงาน GPS ความเร็ว หรือสถานที่', dateRange: 'ช่วงวันที่', allDates: 'ทุกวัน', today: 'วันนี้', last7: '7 วันที่ผ่านมา', month: 'เดือนนี้', apply: 'ใช้ช่วงวันที่', cancel: 'ยกเลิก', previousMonth: 'เดือนก่อนหน้า', nextMonth: 'เดือนถัดไป', report: 'รหัสรายงาน', vehicle: 'เบอร์รถ', allVehicles: 'รถทั้งหมด', device: 'อุปกรณ์', allDevices: 'อุปกรณ์ทั้งหมด', driver: 'พขร.', allDrivers: 'พขร. ทั้งหมด', mode: 'กิจกรรม', allModes: 'กิจกรรมทั้งหมด', status: 'สถานะ', allStatuses: 'สถานะทั้งหมด', gps: 'GPS', allGps: 'สถานะ GPS ทั้งหมด', sortHint: 'คลิกหัวคอลัมน์เพื่อเรียง หรือกด Shift พร้อมคลิกเพื่อเรียงได้สูงสุด 3 คอลัมน์', clear: 'ล้างตัวกรอง', refresh: 'รีเฟรช', refreshing: 'กำลังรีเฟรช…', print: 'พิมพ์รายงานประจำวัน', printVehicle: 'พิมพ์รายงานรถ', printVehicleRequired: 'เลือกรถหนึ่งคันเท่านั้นในส่วนหัว', printVehicleSelected: 'รถสำหรับรายงานประจำวัน', jobs: 'งานทั้งหมด', jobsSub: 'ในช่วงวันที่ที่เลือก', active: 'รถที่วิ่งงาน', activeSub: 'รถที่มีงานบันทึก', queued: 'รอค้นหา GPS', queuedSub: 'กำลังรอข้อมูล GPS', cancelled: 'งานที่ยกเลิก', cancelledSub: 'เก็บไว้ในประวัติการตรวจสอบ', activity: 'รายการงาน', date: 'วันที่', start: 'เวลาเริ่ม', end: 'เวลาจบ', duration: 'รวมเวลา', durationFormat: 'ชม:นาที:วินาที', topSpeed: 'ความเร็วสูงสุด', location: 'สถานที่ (GPS)', noJobs: 'ไม่พบงานตามตัวกรองนี้', emptyTitle: 'ยังไม่มีงานที่บันทึก', emptyBody: 'เชื่อมต่อแท็บเล็ตกับรถ แล้วจบหรือยกเลิกงาน รายการจะปรากฏที่นี่โดยอัตโนมัติ', noMatchTitle: 'ไม่พบงานที่ตรงกัน', noMatchBody: 'ลองเปลี่ยนช่วงวันที่ คำค้นหา หรือตัวกรอง', manageFleet: 'จัดการรถ', failed: 'ไม่สามารถโหลดรายงานได้', loading: 'กำลังโหลดรายงาน…', retry: 'ค้นหา GPS อีกครั้ง', retrying: 'กำลังค้นหา…', actions: 'การดำเนินการ', deviceSamples: 'GPS', lastPoint: 'จุดล่าสุด', previous: 'ก่อนหน้า', next: 'ถัดไป', page: 'หน้า', of: 'จาก', showing: 'แสดง', total: 'ทั้งหมด', fleet: 'คันทั้งหมด', unknownLocation: 'ไม่มีพิกัด GPS', stationary: 'จอดนิ่ง', speedUnit: 'กม./ชม.',
  },
};

function translated(value, translations, lang) { return translations[value]?.[lang === 'en' ? 0 : 1] || value || '—'; }
function displayMode(mode, lang) { return translated(mode, modeCopy, lang); }
function displayStatus(status, lang) { return translated(status, statusCopy, lang); }
function displayGps(value, lang) { return translated(String(value || '').toLowerCase().includes('matched') ? 'GPS matched' : value, gpsCopy, lang); }
function gpsValue(report) { return report.gpsLookupStatus || report.gps || ''; }
function canRetry(report) { return report.status !== 'Cancelled' && (!report.driverName || !Number(report.deviceGpsSamples) || ['pending', 'no_data', 'lookup_failed', 'lookup_unavailable'].includes(report.gpsLookupStatus)); }
function isLookupPending(report) { return report.gpsLookupStatus === 'pending'; }
function statusSlug(value) { return String(value || '').toLowerCase().replaceAll(' ', '-').replaceAll('_', '-'); }
function reportSpeed(report) {
  const raw = report.topSpeed ?? report.maxSpeed ?? report.maximumSpeed;
  const speed = Number(raw);
  return Number.isFinite(speed) ? speed : null;
}
function reportCoordinates(report) {
  const latitude = formatReportCoordinate(report.lastDeviceLatitude ?? report.latitude);
  const longitude = formatReportCoordinate(report.lastDeviceLongitude ?? report.longitude);
  return latitude && longitude ? `${latitude}, ${longitude}` : '';
}
function reportLocation(report, fallback) { return report.locationName || report.location || report.address || reportCoordinates(report) || fallback; }
function formatTime(value, lang) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}
function offsetDate(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return reportDateKey(date.toISOString());
}
function rangeLabel(startDate, endDate, t, lang) {
  if (!startDate && !endDate) return t.allDates;
  if (startDate === endDate) return formatReportDate(startDate, lang);
  return `${startDate ? formatReportDate(startDate, lang) : '…'} – ${endDate ? formatReportDate(endDate, lang) : '…'}`;
}
function monthKey(dateKey) { return String(dateKey || '').slice(0, 7); }
function shiftMonth(value, amount) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function calendarDays(value) {
  const [year, month] = value.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? `${value}-${String(day).padStart(2, '0')}` : '';
  });
}
function accessibleDayLabel(day, lang) {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

function DateRangePicker({ lang, t, startDate, endDate, onChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const today = reportDateKey(new Date().toISOString());
  const [cursorMonth, setCursorMonth] = useState(monthKey(startDate || today));
  const weekdays = lang === 'th' ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const monthLabel = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${cursorMonth}-01T12:00:00Z`));

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      setDraftStart(startDate);
      setDraftEnd(endDate);
      setCursorMonth(monthKey(startDate || endDate || today));
      const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector('button:not([disabled])')?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, startDate, endDate, today]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled])') || [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) { wasOpenRef.current = true; return undefined; }
    if (!wasOpenRef.current) return undefined;
    wasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const target = previousFocusRef.current instanceof HTMLElement ? previousFocusRef.current : triggerRef.current;
      target?.focus();
      previousFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function preset(start, end) {
    setDraftStart(start);
    setDraftEnd(end);
    onChange(start, end);
    setOpen(false);
  }
  function chooseDay(day) {
    if (!draftStart || draftEnd || day < draftStart) {
      setDraftStart(day);
      setDraftEnd('');
      return;
    }
    setDraftEnd(day);
  }

  return <div className="date-range-control">
    <button ref={triggerRef} className="date-range-button" type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><span>{t.dateRange}</span><strong>{rangeLabel(startDate, endDate, t, lang)}</strong></button>
    {open ? <>
      <button className="picker-scrim" type="button" aria-label={lang === 'en' ? 'Close date picker' : 'ปิดตัวเลือกวันที่'} onClick={() => setOpen(false)} />
      <section ref={dialogRef} className="date-popover" role="dialog" aria-modal="true" aria-labelledby="date-range-title">
        <div className="preset-row"><button type="button" onClick={() => preset(today, today)}>{t.today}</button><button type="button" onClick={() => preset(offsetDate(today, -6), today)}>{t.last7}</button><button type="button" onClick={() => preset(`${today.slice(0, 7)}-01`, today)}>{t.month}</button><button type="button" onClick={() => preset('', '')}>{t.allDates}</button></div>
        <div className="calendar-heading"><button type="button" aria-label={t.previousMonth} onClick={() => setCursorMonth(value => shiftMonth(value, -1))}>‹</button><strong id="date-range-title">{monthLabel}</strong><button type="button" aria-label={t.nextMonth} onClick={() => setCursorMonth(value => shiftMonth(value, 1))}>›</button></div>
        <div className="calendar-grid" role="group" aria-label={monthLabel}>
          {weekdays.map((day, index) => <span className="calendar-weekday" key={`${day}-${index}`} aria-hidden="true">{day}</span>)}
          {calendarDays(cursorMonth).map((day, index) => day ? <button className={`${day === today ? 'today' : ''} ${day === draftStart || day === draftEnd ? 'selected' : ''} ${draftStart && draftEnd && day > draftStart && day < draftEnd ? 'in-range' : ''}`} key={day} type="button" aria-current={day === today ? 'date' : undefined} aria-label={accessibleDayLabel(day, lang)} aria-pressed={day === draftStart || day === draftEnd} onClick={() => chooseDay(day)}>{Number(day.slice(-2))}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}
        </div>
        <div className="date-popover-footer"><span aria-live="polite">{rangeLabel(draftStart, draftEnd, t, lang)}</span><div className="date-popover-actions"><button className="secondary small-button" type="button" onClick={() => setOpen(false)}>{t.cancel}</button><button className="primary small-button" type="button" onClick={() => { onChange(draftStart, draftEnd || draftStart); setOpen(false); }}>{t.apply}</button></div></div>
      </section>
    </> : null}
  </div>;
}

function gpsDetails(report, t, lang) {
  const deviceSamples = Number(report.deviceGpsSamples) || 0;
  return <small className="gps-sync">{deviceSamples} {t.deviceSamples}{report.lastGpsCapturedAt ? ` · ${formatReportDateTime(report.lastGpsCapturedAt, lang)}` : ''}</small>;
}

function reportCoverage(report) {
  const device = Number(report.deviceGpsSamples) || 0;
  return { state: device ? 'matched' : 'none', device };
}

function coverageLabel(report, g) {
  const coverage = reportCoverage(report);
  return coverage.state === 'matched' ? g.gpsFound : g.noData;
}

export default function FullReportDashboard({ lang }) {
  const t = text[lang];
  const g = gpsUiText[lang];
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState({ total: 0, activeVehicles: 0, fleetSize: 0, gpsMatched: 0, gpsNeedsAttention: 0 });
  const [pageInfo, setPageInfo] = useState({ page: 1, pageSize: reportPageSize, total: 0, totalPages: 1, start: 0, end: 0 });
  const [options, setOptions] = useState({ vehicles: [], devices: [], drivers: [], statuses: [], gpsStates: [] });
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(() => reportDateKey(new Date().toISOString()));
  const [endDate, setEndDate] = useState(() => reportDateKey(new Date().toISOString()));
  const [vehicles, setVehicles] = useState([]);
  const [devices, setDevices] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [gpsStates, setGpsStates] = useState([]);
  const [sorts, setSorts] = useState([{ key: 'startTime', direction: 'desc' }]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState('');
  const [error, setError] = useState('');
  const [retryNotice, setRetryNotice] = useState('');
  const [page, setPage] = useState(1);
  const [selectedReport, setSelectedReport] = useState(null);
  const reportRequestSequence = useRef(0);
  const facetsLoaded = useRef(false);
  const deferredSearch = useDeferredValue(search);
  const sortKey = sorts[0]?.key || 'startTime';
  const sortDirection = sorts[0]?.direction || 'desc';
  const sharedFilters = useMemo(() => ({
    search: deferredSearch,
    startDate,
    endDate,
    vehicle: vehicles,
    device: devices,
    driver: drivers,
    mode: activities,
    status: statuses,
    gps: gpsStates,
    sort: sorts.map(sort => `${sort.key}:${sort.direction}`).join(','),
  }), [activities, deferredSearch, devices, drivers, endDate, gpsStates, sorts, startDate, statuses, vehicles]);

  const loadReports = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++reportRequestSequence.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(reportPageSize) });
      for (const [key, value] of Object.entries(sharedFilters)) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) if (String(item || '').trim()) params.append(key, String(item).trim());
      }
      const [data, facetData] = await Promise.all([
        adminFetch(`/api/reports?${params}`),
        facetsLoaded.current ? Promise.resolve(null) : adminFetch('/api/admin/reports/facets'),
      ]);
      if (requestId !== reportRequestSequence.current) return;
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setSummary(current => ({ ...current, ...(data.summary || {}) }));
      setPageInfo(current => ({ ...current, ...(data.pageInfo || {}) }));
      if (facetData?.facets) {
        setOptions(facetData.facets);
        facetsLoaded.current = true;
      }
    } catch (errorValue) {
      if (requestId !== reportRequestSequence.current) return;
      setError(localizedDashboardReportError(errorValue instanceof Error ? errorValue.message : '', lang, t.failed));
    } finally {
      if (requestId === reportRequestSequence.current && !silent) setLoading(false);
    }
  }, [sharedFilters, page, lang, t.failed]);

  async function retryReport(reportId) {
    if (retryingId) return;
    setRetryingId(reportId);
    setError('');
    setRetryNotice('');
    try {
      const data = await adminFetch('/api/admin/reports/retry', { method: 'POST', body: JSON.stringify({ reportId }) });
      setReports(items => items.map(item => item.id === reportId ? { ...item, ...data.report } : item));
      const source = data.gpsReconciliation?.deviceSource;
      setRetryNotice(displayGpsLookupMessage(source?.message, lang) || (lang === 'en' ? 'GPS lookup completed.' : 'ค้นหาข้อมูล GPS แล้ว'));
      await loadReports({ silent: true });
    } catch (errorValue) {
      setError(localizedDashboardReportError(errorValue instanceof Error ? errorValue.message : '', lang, t.failed));
    } finally { setRetryingId(''); }
  }

  useEffect(() => {
    void loadReports();
    const refreshVisibleReports = () => { if (document.visibilityState === 'visible') void loadReports({ silent: true }); };
    const timer = window.setInterval(refreshVisibleReports, 30_000);
    document.addEventListener('visibilitychange', refreshVisibleReports);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisibleReports); };
  }, [loadReports]);
  useEffect(() => { setPage(1); }, [sharedFilters]);
  const visibleReports = reports;
  const renderedReports = reports;

  function changeSort(nextKey, event) {
    const defaultDirection = nextKey === 'startTime' ? 'desc' : 'asc';
    setSorts(current => {
      if (!event?.shiftKey) {
        const primary = current[0];
        return [{ key: nextKey, direction: primary?.key === nextKey ? (primary.direction === 'asc' ? 'desc' : 'asc') : defaultDirection }];
      }
      const index = current.findIndex(sort => sort.key === nextKey);
      if (index >= 0) return current.map((sort, sortIndex) => sortIndex === index ? { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : sort);
      return [...current, { key: nextKey, direction: defaultDirection }].slice(0, 3);
    });
  }
  function clearFilters() {
    setSearch(''); setVehicles([]); setDevices([]); setDrivers([]); setActivities([]); setStatuses([]); setGpsStates([]); setSorts([{ key: 'startTime', direction: 'desc' }]);
  }
  function printReports() {
    if (!selectedPrintDate || vehicles.length !== 1) return;
    const params = new URLSearchParams({ date: selectedPrintDate, lang });
    params.set('vehicle', vehicles[0]);
    window.location.assign(`/print/portrait?${params}`);
  }
  function printVehicle(report) {
    const vehicle = String(report.vehicleNumber || '').trim();
    const date = reportDateKey(report.startTime);
    if (!vehicle || !date) return;
    const params = new URLSearchParams({ vehicle, date, lang });
    window.location.assign(`/print/portrait?${params}`);
  }

  const hasFilters = Boolean(search || vehicles.length || devices.length || drivers.length || activities.length || statuses.length || gpsStates.length || sorts.length > 1 || sortKey !== 'startTime' || sortDirection !== 'desc');
  const activeVehicles = Number(summary.activeVehicles || 0);
  const gpsMatchedJobs = Number(summary.gpsMatched || 0);
  const gpsNeedsAttention = Number(summary.gpsNeedsAttention || 0);
  const totalReports = Number(summary.total || 0);
  const fleetSize = Number(summary.fleetSize || 0);
  const hasAnyReportData = Object.values(options).some(values => Array.isArray(values) && values.length > 0);
  const selectedPrintDate = endDate || startDate || reportDateKey(reports[0]?.startTime) || reportDateKey(new Date().toISOString());
  const canPrintDailyReport = Boolean(selectedPrintDate && vehicles.length === 1 && (totalReports || hasAnyReportData));
  const dailyPrintVehicleMessage = vehicles.length === 1 ? `${t.printVehicleSelected}: ${vehicles[0]}` : t.printVehicleRequired;
  const columns = [
    ['vehicleNumber', t.vehicle], ['driverName', t.driver], ['mode', t.mode], ['startTime', t.date], ['startClock', t.start], ['endTime', t.end], ['duration', t.duration], ['topSpeed', t.topSpeed], ['gpsCoverage', g.gpsCoverage], ['gpsState', g.lastPosition], ['status', t.status],
  ];

  return (
    <main className="main report-workspace" id="main-content" tabIndex={-1}>
      <div className="page-header report-header">
        <div><div className="eyebrow">{t.eyebrowToday} · {formatReportDate(reportDateKey(new Date().toISOString()), lang)}</div><h1>{t.title}</h1><p>{g.subtitle}</p></div>
        <div className="header-actions">
          <div className="header-vehicle-selector">
            <SearchableCombobox multiple label={t.vehicle} value={vehicles} onChange={setVehicles} options={options.vehicles} allLabel={t.allVehicles} lang={lang} />
          </div>
          <DateRangePicker lang={lang} t={t} startDate={startDate} endDate={endDate} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />
          <button className="secondary" type="button" onClick={() => void loadReports()} disabled={loading}>{loading ? t.refreshing : t.refresh}</button>
          <div className="daily-print-action"><button className="primary" type="button" onClick={printReports} disabled={!canPrintDailyReport} aria-describedby="daily-print-vehicle-message">{t.print}</button><small id="daily-print-vehicle-message" className={`daily-print-selection ${vehicles.length === 1 ? 'selected' : 'required'}`} aria-live="polite">{dailyPrintVehicleMessage}</small></div>
        </div>
      </div>

      <div className="stats report-stats" aria-live="polite">
        <div><span>{t.jobs}</span><strong>{totalReports}</strong><small>{t.jobsSub}</small></div>
        <div><span>{t.active}</span><strong>{activeVehicles}<em>/{Math.max(fleetSize, activeVehicles)}</em></strong><small className="positive">{t.activeSub}</small></div>
        <div><span>{g.gpsMatched}</span><strong className="positive-text">{gpsMatchedJobs}</strong><small className="positive">{g.gpsMatchedSub}</small></div>
        <div><span>{g.needsAttention}</span><strong className="danger-text">{gpsNeedsAttention}</strong><small>{g.needsAttentionSub}</small></div>
      </div>

      <section className="panel shared-report-filters" aria-label={lang === 'en' ? 'Shared timeline and Job List filters' : 'ตัวกรองร่วมของไทม์ไลน์และรายการงาน'}>
        <div className="section-heading shared-filter-heading"><div><h2>{t.filtersTitle}</h2><p>{t.sharedFiltersHint}</p></div><button className="secondary" type="button" onClick={clearFilters} disabled={!hasFilters}>{t.clear}</button></div>
        <label className="search-field"><span className="sr-only">{t.search}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t.searchPlaceholder} /></label>
        <div className="filter-grid shared-filter-grid">
          <SearchableCombobox multiple label={t.device} value={devices} onChange={setDevices} options={options.devices} allLabel={t.allDevices} lang={lang} />
          <SearchableCombobox multiple label={t.driver} value={drivers} onChange={setDrivers} options={options.drivers} allLabel={t.allDrivers} lang={lang} />
          <SearchableCombobox multiple label={t.mode} value={activities} onChange={setActivities} options={modes} allLabel={t.allModes} lang={lang} getOptionLabel={value => displayMode(value, lang)} />
          <SearchableCombobox multiple label={t.status} value={statuses} onChange={setStatuses} options={options.statuses} allLabel={t.allStatuses} lang={lang} getOptionLabel={value => displayStatus(value, lang)} />
          <SearchableCombobox multiple label={t.gps} value={gpsStates} onChange={setGpsStates} options={options.gpsStates} allLabel={t.allGps} lang={lang} getOptionLabel={value => displayGps(value, lang)} />
        </div>
      </section>

      <TimelineDashboard lang={lang} embedded sharedFilters={sharedFilters} />

      <section className="panel report-panel" aria-busy={loading || search !== deferredSearch}>
        <div className="section-heading report-section-heading"><div><h2>{t.activity}</h2><p className="sort-hint">{t.sortHint}</p></div><span className="result-count" aria-live="polite">{t.showing} {pageInfo.start}–{pageInfo.end} {t.of} {pageInfo.total}</span></div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {retryNotice ? <div className="inline-message success" role="status">{retryNotice}</div> : null}
        {loading && !reports.length ? <p className="loading-message" role="status">{t.loading}</p> : null}
        {visibleReports.length ? <div className="table-wrap" tabIndex={0} aria-label={lang === 'en' ? 'Scrollable saved jobs table' : 'ตารางงานที่บันทึก เลื่อนได้'}>
          <table className="reports-table">
            <caption className="sr-only">{t.activity}</caption>
            <colgroup><col className="col-vehicle" /><col className="col-driver" /><col className="col-mode" /><col className="col-date" /><col className="col-time" /><col className="col-time" /><col className="col-duration" /><col className="col-speed" /><col className="col-coverage" /><col className="col-location" /><col className="col-status" /><col className="col-actions" /></colgroup>
            <thead><tr>{columns.map(([key, label]) => {
              const sortIndex = sorts.findIndex(sort => sort.key === key);
              const columnSort = sortIndex >= 0 ? sorts[sortIndex] : null;
              return <th key={key} scope="col" aria-sort={sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button className={`table-sort ${key === 'duration' ? 'table-sort-duration' : ''}`} type="button" title={t.sortHint} onClick={event => changeSort(key, event)}><span>{label}{columnSort ? ` ${columnSort.direction === 'asc' ? '↑' : '↓'}${sorts.length > 1 ? sortIndex + 1 : ''}` : ''}</span>{key === 'duration' ? <small>{t.durationFormat}</small> : null}</button></th>;
            })}<th scope="col">{t.actions}</th></tr></thead>
            <tbody>{renderedReports.map(report => <tr key={report.id} className={`${report.status === 'Cancelled' ? 'row-cancelled' : isLookupPending(report) ? 'row-queued' : ''} ${selectedReport?.id === report.id ? 'row-selected' : ''}`}>
              <td><strong>{report.vehicleNumber || '—'}</strong><small className="secondary-line">{report.deviceId || report.id || '—'}</small></td>
              <td>{report.driverName || '—'}{report.driverId ? <small className="secondary-line">{report.driverId}</small> : null}</td>
              <td>{displayMode(report.mode, lang)}</td>
              <td>{report.startTime ? formatReportDate(reportDateKey(report.startTime), lang) : '—'}</td>
              <td className="report-time-cell">{formatTime(report.startTime, lang)}</td>
              <td className="report-time-cell">{formatTime(report.endTime, lang)}</td>
              <td className="report-duration-cell">{formatReportDuration(report.startTime, report.endTime, report.duration)}</td>
              <td className={reportSpeed(report) > 90 ? 'speed-alert' : undefined}>{reportSpeed(report) == null ? '—' : reportSpeed(report) === 0 ? t.stationary : `${reportSpeed(report)} ${t.speedUnit}`}</td>
              <td className="gps-coverage-cell"><button type="button" className={`coverage-state coverage-${reportCoverage(report).state}`} aria-label={`${coverageLabel(report, g)}: ${report.id}`} onClick={() => setSelectedReport(report)}>{coverageLabel(report, g)}</button><small>{Number(report.deviceGpsSamples) || 0} {g.samples}</small></td>
              <td className="location-cell"><span>{reportLocation(report, t.unknownLocation)}</span><small>{reportCoordinates(report) || displayGps(gpsValue(report), lang)}</small></td>
              <td><span className={`status status-${statusSlug(report.status)}`}>{displayStatus(report.status, lang)}</span></td>
              <td><div className="report-actions">{canRetry(report) ? <button className="retry-button" type="button" aria-label={`${t.retry}: ${report.id}`} disabled={Boolean(retryingId)} onClick={() => retryReport(report.id)}>{retryingId === report.id ? t.retrying : t.retry}</button> : null}<button className="view-gps-button" type="button" aria-label={`${g.viewGps}: ${report.id}`} onClick={() => setSelectedReport(report)}>{g.viewGps}</button><button className="print-row-button" type="button" aria-label={`${t.printVehicle}: ${report.vehicleNumber}`} disabled={!report.vehicleNumber || !reportDateKey(report.startTime)} onClick={() => printVehicle(report)}>{t.printVehicle}</button></div></td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {visibleReports.length ? <div className="report-cards" role="list" aria-label={lang === 'en' ? 'Saved jobs' : 'งานที่บันทึก'}>
          {renderedReports.map(report => <article className={`report-card ${report.status === 'Cancelled' ? 'row-cancelled' : isLookupPending(report) ? 'row-queued' : ''} ${selectedReport?.id === report.id ? 'row-selected' : ''}`} key={report.id} role="listitem" aria-label={`${t.report} ${report.id}`}>
            <div className="report-card-heading"><div><h3>{report.vehicleNumber || '—'}</h3><small>{report.id}</small></div><span className={`status status-${statusSlug(report.status)}`}>{displayStatus(report.status, lang)}</span></div>
            <dl><div><dt>{t.driver}</dt><dd>{report.driverName || '—'}{report.driverId ? <small className="secondary-line">{report.driverId}</small> : null}</dd></div><div><dt>{t.device}</dt><dd className="device-id">{report.deviceId || '—'}</dd></div><div><dt>{t.mode}</dt><dd>{displayMode(report.mode, lang)}</dd></div><div><dt>{t.date}</dt><dd>{report.startTime ? formatReportDate(reportDateKey(report.startTime), lang) : '—'}</dd></div><div><dt>{t.start} – {t.end}</dt><dd className="report-time-cell">{formatTime(report.startTime, lang)} – {formatTime(report.endTime, lang)}</dd></div><div><dt>{t.duration} <span className="duration-format-inline">({t.durationFormat})</span></dt><dd className="report-duration-cell">{formatReportDuration(report.startTime, report.endTime, report.duration)}</dd></div><div><dt>{t.topSpeed}</dt><dd className={reportSpeed(report) > 90 ? 'speed-alert' : undefined}>{reportSpeed(report) == null ? '—' : reportSpeed(report) === 0 ? t.stationary : `${reportSpeed(report)} ${t.speedUnit}`}</dd></div><div><dt>{g.gpsCoverage}</dt><dd><button type="button" className={`coverage-state coverage-${reportCoverage(report).state}`} aria-label={`${coverageLabel(report, g)}: ${report.id}`} onClick={() => setSelectedReport(report)}>{coverageLabel(report, g)}</button></dd></div><div className="card-location"><dt>{g.lastPosition}</dt><dd>{reportLocation(report, t.unknownLocation)}{gpsDetails(report, t, lang)}</dd></div></dl>
            <div className="card-actions">{canRetry(report) ? <button className="retry-button" type="button" aria-label={`${t.retry}: ${report.id}`} disabled={Boolean(retryingId)} onClick={() => retryReport(report.id)}>{retryingId === report.id ? t.retrying : t.retry}</button> : null}<button className="view-gps-button" type="button" aria-label={`${g.viewGps}: ${report.id}`} onClick={() => setSelectedReport(report)}>{g.viewGps}</button><button className="print-row-button" type="button" aria-label={`${t.printVehicle}: ${report.vehicleNumber}`} disabled={!report.vehicleNumber || !reportDateKey(report.startTime)} onClick={() => printVehicle(report)}>{t.printVehicle}</button></div>
          </article>)}
        </div> : null}
        {pageInfo.totalPages > 1 ? <nav className="pagination" aria-label={lang === 'en' ? 'Saved jobs pages' : 'หน้ารายการงาน'}><button className="secondary" type="button" disabled={pageInfo.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t.previous}</button><span>{t.page} {pageInfo.page} {t.of} {pageInfo.totalPages}</span><button className="secondary" type="button" disabled={pageInfo.page >= pageInfo.totalPages} onClick={() => setPage(value => Math.min(pageInfo.totalPages, value + 1))}>{t.next}</button></nav> : null}
        {!visibleReports.length && !loading && !error ? <div className="empty-state">
          <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} />
          <h3>{hasAnyReportData ? t.noMatchTitle : t.emptyTitle}</h3>
          <p>{hasAnyReportData ? t.noMatchBody : t.emptyBody}</p>
          <div className="empty-state-actions">
            {hasAnyReportData ? <button className="secondary" type="button" onClick={clearFilters}>{t.clear}</button> : <Link className="primary button-link" href="/admin">{t.manageFleet}</Link>}
            <button className="secondary" type="button" onClick={() => void loadReports()}>{t.refresh}</button>
          </div>
        </div> : null}
      </section>
      {selectedReport ? <JobGpsDrawer report={selectedReport} lang={lang} onClose={() => setSelectedReport(null)} /> : null}
    </main>
  );
}
