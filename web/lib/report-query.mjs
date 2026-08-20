const sortExpressions = {
  startTime: 'report.start_time',
  endTime: 'report.end_time',
  vehicleNumber: 'report.vehicle_number',
  deviceId: 'report.device_id',
  driverName: 'report.driver_name',
  mode: 'report.mode',
  duration: 'EXTRACT(EPOCH FROM (report.end_time - report.start_time))',
  status: 'report.status',
  gpsState: "COALESCE(report.gps_lookup_status, report.gps, '')",
  startClock: "EXTRACT(HOUR FROM report.start_time AT TIME ZONE 'Asia/Bangkok') * 60 + EXTRACT(MINUTE FROM report.start_time AT TIME ZONE 'Asia/Bangkok')",
};

function positiveInteger(value, fallback, maximum) {
  const result = Math.trunc(Number(value));
  return Number.isFinite(result) && result > 0 ? Math.min(result, maximum) : fallback;
}

function validDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function parseReportSort(value) {
  const parsed = String(value || '').split(',').map(item => {
    const [key, rawDirection] = item.split(':');
    const direction = rawDirection === 'asc' ? 'ASC' : rawDirection === 'desc' ? 'DESC' : '';
    return sortExpressions[key] && direction ? { key, direction, expression: sortExpressions[key] } : null;
  }).filter(Boolean).slice(0, 3);
  return parsed.length ? parsed : [{ key: 'startTime', direction: 'DESC', expression: sortExpressions.startTime }];
}

export function buildReportQuery(searchParams) {
  const page = positiveInteger(searchParams.get('page'), 1, 100_000);
  const pageSize = positiveInteger(searchParams.get('pageSize'), 100, 100);
  const filters = {
    search: String(searchParams.get('search') || '').trim().slice(0, 180),
    startDate: validDate(searchParams.get('startDate')),
    endDate: validDate(searchParams.get('endDate')),
    vehicle: String(searchParams.get('vehicle') || '').trim().slice(0, 80),
    device: String(searchParams.get('device') || '').trim().slice(0, 180),
    driver: String(searchParams.get('driver') || '').trim().slice(0, 180),
    mode: String(searchParams.get('mode') || '').trim().slice(0, 80),
    status: String(searchParams.get('status') || '').trim().slice(0, 180),
    gps: String(searchParams.get('gps') || '').trim().slice(0, 180),
  };
  const values = [];
  const clauses = [];
  const parameter = value => { values.push(value); return `$${values.length}`; };
  if (filters.startDate) clauses.push(`report.start_time >= (${parameter(filters.startDate)}::date::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  if (filters.endDate) clauses.push(`report.start_time < ((${parameter(filters.endDate)}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  if (filters.vehicle) clauses.push(`report.vehicle_number = ${parameter(filters.vehicle)}`);
  if (filters.device) clauses.push(`report.device_id = ${parameter(filters.device)}`);
  if (filters.driver) clauses.push(`report.driver_name = ${parameter(filters.driver)}`);
  if (filters.mode) clauses.push(`report.mode = ${parameter(filters.mode)}`);
  if (filters.status) clauses.push(`report.status = ${parameter(filters.status)}`);
  if (filters.gps) clauses.push(`COALESCE(report.gps_lookup_status, report.gps, '') = ${parameter(filters.gps)}`);
  if (filters.search) {
    clauses.push(`concat_ws(' ', report.id, report.vehicle_number, report.device_id, report.driver_name, report.driver_id, report.mode, report.status, report.gps, report.gps_lookup_status, report.gps_lookup_message) ILIKE ${parameter(`%${filters.search}%`)}`);
  }
  const sorts = parseReportSort(searchParams.get('sort'));
  const orderBy = [
    ...sorts.map(sort => `${sort.expression} ${sort.direction} NULLS LAST`),
    `report.id ${sorts[0].direction}`,
  ].join(', ');
  return {
    filters,
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    values,
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    orderBy,
    sorts: sorts.map(({ key, direction }) => ({ key, direction: direction.toLowerCase() })),
  };
}
