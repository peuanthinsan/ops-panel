'use client';

import { useId, useState } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CircleIcon } from '@phosphor-icons/react/dist/csr/Circle';
import { formatTimelineAlertTime, timelineAlertLabel, timelineAlertPosition } from '../lib/timeline-alerts';

function alertCopy(alert, lang) {
  const time = formatTimelineAlertTime(alert, lang);
  const label = timelineAlertLabel(alert, lang);
  return {
    time,
    label,
    accessibleLabel: lang === 'th' ? `${time} การแจ้งเตือน ${label}` : `${time}, alert: ${label}`,
  };
}

export function TimelineAlertMarkers({ alerts = [], lang = 'en', startMinute = 0, endMinute = 24 * 60, interactive = true }) {
  const tooltipId = useId();
  const [activeAlert, setActiveAlert] = useState(null);
  const markers = alerts.flatMap(alert => {
    const position = timelineAlertPosition(alert, startMinute, endMinute);
    return position == null ? [] : [{ alert, position, copy: alertCopy(alert, lang) }];
  });

  return <>{markers.map(({ alert, position, copy }) => interactive ? <button
    key={alert.id}
    type="button"
    className="timeline-alert-marker"
    style={{ left: `${position}%` }}
    aria-label={copy.accessibleLabel}
    aria-describedby={activeAlert?.id === alert.id ? tooltipId : undefined}
    aria-expanded={activeAlert?.id === alert.id && activeAlert.pinned}
    onMouseEnter={() => setActiveAlert({ id: alert.id, pinned: false })}
    onMouseLeave={() => setActiveAlert(current => current?.id === alert.id && !current.pinned ? null : current)}
    onFocus={() => setActiveAlert({ id: alert.id, pinned: false })}
    onBlur={() => setActiveAlert(current => current?.id === alert.id ? null : current)}
    onClick={() => setActiveAlert(current => current?.id === alert.id && current.pinned ? null : { id: alert.id, pinned: true })}
    onKeyDown={event => { if (event.key === 'Escape') setActiveAlert(null); }}
  ><CaretDownIcon weight="fill" aria-hidden="true" /></button> : <span key={alert.id} className="timeline-alert-marker" style={{ left: `${position}%` }} aria-hidden="true"><CaretDownIcon weight="fill" /></span>)}
  {interactive && activeAlert ? markers.filter(marker => marker.alert.id === activeAlert.id).map(({ alert, position, copy }) => <span key={`tooltip-${alert.id}`} id={tooltipId} className="timeline-alert-tooltip" role="tooltip" style={{ left: `${Math.max(5, Math.min(95, position))}%` }}><strong>{copy.label}</strong><small>{copy.time}</small></span>) : null}</>;
}

export function TimelineAlertChips({ alerts = [], lang = 'en', limit = null, className = '' }) {
  if (!alerts.length) return null;
  const visible = limit == null ? alerts : alerts.slice(0, limit);
  const remaining = Math.max(0, alerts.length - visible.length);
  return <div className={`timeline-alert-list ${className}`.trim()} aria-label={lang === 'th' ? `${alerts.length} การแจ้งเตือน` : `${alerts.length} alerts`}>
    {visible.map(alert => {
      const copy = alertCopy(alert, lang);
      return <span className="timeline-alert-chip" key={`chip-${alert.id}`}><CircleIcon weight="fill" aria-hidden="true" /><b>{copy.time}</b><span aria-hidden="true">·</span>{copy.label}</span>;
    })}
    {remaining ? <span className="timeline-alert-chip timeline-alert-more">+{remaining} {lang === 'th' ? 'รายการ' : 'more'}</span> : null}
  </div>;
}
