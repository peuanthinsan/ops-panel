const sortKeys = new Set([
  'startTime', 'endTime', 'vehicleNumber', 'deviceId', 'driverName',
  'mode', 'duration', 'status', 'gpsState', 'startClock', 'topSpeed',
]);

function positiveInteger(value, fallback, maximum) {
  const result = Math.trunc(Number(value));
  return Number.isFinite(result) && result > 0 ? Math.min(result, maximum) : fallback;
}

function bangkokDateKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function clockMinutes(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return -1;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return (Number(parts.find(item => item.type === 'hour')?.value) * 60)
    + Number(parts.find(item => item.type === 'minute')?.value);
}

function gpsState(report) { return String(report.gpsLookupStatus || report.gps || ''); }

function reportSearchText(report) {
  return [
    report.id, report.vehicleNumber, report.deviceId, report.driverName, report.driverId,
    report.mode, report.status, report.gps, report.gpsLookupStatus, report.gpsLookupMessage,
    report.locationName, report.location, report.address,
    report.lastDeviceLatitude, report.lastDeviceLongitude,
  ].filter(value => value !== undefined && value !== null).join(' ').toLocaleLowerCase();
}

function sortValue(report, key) {
  if (key === 'startTime' || key === 'endTime') return Date.parse(report[key]) || 0;
  if (key === 'startClock') return clockMinutes(report.startTime);
  if (key === 'duration') return Math.max(0, (Date.parse(report.endTime) || 0) - (Date.parse(report.startTime) || 0));
  if (key === 'topSpeed') return Number(report.topSpeed ?? report.maxSpeed ?? report.maximumSpeed) || 0;
  if (key === 'gpsState') return gpsState(report).toLocaleLowerCase();
  return String(report[key] || '').toLocaleLowerCase();
}

function compare(left, right, sort) {
  const leftValue = sortValue(left, sort.key);
  const rightValue = sortValue(right, sort.key);
  const result = typeof leftValue === 'number' && typeof rightValue === 'number'
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
  return sort.direction === 'asc' ? result : -result;
}

export function parseLocalReportSort(value) {
  const sorts = String(value || '').split(',').map(item => {
    const [key, direction] = item.split(':');
    return sortKeys.has(key) && (direction === 'asc' || direction === 'desc') ? { key, direction } : null;
  }).filter(Boolean).slice(0, 3);
  return sorts.length ? sorts : [{ key: 'startTime', direction: 'desc' }];
}

export function localReportFacets(reports) {
  const unique = key => [...new Set(reports.map(key).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }));
  return {
    vehicles: unique(report => report.vehicleNumber),
    devices: unique(report => report.deviceId),
    drivers: unique(report => report.driverName),
    statuses: unique(report => report.status),
    gpsStates: unique(gpsState),
  };
}

export function queryLocalReports(reports, bindings, searchParams) {
  const pageSize = positiveInteger(searchParams.get('pageSize'), 100, 100);
  const requestedPage = positiveInteger(searchParams.get('page'), 1, 100_000);
  const filters = Object.fromEntries([
    'search', 'startDate', 'endDate', 'vehicle', 'device', 'driver', 'mode', 'status', 'gps',
  ].map(key => [key, String(searchParams.get(key) || '').trim()]));
  const search = filters.search.toLocaleLowerCase();
  const filtered = reports.filter(report => {
    const date = bangkokDateKey(report.startTime);
    return (!filters.startDate || date >= filters.startDate)
      && (!filters.endDate || date <= filters.endDate)
      && (!filters.vehicle || report.vehicleNumber === filters.vehicle)
      && (!filters.device || report.deviceId === filters.device)
      && (!filters.driver || report.driverName === filters.driver)
      && (!filters.mode || report.mode === filters.mode)
      && (!filters.status || report.status === filters.status)
      && (!filters.gps || gpsState(report) === filters.gps)
      && (!search || reportSearchText(report).includes(search));
  });
  const sorts = parseLocalReportSort(searchParams.get('sort'));
  filtered.sort((left, right) => {
    for (const sort of sorts) {
      const result = compare(left, right, sort);
      if (result) return result;
    }
    return String(left.id || '').localeCompare(String(right.id || '')) * (sorts[0].direction === 'asc' ? 1 : -1);
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const pageReports = filtered.slice(offset, offset + pageSize);
  return {
    reports: pageReports,
    summary: {
      total,
      activeVehicles: new Set(filtered.filter(report => report.status !== 'Cancelled').map(report => report.vehicleNumber)).size,
      queued: filtered.filter(report => report.gpsLookupStatus === 'pending').length,
      cancelled: filtered.filter(report => report.status === 'Cancelled').length,
      gpsPaired: filtered.filter(report => Number(report.deviceGpsSamples) > 0
        && Number(report.pairedGpsSamples) === Number(report.deviceGpsSamples)).length,
      gpsNeedsAttention: filtered.filter(report => report.status !== 'Cancelled' && !(Number(report.deviceGpsSamples) > 0)).length,
      gpsMatched: filtered.filter(report => Number(report.deviceGpsSamples) > 0).length,
      deviceGpsSamples: filtered.reduce((total, report) => total + (Number(report.deviceGpsSamples) || 0), 0),
      fmsGpsSamples: filtered.reduce((total, report) => total + (Number(report.fmsGpsSamples) || 0), 0),
      pairedGpsSamples: filtered.reduce((total, report) => total + (Number(report.pairedGpsSamples) || 0), 0),
      attentionGpsSamples: filtered.reduce((total, report) => total + (Number(report.attentionGpsSamples) || 0), 0),
      fleetSize: bindings.length,
    },
    pageInfo: {
      page, pageSize, total, totalPages,
      start: pageReports.length ? offset + 1 : 0,
      end: offset + pageReports.length,
    },
  };
}
