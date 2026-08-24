import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';
import { handleApiRequest } from '../web/lib/server/api.mjs';
import {
  isCompatibleSongdeeApiHealth,
  SONGDEE_API_CONTRACT_VERSION,
  songdeeApiHealth,
} from '../lib/api-contract.mjs';

test('local and production APIs share an explicit compatibility contract', () => {
  const health = songdeeApiHealth({ database: 'connected' });
  assert.equal(health.apiContractVersion, SONGDEE_API_CONTRACT_VERSION);
  assert.equal(isCompatibleSongdeeApiHealth(health), true);
  assert.equal(isCompatibleSongdeeApiHealth({ ...health, apiContractVersion: 'stale' }), false);
});

test('the Vercel web package is self-contained and its shared logic stays in sync', async () => {
  const sharedFiles = [
    'actions.ts',
    'report-view.ts',
    'report-pagination.ts',
    'dashboard-errors.ts',
    'fleet-admin-state.ts',
    'adapter-url.mjs',
    'api-contract.mjs',
  ];
  for (const file of sharedFiles) {
    const rootSource = await readFile(fileURLToPath(new NodeUrl(`../lib/${file}`, import.meta.url)), 'utf8');
    const webSource = await readFile(fileURLToPath(new NodeUrl(`../web/lib/${file}`, import.meta.url)), 'utf8');
    assert.equal(webSource.trimEnd(), rootSource.trimEnd(), `${file} must match its mobile/shared source`);
  }
  const deploymentBoundaries = [
    ['../web/app/page.jsx', /from ['\"]\.\.\/\.\.\/lib\//],
    ['../web/app/report-dashboard.jsx', /from ['\"]\.\.\/\.\.\/lib\//],
    ['../web/app/timeline-dashboard.jsx', /from ['\"]\.\.\/\.\.\/lib\//],
    ['../web/app/fleet-dashboard.jsx', /from ['\"]\.\.\/\.\.\/lib\//],
    ['../web/app/settings-dashboard.jsx', /from ['\"]\.\.\/\.\.\/lib\//],
    ['../web/app/print/print-dashboard.jsx', /from ['\"]\.\.\/\.\.\/\.\.\/lib\//],
    ['../web/lib/server/api.mjs', /from ['\"]\.\.\/\.\.\/\.\.\/lib\//],
  ] as const;
  for (const [path, forbiddenImport] of deploymentBoundaries) {
    const source = await readFile(fileURLToPath(new NodeUrl(path, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, forbiddenImport, `${path} must not import outside web/`);
  }
});

test('production API rejects oversized JSON before database or adapter work', async () => {
  const response = await handleApiRequest(new Request('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'x'.repeat(70_000) }),
  }), ['admin', 'login']);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Request body is too large' });
});

test('production API reports malformed JSON without reaching the database', async () => {
  const response = await handleApiRequest(new Request('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  }), ['admin', 'login']);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON payload' });
});

test('production external GPS reconciliation never lets a late failed lookup overwrite a received Howen sample', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /gps_sync_samples\.fms_status = 'received' AND EXCLUDED\.fms_status <> 'received'/);
  assert.match(source, /THEN gps_sync_samples\.pair_status ELSE EXCLUDED\.pair_status/);
});

test('production reconciles two external GPS sources by time and exposes an authorized job detail route', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /INSERT INTO gps_sync_samples \([\s\S]*id, job_id, vehicle_number/);
  assert.match(source, /route === 'job-gps-sync'/);
  assert.match(source, /SONGDEE_DEVICE_GPS_API_URL/);
  assert.match(source, /SONGDEE_DATA_FM_USERNAME/);
  assert.match(source, /fetchDataFmGpsHistory\(\{ \.\.\.dataFmOptions\(\), vehicleNumber, targetAt, toleranceMs \}\)/);
  assert.match(source, /SONGDEE_FMS_GPS_API_URL/);
  assert.match(source, /pairExternalGpsSources\(deviceSource\.payload, fmsSource\.payload, targetAt/);
  assert.match(source, /Tablet GPS ingestion has been removed/);
  assert.match(source, /route\.match\(\/\^admin\\\/reports\\\/\(\[\^\/\]\+\)\\\/gps\$\//);
  assert.match(source, /await requireAdmin\(request\)[\s\S]*getJobGpsDetail\(request, reportId\)/);
  assert.match(source, /LEFT JOIN job_gps_summaries gps_summary ON gps_summary\.job_id = report\.id/);
});

test('production driver lookup rejects stale vehicle correlation before calling the adapter', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /requestedVehicleNumber = String\(query\.get\('vehicleNumber'\)/);
  assert.match(source, /requestedVehicleNumber && requestedVehicleNumber !== vehicleNumber[\s\S]*sourceStatus: 'binding_changed'[\s\S]*SONGDEE_DRIVER_IDENTITY_API_URL/);
  assert.match(source, /fetchDataFmDriverIdentity\(\{ \.\.\.dataFmOptions\(\), vehicleNumber \}\)/);
});

test('tablet job history is signed and restricted to its current vehicle binding', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /route === 'device-jobs' && method === 'GET'/);
  assert.match(source, /authenticateDeviceRequest\(request, deviceId\)/);
  assert.match(source, /binding\.vehicleNumber !== vehicleNumber[\s\S]*DEVICE_BINDING_MISMATCH/);
  assert.match(source, /report\.device_id = '\$1'|report\.device_id = \$1/);
  assert.match(source, /lower\(report\.vehicle_number\) = lower\(\$2\)/);
  assert.match(source, /parseDeviceJobHistoryQuery\(searchParams\)/);
  assert.match(source, /LIMIT \$\{limitParameter\} OFFSET \$\{offsetParameter\}/);
});

test('tablet vehicle changes require both the signed device and fleet-admin password', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /route === 'device-config\/rebind' && method === 'POST'/);
  assert.match(source, /authenticateDeviceRequest\(request, deviceId, raw\)/);
  assert.match(source, /consumeRateLimit\(request, 'device-rebind', 8, 15 \* 60, deviceId\)/);
  assert.match(source, /verifyPassword\(password, settings\.admin_password_hash\)/);
  assert.match(source, /saveAdminBinding\(vehicleNumber, deviceId\)/);
});

test('local and production fleet endpoints require explicit device correlation and align idempotent setup responses', async () => {
  const local = await readFile(fileURLToPath(new NodeUrl('../server.js', import.meta.url)), 'utf8');
  const production = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(local, /query\.get\('deviceId'\) \|\| deviceConfig\?\.deviceId/);
  assert.match(production, /deviceConfig: existing,[\s\S]{0,240}deduplicated: true/);
  assert.match(production, /'Active' AS status/);
});

test('production schema serializes active jobs against binding changes', async () => {
  const schema = await readFile(fileURLToPath(new NodeUrl('../db/schema.sql', import.meta.url)), 'utf8');
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(schema, /CONSTRAINT active_jobs_current_binding_fk/);
  assert.match(schema, /FOREIGN KEY \(device_id, vehicle_number\)[\s\S]*REFERENCES device_bindings \(device_id, vehicle_number\)[\s\S]*ON UPDATE RESTRICT[\s\S]*ON DELETE RESTRICT/);
  assert.match(source, /error\?\.code === '23503'[\s\S]*active_jobs_current_binding_fk/);
  assert.match(source, /route === 'admin\/device-config' && request\.method === 'POST'[\s\S]*active job before changing/);
  assert.match(source, /route === 'admin\/device-config' && request\.method === 'DELETE'[\s\S]*active job before removing/);
});

test('production binding history uses an exclusive unbound boundary', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /unbound_at IS NULL OR unbound_at > \$\{occurredAt\}::timestamptz/);
  assert.doesNotMatch(source, /unbound_at IS NULL OR unbound_at >= \$\{occurredAt\}::timestamptz/);
});

test('production password changes compare and replace the current hash atomically', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(source, /WITH password_change AS \([\s\S]*AND setting_value = \$\{settings\.admin_password_hash\}[\s\S]*auth_change AS/);
  assert.match(source, /if \(!changed\?\.passwordChanged \|\| !changed\?\.authChanged\)[\s\S]*new ApiError\(401/);
});
