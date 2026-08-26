const sortExpressions = {
  startTime: 'report.start_time',
  endTime: 'report.end_time',
  vehicleNumber: 'report.vehicle_number',
  deviceId: 'report.device_id',
  driverName: 'report.driver_name',
  mode: 'report.mode',
  duration: 'EXTRACT(EPOCH FROM (report.end_time - report.start_time))',
  topSpeed: '(SELECT max(sample.device_speed_mps) * 3.6 FROM gps_sync_samples sample WHERE sample.job_id = report.id)',
  gpsCoverage: '(SELECT COALESCE(summary.device_samples, 0) FROM job_gps_summaries summary WHERE summary.job_id = report.id)',
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

function boundedValues(searchParams, key, maximumLength, maximumValues = 100) {
  return [...new Set(searchParams.getAll(key)
    .map(value => String(value || '').trim().slice(0, maximumLength))
    .filter(Boolean))].slice(0, maximumValues);
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
    workPeriodId: String(searchParams.get('workPeriodId') || '').trim().slice(0, 180),
    vehicle: boundedValues(searchParams, 'vehicle', 80),
    device: boundedValues(searchParams, 'device', 180),
    driver: boundedValues(searchParams, 'driver', 180),
    mode: boundedValues(searchParams, 'mode', 80),
    status: boundedValues(searchParams, 'status', 180),
    gps: boundedValues(searchParams, 'gps', 180),
  };
  const values = [];
  const clauses = [];
  const parameter = value => { values.push(value); return `$${values.length}`; };
  if (filters.startDate) clauses.push(`report.work_period_start_time >= (${parameter(filters.startDate)}::date::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  if (filters.endDate) clauses.push(`report.work_period_start_time < ((${parameter(filters.endDate)}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  if (filters.workPeriodId) clauses.push(`report.work_period_id = ${parameter(filters.workPeriodId)}`);
  if (filters.vehicle.length) clauses.push(`lower(report.vehicle_number) = ANY(${parameter(filters.vehicle.map(value => value.toLocaleLowerCase()))}::text[])`);
  if (filters.device.length) clauses.push(`report.device_id = ANY(${parameter(filters.device)}::text[])`);
  if (filters.driver.length) clauses.push(`report.driver_name = ANY(${parameter(filters.driver)}::text[])`);
  if (filters.mode.length) clauses.push(`report.mode = ANY(${parameter(filters.mode)}::text[])`);
  if (filters.status.length) clauses.push(`report.status = ANY(${parameter(filters.status)}::text[])`);
  if (filters.gps.length) clauses.push(`COALESCE(report.gps_lookup_status, report.gps, '') = ANY(${parameter(filters.gps)}::text[])`);
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
