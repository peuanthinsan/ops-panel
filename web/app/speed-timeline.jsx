'use client';

import { useId, useMemo } from 'react';
import { normalizeSpeedSamples, speedChartPoints, speedDomainMaximum, speedLinePath } from '../lib/speed-timeline';

export default function SpeedTimelineOverlay({
  reports = [],
  samplesByReportId = {},
  loading = false,
  lang = 'en',
  startMinute = 0,
  endMinute = 24 * 60,
  className = '',
}) {
  const titleId = useId();
  const descriptionId = useId();
  const series = useMemo(() => reports.map(report => ({
    reportId: report.id,
    points: normalizeSpeedSamples(samplesByReportId[report.id] || []),
  })).filter(item => item.points.length), [reports, samplesByReportId]);
  const maximum = speedDomainMaximum(series.map(item => item.points));
  const chartSeries = series.map(item => ({
    ...item,
    points: speedChartPoints(item.points, { startMinute, endMinute, maxSpeed: maximum }),
  })).filter(item => item.points.length);
  const allPoints = chartSeries.flatMap(item => item.points);
  const peak = allPoints.reduce((value, point) => Math.max(value, point.speedKph), 0);

  if (!allPoints.length) {
    return <span className={`speed-timeline-state ${className}`.trim()}>{loading
      ? (lang === 'th' ? 'กำลังโหลดความเร็ว…' : 'Loading speed…')
      : (lang === 'th' ? 'ไม่มีข้อมูลความเร็ว' : 'No speed data')}</span>;
  }

  const summary = lang === 'th'
    ? `กราฟความเร็ว ${allPoints.length} จุด ความเร็วสูงสุด ${Math.round(peak)} กิโลเมตรต่อชั่วโมง`
    : `Vehicle speed graph with ${allPoints.length} points and a peak of ${Math.round(peak)} kilometres per hour.`;
  return <><svg className={`speed-timeline-overlay ${className}`.trim()} viewBox="0 0 1000 72" preserveAspectRatio="none" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
    <title id={titleId}>{lang === 'th' ? 'ความเร็วรถตามเวลา' : 'Vehicle speed over time'}</title>
    <desc id={descriptionId}>{summary}</desc>
    <line className="speed-baseline" x1="0" x2="1000" y1="62" y2="62" vectorEffect="non-scaling-stroke" />
    {chartSeries.map(item => {
      const path = speedLinePath(item.points);
      return <g key={item.reportId}>
        <path className="speed-line-halo" d={path} vectorEffect="non-scaling-stroke" />
        <path className="speed-line" d={path} vectorEffect="non-scaling-stroke" />
        {item.points.length === 1 ? <circle className="speed-point" cx={item.points[0].x} cy={item.points[0].y} r="3" vectorEffect="non-scaling-stroke" /> : null}
      </g>;
    })}
  </svg><span className="speed-scale-label" aria-hidden="true">{maximum} km/h</span></>;
}
