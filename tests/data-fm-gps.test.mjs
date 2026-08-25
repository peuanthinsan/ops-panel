import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dataFmDriverIdentity,
  fetchDataFmGpsHistory,
  formatDataFmDateTime,
  normalizeDataFmHistoryRecord,
  parseDataFmDateTime,
  resetDataFmTokenCacheForTests,
} from '../web/lib/server/data-fm-gps.mjs';

const config = {
  baseUrl: 'https://www.data-fm.com',
  username: 'test-user',
  password: 'test-password',
  timeZone: 'Asia/Bangkok',
  vehicleNumber: '700-4172',
  targetAt: '2026-08-20T03:40:45.000Z',
  toleranceMs: 60_000,
  nowMs: Date.parse('2026-08-20T03:40:45.000Z'),
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

test('formats and parses provider timestamps using an explicit source timezone', () => {
  assert.equal(formatDataFmDateTime('2026-08-20T03:40:46.000Z', 'Asia/Bangkok'), '2026.08.20 10:40:46');
  assert.equal(parseDataFmDateTime('2026.08.20 10:40:46', 'Asia/Bangkok'), '2026-08-20T03:40:46.000Z');
  assert.equal(parseDataFmDateTime('2026-08-20 10:40:46', 'Asia/Bangkok'), null);
});

test('normalizes Data-FM history coordinates, speed, bearing, and driver identity', () => {
  const point = normalizeDataFmHistoryRecord({
    vehicleno: '700-4172', latitude: 14.3289833, longitude: 100.84631,
    tracktime: '2026.08.20 10:40:46', speed: 36, bearing: 92,
    driverrfid: '1360400168966', drivername: 'RUEANGSRI THANYARAT', unitno: 'GPS-01',
  }, 'Asia/Bangkok');
  assert.equal(point.capturedAt, '2026-08-20T03:40:46.000Z');
  assert.equal(point.speedKph, 36);
  assert.equal(point.headingDegrees, 92);
  assert.deepEqual(dataFmDriverIdentity({ positions: [point] }), {
    driverId: '1360400168966',
    driverName: 'RUEANGSRI THANYARAT',
  });
  assert.deepEqual(dataFmDriverIdentity({ positions: [{ ...point, driverName: null }] }), {
    driverId: '1360400168966',
    driverName: null,
  });
});

test('requests a token once, encodes the documented history window, and tolerates string empty data', async () => {
  resetDataFmTokenCacheForTests();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(new URL(url));
    return requests.length === 1
      ? jsonResponse({ vResponseCode: '0', token: 'secret-token' })
      : jsonResponse({ vResponseCode: 0, vTotalRecords: 0, vData: '[]' });
  };
  const result = await fetchDataFmGpsHistory({ ...config, fetchImpl });
  assert.equal(result.status, 'received');
  assert.deepEqual(result.payload.positions, []);
  assert.equal(result.driverIdentity, null);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, '/Api/VTService.svc/GetToken');
  assert.equal(requests[0].searchParams.get('Password'), 'test-password');
  assert.equal(requests[1].searchParams.get('jtoken'), 'secret-token');
  assert.equal(requests[1].searchParams.get('vehicleno'), '700-4172');
  assert.equal(requests[1].searchParams.get('fromdatetime'), '2026.08.20 10:39:45');
  assert.equal(requests[1].searchParams.get('todatetime'), '2026.08.20 10:41:45');
});

