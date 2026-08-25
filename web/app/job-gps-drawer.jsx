'use client';

import { useEffect, useRef, useState } from 'react';
import { formatReportCoordinate, formatReportDateTime, reportDateKey } from '../lib/report-view';
import { adminFetch } from './dashboard-api';

const copy = {
  en: {
    title: 'GPS detail', close: 'Close', vehicle: 'Vehicle', driver: 'Driver', activity: 'Activity', time: 'Time',
    device: 'GPS points', last: 'Last GPS fix', captured: 'GPS fix time', coordinates: 'Coordinates', speedLabel: 'Speed', heading: 'Heading',
    loading: 'Loading GPS points…', failed: 'Could not load GPS detail.', empty: 'No GPS points are linked to this job yet.',
    previous: 'Previous', next: 'Next', page: 'Page', of: 'of', print: 'Print job', speed: 'km/h', degrees: '°',
  },
  th: {
    title: 'รายละเอียด GPS', close: 'ปิด', vehicle: 'รถ', driver: 'พขร.', activity: 'กิจกรรม', time: 'เวลา',
    device: 'จุด GPS', last: 'พิกัด GPS ล่าสุด', captured: 'เวลาพิกัด GPS', coordinates: 'พิกัด', speedLabel: 'ความเร็ว', heading: 'ทิศทาง',
    loading: 'กำลังโหลดจุด GPS…', failed: 'ไม่สามารถโหลดรายละเอียด GPS', empty: 'ยังไม่มีจุด GPS ที่เชื่อมกับงานนี้',
    previous: 'ก่อนหน้า', next: 'ถัดไป', page: 'หน้า', of: 'จาก', print: 'พิมพ์งาน', speed: 'กม./ชม.', degrees: '°',
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

export default function JobGpsDrawer({ report, lang, onClose }) {
  const t = copy[lang];
  const closeRef = useRef(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      .then(data => { if (active) setDetail(data); })
      .catch(errorValue => { if (active && errorValue?.name !== 'AbortError') setError(t.failed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [page, report.id, t.failed]);

  const summary = detail?.gpsSummary || {};
  const samples = Array.isArray(detail?.samples) ? detail.samples : [];
  const pageInfo = detail?.pageInfo || { page: 1, totalPages: 1 };
  const displayedReport = detail?.report || report;

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
        <section className="gps-detail-section">
          <h2 id="gps-detail-title">{t.title}</h2>
          <dl className="gps-detail-summary">
            <div><dt>{t.device}</dt><dd>{Number(summary.deviceSamples || 0)}</dd></div>
            <div><dt>{t.last}</dt><dd>{summary.lastCapturedAt ? time(summary.lastCapturedAt, lang) : '—'}</dd></div>
          </dl>
        </section>
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
      <footer className="gps-drawer-footer"><button className="primary" type="button" onClick={() => window.location.assign(`/print/portrait?vehicle=${encodeURIComponent(displayedReport.vehicleNumber || '')}&date=${encodeURIComponent(reportDateKey(displayedReport.startTime))}&lang=${lang}`)}>{t.print}</button><small>{summary.lastCapturedAt ? formatReportDateTime(summary.lastCapturedAt, lang) : ''}</small></footer>
    </aside>
  </div>;
}
