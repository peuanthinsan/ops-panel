import { operationActions } from '../../lib/actions';
import { printReportLocation } from '../../lib/report-print-view';
import { reportDateKey } from '../../lib/report-view';
import { mergeReportSpeedSeries, normalizeSpeedSamples } from '../../lib/speed-timeline';

const MODE_LABELS = Object.fromEntries(operationActions.map(action => [action[2], { th: action[1], en: action[2] }]));
const STATUS_MODES = { drive: [], load: ['Load'], unload: ['Unload'], wait: [], break: ['Break'], sleep: ['Park overnight'], refuel: ['Refuel'], park: ['Stop vehicle'] };
const STATUS_ORDER = ['drive', 'load', 'unload', 'wait', 'break', 'sleep', 'refuel', 'park'];
const LABELS = {
  en: {
    title: 'Vehicle Operation Report', code: 'Code', layoutCode: 'Layout code', vehicle: 'Vehicle plate', driver: 'Driver name', driverCode: 'Driver code',
    start: 'Start', end: 'End', printed: 'Printed on', page: 'Page', startOdometer: 'Start odometer', endOdometer: 'End odometer', distance1: 'Distance 1', distance2: 'Distance 2',
    loadUnload: 'Load/Unload', parkWait: 'Park/Wait', total: 'Total', number: 'No.', timeRange: 'Time range', status: 'Status', description: 'Description',
    vehicleL: 'Vehicle (L)', vehicleD: 'Vehicle (D)', other: 'Other', cash: 'Cash', etc: 'ETC', card: 'Card', coupon: 'Coupon', parkExpense: 'Park', travel: 'Travel', repair: 'Repair',
    notes: 'Notes', loadStatus: 'Load status', speed: 'Speed (km/h)', rpm: 'RPM', noSpeed: 'No speed data', timeline: 'Activity timeline', nextDay: 'next day', day: 'day',
    drive: 'Drive', load: 'Load', unload: 'Unload', wait: 'Wait', break: 'Break', sleep: 'Sleep', refuel: 'Refuel', park: 'Park', breakSleep: 'Break / Sleep', totalPark: 'Total park',
    totalDistance: 'Total distance', maxSpeed: 'Max speed', count: 'Count (?)', km: 'km', cancelled: 'Cancelled', noJobs: 'No jobs started in this time window', manual: 'Manual entry',
    engine: 'Engine', tire: 'Tire', brake: 'Brakes', inspection: 'Vehicle inspection checklist',
    engineItems: ['Engine oil', 'Fan belt', 'Cooling water', 'Battery fluid', 'Lighting system', 'Washer fluid', 'Air tank', 'Wiper', 'Prev-day problem'],
    tireItems: ['Tire wear', 'Tread depth', 'Air pressure', 'Wheel mounting', 'Cracking'], brakeItems: ['Parking lever', 'Exhaust sound', 'Brake sound'], otherItems: ['Fluid amount', 'White stamping'],
  },
  th: {
    title: 'รายงานการขับขี่ปฏิบัติงาน', code: 'รหัส (Code)', layoutCode: 'รหัสแบบรายงาน', vehicle: 'ทะเบียนรถ', driver: 'ชื่อผู้ขับ', driverCode: 'รหัสพขร.',
    start: 'เริ่มปฏิบัติงาน', end: 'สิ้นสุดปฏิบัติงาน', printed: 'วันที่พิมพ์', page: 'หน้าที่', startOdometer: 'เลขไมล์เริ่ม', endOdometer: 'เลขไมล์สิ้นสุด', distance1: 'ระยะทาง 1', distance2: 'ระยะทาง 2',
    loadUnload: 'โหลด/อันโหลด', parkWait: 'จอด/รอ', total: 'รวมทั้งหมด', number: 'ลำดับ', timeRange: 'ช่วงเวลา', status: 'สถานะ', description: 'รายละเอียด',
    vehicleL: 'ยานพาหนะ (L)', vehicleD: 'ยานพาหนะ (D)', other: 'อื่นๆ', cash: 'เงินสด', etc: 'ETC', card: 'บัตร', coupon: 'คูปอง', parkExpense: 'ค่าจอด', travel: 'ค่าเดินทาง', repair: 'ค่าซ่อม',
    notes: 'หมายเหตุ', loadStatus: 'สถานะโหลด', speed: 'ความเร็ว (กม./ชม.)', rpm: 'รอบเครื่องยนต์', noSpeed: 'ไม่มีข้อมูลความเร็ว', timeline: 'ไทม์ไลน์กิจกรรม', nextDay: 'วันถัดไป', day: 'วัน',
    drive: 'ขับขี่', load: 'โหลด', unload: 'อันโหลด', wait: 'รอ', break: 'พัก', sleep: 'นอน', refuel: 'เติมน้ำมัน', park: 'จอด', breakSleep: 'พัก / นอน', totalPark: 'จอดรวม',
    totalDistance: 'ระยะทางรวม', maxSpeed: 'ความเร็วสูงสุด', count: 'จำนวนครั้ง (?)', km: 'กม.', cancelled: 'ยกเลิก', noJobs: 'ไม่มีงานเริ่มต้นในช่วงเวลานี้', manual: 'ช่องกรอกด้วยมือ',
    engine: 'เครื่องยนต์', tire: 'ยาง', brake: 'เบรก', inspection: 'รายการตรวจสภาพรถ',
    engineItems: ['น้ำมันเครื่อง', 'สายพานพัดลม', 'น้ำหล่อเย็น', 'น้ำกรดแบตเตอรี่', 'ระบบไฟส่องสว่าง', 'น้ำฉีดกระจก', 'ถังลม', 'ใบปัดน้ำฝน', 'ปัญหาจากวันก่อน'],
    tireItems: ['ความสึกของยาง', 'ความลึกดอกยาง', 'ลมยาง', 'การยึดล้อ', 'รอยแตกร้าว'], brakeItems: ['คันเบรกมือ', 'เสียงท่อไอเสีย', 'เสียงเบรก'], otherItems: ['ปริมาณของเหลว', 'ตราปั๊มขาว'],
  },
};

function timestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function clock(value, seconds = false) {
  const parsed = timestamp(value);
  if (parsed == null) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(new Date(parsed));
}

function dateTime(value, seconds = false) {
  return timestamp(value) == null ? '—' : `${reportDateKey(value).replaceAll('-', '/')} ${clock(value, seconds)}`;
}

function duration(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const seconds = Math.max(0, Math.floor(Number(value)));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function sumDurations(...values) {
  return values.some(value => value == null) ? null : values.reduce((total, value) => total + value, 0);
}

function number(value, digits = 1) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
}

function dayOffset(value, origin) {
  const actualDate = reportDateKey(value);
  const originDate = reportDateKey(origin);
  return actualDate && originDate ? Math.round((Date.parse(actualDate) - Date.parse(originDate)) / 86_400_000) : 0;
}

function TimeWithDay({ value, origin, labels }) {
  const offset = dayOffset(value, origin);
  return <span>{clock(value)}{offset !== 0 && <small className="classic-day-offset">{offset > 0 ? '+' : ''}{offset} {labels.day}</small>}</span>;
}

function ValueTable({ values, className = '' }) {
  return <table className={`classic-value-table ${className}`}><tbody><tr>{values.map(([label, value]) => <td key={label}>{label}<strong>{value}</strong></td>)}</tr></tbody></table>;
}

function ExpenseTable({ headings, groups, labels }) {
  return <table className="classic-expense-table">
    <thead>{groups && <tr>{groups.map(label => <th key={label} scope="colgroup" colSpan={3}>{label}</th>)}</tr>}<tr>{headings.map((label, index) => <th key={`${label}-${index}`} scope="col">{label}</th>)}</tr></thead>
    <tbody><tr>{headings.map((label, index) => <td key={`${label}-${index}`} aria-label={`${label}: ${labels.manual}`} />)}</tr></tbody>
  </table>;
}

function ClassicTripLog({ page, lang, labels }) {
  return <table className="classic-triplog-table">
    <colgroup><col className="classic-trip-number" /><col className="classic-trip-time" /><col className="classic-trip-status" /><col /></colgroup>
    <thead><tr><th scope="col">{labels.number}</th><th scope="col">{labels.timeRange}</th><th scope="col">{labels.status}</th><th scope="col">{labels.description}</th></tr></thead>
    <tbody>{page.rows.length ? page.rows.map((report, index) => {
      const location = printReportLocation(report, lang);
      return <tr key={report.id || `${report.startTime}-${index}`} className={report.status === 'Cancelled' ? 'classic-cancelled' : undefined}>
        <td>{page.rowOffset + index + 1}</td>
        <td><TimeWithDay value={report.startTime} origin={page.windowStart} labels={labels} /><span className="classic-time-divider">–</span><TimeWithDay value={report.endTime} origin={page.windowStart} labels={labels} /></td>
        <td>{MODE_LABELS[report.mode]?.[lang] || report.mode || '—'}{report.status === 'Cancelled' && <small>{labels.cancelled}</small>}</td>
        <td className="classic-trip-description"><span>{location.name}</span>{location.coordinates && <small>{location.coordinates}</small>}</td>
      </tr>;
    }) : <tr><td colSpan={4} className="classic-no-jobs">{labels.noJobs}</td></tr>}
    {Array.from({ length: Math.max(0, 7 - Math.max(1, page.rows.length)) }, (_, index) => <tr key={`blank-${index}`} aria-hidden="true" className="classic-blank-trip-row"><td /><td /><td /><td /></tr>)}</tbody>
  </table>;
}

