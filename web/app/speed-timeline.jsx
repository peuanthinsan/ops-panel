'use client';

import { useId, useMemo, useState } from 'react';
import { reportTelemetryPoints, telemetryChartPoints, telemetryDomainMaximum, telemetryLinePath, telemetryMarkerPoints } from '../lib/speed-timeline';

const pointTimeFormatters = {
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  th: new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};
const pointNumberFormatters = { en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }), th: new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }) };
const fuelNumberFormatters = { en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }), th: new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }) };

function pointCopy(point, lang) {
  const language = lang === 'th' ? 'th' : 'en';
  const time = pointTimeFormatters[language].format(new Date(point.capturedAt));
  const number = value => value == null ? '—' : pointNumberFormatters[language].format(value);
  const speed = `${number(point.speedKph)} ${language === 'th' ? 'กม./ชม.' : 'km/h'}`;
  const fuel = point.totalFuel == null ? '—' : fuelNumberFormatters[language].format(point.totalFuel);
  return { time, speed, fuel, label: language === 'th' ? `${time}, ความเร็ว ${speed}, น้ำมันรวม ${fuel}` : `${time}, speed ${speed}, Total fuel ${fuel}` };
}

export default function SpeedTimelineOverlay({
  reports = [], samplesByReportId = {}, telemetryByReportId = {}, loading = false, telemetryLoading = false,
  lang = 'en', startMinute = 0, endMinute = 24 * 60, originTime = '', className = '', interactive = true,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const pointTooltipId = useId();
  const [selection, setSelection] = useState(null);
  const { maxSpeed, maxFuel, chartPoints, markers, speedPath, fuelPath } = useMemo(() => {
    const points = reportTelemetryPoints(reports, telemetryByReportId, samplesByReportId, originTime)
      .filter(point => point.minute >= startMinute && point.minute <= endMinute);
    const speedMaximum = telemetryDomainMaximum(points, 'speedKph');
    const fuelMaximum = telemetryDomainMaximum(points, 'totalFuel');
    const next = telemetryChartPoints(points, { startMinute, endMinute, maxSpeed: speedMaximum, maxFuel: fuelMaximum });
    return { maxSpeed: speedMaximum, maxFuel: fuelMaximum, chartPoints: next, markers: telemetryMarkerPoints(next), speedPath: telemetryLinePath(next, 'speedKph'), fuelPath: telemetryLinePath(next, 'totalFuel') };
  }, [reports, telemetryByReportId, samplesByReportId, originTime, startMinute, endMinute]);
  const inspectionPoints = useMemo(() => chartPoints.filter(point => point.speedKph != null || point.totalFuel != null), [chartPoints]);
  const activePoint = selection ? inspectionPoints[Math.min(selection.index, inspectionPoints.length - 1)] : null;
  const copy = activePoint ? pointCopy(activePoint, lang) : null;
  const hasFuel = chartPoints.some(point => point.totalFuel != null);
  const hasSpeed = chartPoints.some(point => point.speedKph != null);
  const results = reports.map(report => telemetryByReportId[report.id]);
  const unavailable = results.some(result => result?.status === 'unavailable');
  const notConfigured = results.length > 0 && results.every(result => result?.status === 'not_configured');
  const fuelState = telemetryLoading ? (lang === 'th' ? 'กำลังโหลดน้ำมัน…' : 'Loading fuel…')
    : unavailable ? (lang === 'th' ? (hasFuel ? 'ข้อมูลน้ำมันไม่ครบ' : 'ข้อมูลน้ำมันไม่พร้อม') : (hasFuel ? 'Partial fuel data' : 'Fuel unavailable'))
      : notConfigured ? (lang === 'th' ? 'ยังไม่เชื่อมต่อข้อมูลน้ำมัน' : 'Fuel not connected')
        : !hasFuel ? (lang === 'th' ? 'ไม่มีข้อมูลน้ำมัน' : 'No fuel data') : '';
  if (!inspectionPoints.length) {
    return <span className={`speed-timeline-state ${className}`.trim()}>{loading || telemetryLoading
      ? (lang === 'th' ? 'กำลังโหลดความเร็วและน้ำมัน…' : 'Loading speed and fuel…')
      : (lang === 'th' ? `ไม่มีข้อมูลความเร็ว · ${fuelState}` : `No speed data · ${fuelState}`)}</span>;
  }

  const inspectPointer = (event, pinned = false) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1000, (event.clientX - bounds.left) / Math.max(1, bounds.width) * 1000));
    let low = 0;
    let high = inspectionPoints.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (inspectionPoints[middle].x < x) low = middle + 1; else high = middle; }
    const index = low > 0 && x - inspectionPoints[low - 1].x < inspectionPoints[low].x - x ? low - 1 : low;
    setSelection(current => current?.index === index && current.pinned === pinned ? current : { index, pinned });
  };
  const title = lang === 'th' ? 'ความเร็วและน้ำมันรวมตามเวลา' : 'Speed and Total fuel over time';
  const summary = lang === 'th'
    ? `${inspectionPoints.length} จุด สเกลความเร็ว 0–${maxSpeed} กม./ชม. สเกลน้ำมันรวม ${hasFuel ? `0–${maxFuel} ยังไม่ยืนยันหน่วย` : fuelState} ช่วงข้อมูลขาดหรือเกิน 5 นาทีไม่เชื่อมเส้น ใช้ลูกศรซ้ายขวาหรือแตะเพื่อดูค่า`
    : `${inspectionPoints.length} readings. Speed scale 0–${maxSpeed} km/h. Total fuel scale ${hasFuel ? `0–${maxFuel}, unit unconfirmed` : fuelState}. Missing readings and gaps over 5 minutes are not connected. Use left and right arrows or tap to inspect.`;
  return <><svg className={`speed-timeline-overlay ${className}`.trim()} viewBox="0 0 1000 72" preserveAspectRatio="none" role={interactive ? 'group' : 'img'} aria-labelledby={`${titleId} ${descriptionId}`} data-line-points={chartPoints.length} data-fuel-points={chartPoints.filter(point => point.totalFuel != null).length}>
    <title id={titleId}>{title}</title><desc id={descriptionId}>{summary}</desc>
    <line className="speed-baseline" x1="0" x2="1000" y1="62" y2="62" vectorEffect="non-scaling-stroke" />
    <g aria-hidden="true">
      <path className="speed-line-halo" d={speedPath} vectorEffect="non-scaling-stroke" />
      <path className="speed-line" d={speedPath} vectorEffect="non-scaling-stroke" />
      <path className="fuel-line-halo" d={fuelPath} vectorEffect="non-scaling-stroke" />
      <path className="fuel-line" d={fuelPath} vectorEffect="non-scaling-stroke" />
      {markers.map(point => <g key={`${point.reportId}-${point.id}-${point.capturedAt}`}>
        {point.speedY != null ? <circle className="speed-point" cx={point.x} cy={point.speedY} r="2.5" vectorEffect="non-scaling-stroke" /> : null}
        {point.fuelY != null ? <rect className="fuel-point" x={point.x - 2} y={point.fuelY - 2} width="4" height="4" vectorEffect="non-scaling-stroke" /> : null}
      </g>)}
      {activePoint ? <g><line className="telemetry-cursor" x1={activePoint.x} x2={activePoint.x} y1="18" y2="64" vectorEffect="non-scaling-stroke" />{activePoint.speedY != null ? <circle className="speed-point selected" cx={activePoint.x} cy={activePoint.speedY} r="4" vectorEffect="non-scaling-stroke" /> : null}{activePoint.fuelY != null ? <rect className="fuel-point selected" x={activePoint.x - 3.5} y={activePoint.fuelY - 3.5} width="7" height="7" vectorEffect="non-scaling-stroke" /> : null}</g> : null}
    </g>
    {interactive ? <rect className="telemetry-inspector" x="0" y="0" width="1000" height="72" role="slider" tabIndex={0} aria-label={title} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={inspectionPoints.length} aria-valuenow={Math.min((selection?.index ?? 0) + 1, inspectionPoints.length)} aria-valuetext={copy?.label || pointCopy(inspectionPoints[0], lang).label} aria-describedby={`${descriptionId}${activePoint ? ` ${pointTooltipId}` : ''}`}
      onPointerMove={event => { if (event.pointerType === 'mouse' && !selection?.pinned) inspectPointer(event); }}
      onPointerLeave={() => setSelection(current => current?.pinned ? current : null)}
      onPointerDown={event => inspectPointer(event, true)}
      onFocus={() => setSelection(current => current || { index: 0, pinned: false })}
      onBlur={() => setSelection(null)}
      onKeyDown={event => {
        const current = selection?.index ?? 0;
        const offsets = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
        if (event.key in offsets || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? inspectionPoints.length - 1 : Math.max(0, Math.min(inspectionPoints.length - 1, current + offsets[event.key]));
          setSelection({ index, pinned: true });
        }
        if (event.key === 'Escape') setSelection(null);
      }} /> : null}
  </svg><span className="speed-scale-label" aria-hidden="true">{lang === 'th' ? 'ความเร็ว' : 'Speed'} {hasSpeed ? `0–${maxSpeed} ${lang === 'th' ? 'กม./ชม.' : 'km/h'}` : '—'}</span><span className="fuel-scale-label" aria-hidden="true">{hasFuel ? `${lang === 'th' ? 'น้ำมันรวม' : 'Total fuel'} 0–${maxFuel}${fuelState ? ` · ${fuelState}` : ''}` : fuelState}</span>{interactive && activePoint ? <span id={pointTooltipId} className="speed-point-tooltip" role="tooltip" style={{ left: `${Math.max(12, Math.min(88, activePoint.x / 10))}%` }}><small>{copy.time}</small><strong>{lang === 'th' ? 'ความเร็ว' : 'Speed'} {copy.speed}</strong><strong>{lang === 'th' ? 'น้ำมันรวม' : 'Total fuel'} {copy.fuel}</strong><small>{lang === 'th' ? 'หน่วยน้ำมันยังไม่ยืนยัน' : 'Fuel unit unconfirmed'}</small></span> : null}</>;
}