test('refreshes an expired token exactly once and normalizes live history records', async () => {
  resetDataFmTokenCacheForTests();
  const requests = [];
  const fetchImpl = async url => {
    const request = new URL(url);
    requests.push(request);
    if (request.pathname.endsWith('/GetToken')) {
      return jsonResponse({ vResponseCode: 0, token: `token-${requests.filter(item => item.pathname.endsWith('/GetToken')).length}` });
    }
    if (request.searchParams.get('jtoken') === 'token-1') return jsonResponse({ vResponseCode: 1, vData: '[]' });
    return jsonResponse({ vResponseCode: 0, vTotalRecords: 1, vData: [{
      vehicleno: '700-4172', latitude: 14.3289833, longitude: 100.84631,
      tracktime: '2026.08.20 10:40:46', speed: 18, bearing: 45,
      driverrfid: '1360400168966', drivername: 'RUEANGSRI THANYARAT',
    }] });
  };
  const result = await fetchDataFmGpsHistory({ ...config, fetchImpl });
  assert.equal(result.status, 'received');
  assert.equal(result.payload.positions.length, 1);
  assert.equal(result.payload.positions[0].capturedAt, '2026-08-20T03:40:46.000Z');
  assert.deepEqual(result.driverIdentity, {
    driverId: '1360400168966',
    driverName: 'RUEANGSRI THANYARAT',
  });
  assert.equal(requests.filter(item => item.pathname.endsWith('/GetToken')).length, 2);
  assert.equal(requests.filter(item => item.pathname.endsWith('/GetVehicleHistory')).length, 2);
});

test('uses the latest named history point as the report driver identity', () => {
  const positions = [
    normalizeDataFmHistoryRecord({
      vehicleno: '700-4172', latitude: 14.32, longitude: 100.84,
      tracktime: '2026.08.20 10:39:00', driverrfid: 'OLD-1', drivername: 'Earlier Driver',
    }, 'Asia/Bangkok'),
    normalizeDataFmHistoryRecord({
      vehicleno: '700-4172', latitude: 14.33, longitude: 100.85,
      tracktime: '2026.08.20 10:40:00', driverrfid: 'NEW-2', drivername: 'Latest Driver',
    }, 'Asia/Bangkok'),
  ];
  assert.deepEqual(dataFmDriverIdentity({ positions }), {
    driverId: 'NEW-2',
    driverName: 'Latest Driver',
  });
});

test('resolves a case-insensitive fleet name through the vehicle master before retrying history', async () => {
  resetDataFmTokenCacheForTests();
  const requests = [];
  const fetchImpl = async url => {
    const request = new URL(url);
    requests.push(request);
    if (request.pathname.endsWith('/GetToken')) return jsonResponse({ vResponseCode: 0, token: 'token-1' });
    if (request.pathname.endsWith('/GetMasterVehicleList')) {
      return jsonResponse({ vResponseCode: 0, vTotalRecords: 2, vData: [{ vehicleno: 'Ford T' }, { vehicleno: '700-4172' }] });
    }
    if (request.searchParams.get('vehicleno') === 'FORD T') return jsonResponse({ vResponseCode: 6, vData: '[]' });
    return jsonResponse({ vResponseCode: 0, vTotalRecords: 1, vData: [{
      vehicleno: 'Ford T', latitude: 13.3481683, longitude: 101.030055,
      tracktime: '2026.08.20 10:40:46', speed: 0, bearing: 0,
    }] });
  };
  const result = await fetchDataFmGpsHistory({ ...config, vehicleNumber: 'FORD T', fetchImpl });
  assert.equal(result.status, 'received');
  assert.equal(result.payload.positions.length, 1);
  assert.equal(result.payload.positions[0].vehicleNumber, 'Ford T');
  assert.deepEqual(
    requests.filter(item => item.pathname.endsWith('/GetVehicleHistory')).map(item => item.searchParams.get('vehicleno')),
    ['FORD T', 'Ford T'],
  );
  assert.equal(requests.filter(item => item.pathname.endsWith('/GetMasterVehicleList')).length, 1);
});

test('requires TLS for credentials unless an explicit local-development override is supplied', async () => {
  resetDataFmTokenCacheForTests();
  const result = await fetchDataFmGpsHistory({ ...config, baseUrl: 'http://www.data-fm.com', fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /require HTTPS/);
});