function ClassicSpeedChart({ rows, samplesByReportId, page, labels }) {
  const start = timestamp(page.windowStart);
  const end = timestamp(page.windowEnd);
  const span = end != null && start != null ? end - start : 86_400_000;
  const points = mergeReportSpeedSeries(rows.map(report => ({ reportId: String(report.id || ''), points: normalizeSpeedSamples(samplesByReportId[report.id] || []) })))
    .filter(point => start != null && end != null && timestamp(point.capturedAt) >= start && timestamp(point.capturedAt) < end);
  const peakSpeed = points.reduce((max, point) => Math.max(max, point.speedKph), 0);
  const maxSpeed = Math.max(125, Math.ceil(peakSpeed / 25) * 25);
  const positioned = points.map(point => ({ ...point, x: (timestamp(point.capturedAt) - start) / span * 1000, y: 180 - point.speedKph / maxSpeed * 170 }));
  const path = positioned.map((point, index) => {
    const previous = positioned[index - 1];
    // A new report or a GPS gap has no observed connecting speed trace.
    const move = !previous || previous.reportId !== point.reportId || timestamp(point.capturedAt) - timestamp(previous.capturedAt) > 300_000;
    return `${move ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(' ');
  const ticks = [maxSpeed, maxSpeed * .6, maxSpeed * .2, 0];
  return <>
    <div className="classic-chart-legend"><span><i />{labels.speed}</span><span>{labels.rpm}: —</span><span className="classic-window">{dateTime(page.windowStart)} – {dateTime(page.windowEnd)}</span></div>
    <div className="classic-chart-row">
      <div className="classic-chart-gutter">{ticks.map(value => <span key={value} style={{ top: `${(180 - value / maxSpeed * 170) / 190 * 100}%` }}>{Math.round(value)}</span>)}</div>
      <div className="classic-chart-area">
        <svg viewBox="0 0 1000 190" preserveAspectRatio="none" role="img" aria-label={`${labels.speed}: ${points.length ? number(peakSpeed) : labels.noSpeed}`}>
          {Array.from({ length: 25 }, (_, index) => <line key={`v-${index}`} x1={index * 1000 / 24} x2={index * 1000 / 24} y1="0" y2="190" className="classic-chart-grid" />)}
          {[10, 78, 146, 180].map(value => <line key={`h-${value}`} x1="0" x2="1000" y1={value} y2={value} className="classic-chart-grid" />)}
          <path d={path} className="classic-speed-path" />
          {positioned.map((point, index) => <circle key={`${point.reportId}-${point.id}-${index}`} cx={point.x} cy={point.y} r="1.6" className="classic-speed-point" />)}
        </svg>
        {!points.length && <span className="classic-no-speed">{labels.noSpeed}</span>}
      </div>
    </div>
  </>;
}

function ClassicStatusRows({ rows, page, labels }) {
  const start = timestamp(page.windowStart);
  const end = timestamp(page.windowEnd);
  const span = end != null && start != null ? end - start : 86_400_000;
  return STATUS_ORDER.map(status => <div className="classic-status-row" key={status}>
    <div className="classic-status-label">{labels[status]}</div>
    <div className="classic-status-track">{rows.flatMap((report, index) => {
      if (report.status === 'Cancelled' || !STATUS_MODES[status].includes(report.mode)) return [];
      const reportStart = timestamp(report.startTime);
      const reportEnd = timestamp(report.endTime);
      if (start == null || end == null || reportStart == null || reportEnd == null) return [];
      const clippedStart = Math.max(start, reportStart);
      const clippedEnd = Math.min(end, reportEnd);
      if (clippedEnd <= clippedStart) return [];
      return [<span key={report.id || index} className="classic-status-fill" style={{ left: `${(clippedStart - start) / span * 100}%`, width: `${(clippedEnd - clippedStart) / span * 100}%` }} title={`${MODE_LABELS[report.mode]?.[labels === LABELS.th ? 'th' : 'en'] || report.mode}: ${dateTime(report.startTime)} – ${dateTime(report.endTime)}`} />];
    })}</div>
  </div>);
}

function ClassicChecklist({ labels }) {
  return <div className="classic-checklist" aria-label={labels.inspection}>{['engine', 'tire', 'brake', 'other'].map(group => <div key={group} className="classic-checklist-group">
    <div className="classic-checklist-title">{labels[group]}</div>
    {labels[`${group}Items`].map(label => <div key={label} className="classic-checklist-item"><span>{label}</span><span className="classic-circle" aria-label={`${label}: ${labels.manual}`} /></div>)}
  </div>)}</div>;
}

export default function ClassicOperationReport({ model, lang }) {
  const language = lang === 'th' ? 'th' : 'en';
  const labels = LABELS[language];
  const { summary, documentId, printedAt, samplesByReportId = {}, totalSeconds, classic } = model;
  const durations = classic.durations;
  const workPeriodId = summary.rows.find(report => report.workPeriodId)?.workPeriodId || documentId || '—';
  const summaryValues = [
    [labels.load, duration(durations.load)], [labels.unload, duration(durations.unload)], [labels.wait, duration(durations.wait)],
    [labels.breakSleep, duration(sumDurations(durations.break, durations.sleep))], [labels.refuel, duration(durations.refuel)], [labels.totalPark, duration(durations.park)],
    [labels.totalDistance, summary.distance == null ? '—' : `${number(summary.distance)} ${labels.km}`], [labels.maxSpeed, number(summary.topSpeed, 0)], [labels.count, '—'],
  ];
  return classic.pages.map((page, pageIndex) => <section key={`${page.windowStart}-${pageIndex}`} className="print-sheet classic-report" lang={language} aria-label={`${labels.title} · ${labels.page} ${pageIndex + 1}/${classic.pages.length}`}>
    <div className="classic-form">
      <div className="classic-layout-code"><span>{labels.layoutCode}: {documentId || '—'}</span></div>
      <div className="classic-info-block">
        <div className="classic-company">Songdee Ops Panel</div>
        <table className="classic-header-table"><tbody>{[
          [labels.code, workPeriodId], [labels.vehicle, summary.vehicle || '—'], [labels.driver, summary.driver || '—'], [labels.driverCode, summary.driverId || '—'], [labels.start, dateTime(summary.start)], [labels.end, dateTime(summary.end)],
        ].map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table>
        <h1 className="classic-title">{labels.title}</h1>
        <div className="classic-print-meta"><span>{labels.printed}: {printedAt || '—'}</span><span>{documentId || '—'}</span><span>{labels.page}: {pageIndex + 1}/{classic.pages.length}</span></div>
        <ValueTable values={[[labels.startOdometer, '—'], [labels.distance1, '—'], [labels.endOdometer, '—'], [labels.distance2, '—']]} />
        <ValueTable values={[[labels.loadUnload, duration(sumDurations(durations.load, durations.unload))], [labels.drive, duration(durations.drive)], [labels.parkWait, duration(sumDurations(durations.park, durations.wait))], [labels.break, duration(durations.break)], [labels.total, duration(totalSeconds)]]} />
        <ClassicTripLog page={page} lang={language} labels={labels} />
        <ExpenseTable groups={[labels.vehicleL, labels.vehicleD]} headings={['IH', 'OC', labels.other, 'IH', 'OC', labels.other]} labels={labels} />
        <ExpenseTable headings={[labels.cash, labels.etc, labels.card, labels.coupon]} labels={labels} />
        <ExpenseTable headings={[labels.parkExpense, labels.travel, labels.repair, labels.other]} labels={labels} />
        <div className="classic-notes">{labels.notes}</div>
        <div className="classic-footer-meta"><span>{labels.loadStatus}</span><span>—</span><span>—</span></div>
      </div>
      <div className="classic-timeline-block">
        <div className="classic-hour-row"><div className="classic-hour-gutter" /><div className="classic-hours">{Array.from({ length: 24 }, (_, index) => <div key={index} className="classic-hour-cell"><span>{String((index + 6) % 24).padStart(2, '0')}:00</span>{index >= 18 && <small title={labels.nextDay}>+1</small>}</div>)}</div></div>
        <ClassicSpeedChart rows={summary.rows} samplesByReportId={samplesByReportId} page={page} labels={labels} />
        <div aria-label={labels.timeline}><ClassicStatusRows rows={summary.rows} page={page} labels={labels} /></div>
        <div className="classic-ledger" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <div className="classic-ledger-row" key={index}><div className="classic-ledger-gutter" /><div className="classic-ledger-track" /></div>)}</div>
        <div className="classic-totals-strip">{summaryValues.map(([label, value]) => <div key={label}>{label}<strong>{value}</strong></div>)}</div>
        <ClassicChecklist labels={labels} />
      </div>
    </div>
  </section>);
}
