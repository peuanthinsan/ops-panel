'use client';

import { useId, useMemo, useState } from 'react';
import { normalizeSpeedSamples, speedChartPoints, speedDomainMaximum, speedLinePath } from '../lib/speed-timeline';

const pointTimeFormatters = {
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  th: new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};
const pointNumberFormatters = { en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }), th: new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }) };

function pointCopy(point, lang) {
  const date = new Date(point.capturedAt);
  const time = Number.isFinite(date.getTime())
    ? pointTimeFormatters[lang === 'th' ? 'th' : 'en'].format(date)
    : '—';
  const speed = pointNumberFormatters[lang === 'th' ? 'th' : 'en'].format(point.speedKph);
  const unit = lang === 'th' ? 'กม./ชม.' : 'km/h';
  return {
    speed: `${speed} ${unit}`,
    time,
    label: lang === 'th' ? `${time} ความเร็ว ${speed} ${unit}` : `${time}, speed ${speed} ${unit}`,
  };
}

export default function SpeedTimelineOverlay({
  reports = [],
  samplesByReportId = {},
  loading = false,
  lang = 'en',
  startMinute = 0,
  endMinute = 24 * 60,
  className = '',
  interactive = true,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const pointTooltipId = useId();
  const [activePoint, setActivePoint] = useState(null);
  const series = useMemo(() => reports.map(report => ({
    reportId: report.id,
    points: normalizeSpeedSamples(samplesByReportId[report.id] || []),
  })).filter(item => item.points.length), [reports, samplesByReportId]);
  const { maximum, chartSeries, allPoints, peak } = useMemo(() => {
    const nextMaximum = speedDomainMaximum(series.map(item => item.points));
    const nextSeries = series.map(item => {
      const points = speedChartPoints(item.points, { startMinute, endMinute, maxSpeed: nextMaximum }).map(point => ({ ...point, copy: pointCopy(point, lang) }));
      return { ...item, points, path: speedLinePath(points) };
    }).filter(item => item.points.length);
    const nextPoints = nextSeries.flatMap(item => item.points);
    return {
      maximum: nextMaximum,
      chartSeries: nextSeries,
      allPoints: nextPoints,
      peak: nextPoints.reduce((value, point) => Math.max(value, point.speedKph), 0),
    };
  }, [series, startMinute, endMinute, lang]);

  if (!allPoints.length) {
    return <span className={`speed-timeline-state ${className}`.trim()}>{loading
      ? (lang === 'th' ? 'กำลังโหลดความเร็ว…' : 'Loading speed…')
      : (lang === 'th' ? 'ไม่มีข้อมูลความเร็ว' : 'No speed data')}</span>;
  }

  const summary = lang === 'th'
    ? `กราฟความเร็ว ${allPoints.length} จุด ความเร็วสูงสุด ${Math.round(peak)} กิโลเมตรต่อชั่วโมง`
    : `Vehicle speed graph with ${allPoints.length} points and a peak of ${Math.round(peak)} kilometres per hour.`;
  return <><svg className={`speed-timeline-overlay ${className}`.trim()} viewBox="0 0 1000 72" preserveAspectRatio="none" role={interactive ? 'group' : 'img'} aria-labelledby={`${titleId} ${descriptionId}`}>
    <title id={titleId}>{lang === 'th' ? 'ความเร็วรถตามเวลา' : 'Vehicle speed over time'}</title>
    <desc id={descriptionId}>{summary}</desc>
    <line className="speed-baseline" x1="0" x2="1000" y1="62" y2="62" vectorEffect="non-scaling-stroke" />
    {chartSeries.map(item => {
      return <g key={item.reportId}>
        <path className="speed-line-halo" d={item.path} vectorEffect="non-scaling-stroke" />
        <path className="speed-line" d={item.path} vectorEffect="non-scaling-stroke" />
        {item.points.map(point => {
          const key = `${item.reportId}-${point.id}`;
          const copy = point.copy;
          const selected = activePoint?.key === key;
          const togglePoint = () => setActivePoint(current => current?.key === key && current.pinned ? null : { key, point, copy, pinned: true });
          return <g className="speed-point-group" key={key}>
            <circle className={`speed-point ${selected ? 'selected' : ''}`} cx={point.x} cy={point.y} r="3" vectorEffect="non-scaling-stroke"><title>{copy.label}</title></circle>
            {interactive ? <circle
              className="speed-point-hit"
              cx={point.x}
              cy={point.y}
              r="9"
              role="button"
              tabIndex={0}
              aria-label={copy.label}
              aria-describedby={selected ? pointTooltipId : undefined}
              aria-expanded={selected && activePoint.pinned}
              onMouseEnter={() => setActivePoint({ key, point, copy, pinned: false })}
              onMouseLeave={() => setActivePoint(current => current?.key === key && !current.pinned ? null : current)}
              onFocus={() => setActivePoint({ key, point, copy, pinned: false })}
              onBlur={() => setActivePoint(current => current?.key === key ? null : current)}
              onClick={togglePoint}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePoint(); }
                if (event.key === 'Escape') setActivePoint(null);
              }}
            /> : null}
          </g>;
        })}
      </g>;
    })}
  </svg><span className="speed-scale-label" aria-hidden="true">{maximum} km/h</span>{interactive && activePoint ? <span id={pointTooltipId} className="speed-point-tooltip" role="tooltip" style={{ left: `${Math.max(7, Math.min(93, activePoint.point.x / 10))}%` }}><strong>{activePoint.copy.speed}</strong><small>{activePoint.copy.time}</small></span> : null}</>;
}
