'use client';

import { useId, useMemo, useState } from 'react';
import { mergeReportSpeedSeries, normalizeSpeedSamples, speedChartPoints, speedDomainMaximum, speedLinePath } from '../lib/speed-timeline';

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
  originTime = '',
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
  const { maximum, chartPoints, linePath, peak } = useMemo(() => {
    const origin = Date.parse(originTime);
    const timelinePoints = mergeReportSpeedSeries(series).flatMap(point => {
      if (!Number.isFinite(origin)) return [point];
      const timestamp = Date.parse(point.capturedAt);
      return Number.isFinite(timestamp) ? [{ ...point, minute: (timestamp - origin) / 60_000 }] : [];
    });
    const nextMaximum = speedDomainMaximum([timelinePoints]);
    const nextPoints = speedChartPoints(timelinePoints, { startMinute, endMinute, maxSpeed: nextMaximum })
      .map(point => ({ ...point, copy: pointCopy(point, lang) }));
    return {
      maximum: nextMaximum,
      chartPoints: nextPoints,
      linePath: speedLinePath(nextPoints),
      peak: nextPoints.reduce((value, point) => Math.max(value, point.speedKph), 0),
    };
  }, [series, startMinute, endMinute, originTime, lang]);

  if (!chartPoints.length) {
    return <span className={`speed-timeline-state ${className}`.trim()}>{loading
      ? (lang === 'th' ? 'กำลังโหลดความเร็ว…' : 'Loading speed…')
      : (lang === 'th' ? 'ไม่มีข้อมูลความเร็ว' : 'No speed data')}</span>;
  }

  const summary = lang === 'th'
    ? `กราฟเส้นความเร็ว ${chartPoints.length} จุด ความเร็วสูงสุด ${Math.round(peak)} กิโลเมตรต่อชั่วโมง`
    : `Vehicle speed line graph with ${chartPoints.length} points and a peak of ${Math.round(peak)} kilometres per hour.`;
  return <><svg className={`speed-timeline-overlay ${className}`.trim()} viewBox="0 0 1000 72" preserveAspectRatio="none" role={interactive ? 'group' : 'img'} aria-labelledby={`${titleId} ${descriptionId}`} data-line-points={chartPoints.length}>
    <title id={titleId}>{lang === 'th' ? 'ความเร็วรถตามเวลา' : 'Vehicle speed over time'}</title>
    <desc id={descriptionId}>{summary}</desc>
    <line className="speed-baseline" x1="0" x2="1000" y1="62" y2="62" vectorEffect="non-scaling-stroke" />
    {chartPoints.length > 1 ? <g className="speed-line-series" aria-hidden="true">
      <path className="speed-line-halo" d={linePath} vectorEffect="non-scaling-stroke" />
      <path className="speed-line" d={linePath} vectorEffect="non-scaling-stroke" />
    </g> : null}
    {chartPoints.map(point => {
      const key = `${point.reportId}-${point.id}`;
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
  </svg><span className="speed-scale-label" aria-hidden="true">{maximum} km/h</span>{interactive && activePoint ? <span id={pointTooltipId} className="speed-point-tooltip" role="tooltip" style={{ left: `${Math.max(7, Math.min(93, activePoint.point.x / 10))}%` }}><strong>{activePoint.copy.speed}</strong><small>{activePoint.copy.time}</small></span> : null}</>;
}
