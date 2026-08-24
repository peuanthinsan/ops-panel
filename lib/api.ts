import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { resolveApiBase } from './api-base';
import { SongdeeApiError } from './api-error';
import { createDeviceRequestHeaders, parseDeviceCredential, type DeviceAuthStatus, type DeviceCredential } from './device-auth';
import { getDeviceCredential, persistDeviceCredential, type DeviceBinding } from './device';
import { normalizeDriverIdentityLookup } from './driver-identity';
import type { JobStartInput } from './job-start';
import type { JobReportInput } from './report';
import { normalizeVehicleMotion } from './motion-state';
import { observeServerTime, serverNowMs } from './server-clock';
import type { SavedJob } from './saved-jobs';
import { deviceJobHistorySearchParams, type DeviceJobHistoryResponse } from './device-job-history';
import type { MobileJobQuery } from './mobile-job-query';

// EXPO_PUBLIC_API_URL always wins in deployed builds. During local Expo
// development, hostUri lets both physical tablets and emulators reach the
// machine that is running the API without hard-coding its LAN address.
const API_BASE = resolveApiBase(process.env.EXPO_PUBLIC_API_URL, Constants.expoConfig?.hostUri, __DEV__);
if (__DEV__) console.info(`[Songdee Ops] API base: ${API_BASE}`);

type ApiFailure = { message: string; code?: string };
type BindingEnvelope = {
  deviceConfig: DeviceBinding | null;
  deviceAuth?: DeviceAuthStatus;
  deviceCredential?: DeviceCredential;
};

let deviceCredentialPromise: Promise<DeviceCredential | null> | null = null;

function cachedDeviceCredential() {
  if (!deviceCredentialPromise) {
    deviceCredentialPromise = getDeviceCredential().catch(error => {
      deviceCredentialPromise = null;
      throw error;
    });
  }
  return deviceCredentialPromise;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestStartedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    observeServerTime(
      response.headers.get('x-songdee-server-time') || response.headers.get('date'),
      requestStartedAt,
      Date.now(),
    );
    return response;
  }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Songdee GPS server timed out');
    throw new Error('Songdee GPS server is unreachable');
  } finally { clearTimeout(timer); }
}

async function errorFrom(response: Response, fallback: string): Promise<ApiFailure> {
  try {
    const data = await response.json();
    return { message: data.error || fallback, code: typeof data.code === 'string' ? data.code : undefined };
  } catch { return { message: fallback }; }
}

async function responseError(response: Response, fallback: string) {
  const failure = await errorFrom(response, fallback);
  return new SongdeeApiError(response.status, failure.message, failure.code);
}

async function deviceFetch(path: string, init: RequestInit = {}, timeoutMs = 5000) {
  const method = String(init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  const credential = await cachedDeviceCredential().catch(() => null);
  const send = () => fetchWithTimeout(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(credential ? createDeviceRequestHeaders(credential, method, path, String(Math.round(serverNowMs())), Crypto.randomUUID(), body) : {}),
        ...(init.headers || {}),
      },
    }, timeoutMs);
  const response = await send();
  if (!credential || response.status !== 401) return response;
  const responseCode = response.headers.get('x-songdee-error-code')
    || (await errorFrom(response.clone(), '')).code;
  return responseCode === 'DEVICE_CLOCK_SKEW' ? send() : response;
}

async function storeIssuedCredential(value: unknown) {
  const credential = parseDeviceCredential(value);
  if (!credential) return null;
  await persistDeviceCredential(credential);
  deviceCredentialPromise = Promise.resolve(credential);
  return credential;
}

async function claimDeviceCredential(binding: DeviceBinding) {
  const body = JSON.stringify(binding);
  const response = await fetchWithTimeout(`${API_BASE}/api/device-credentials/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!response.ok) throw await responseError(response, 'Device access must be reset from Fleet admin');
  const data = await response.json();
  const credential = await storeIssuedCredential(data.deviceCredential);
  if (!credential) throw new SongdeeApiError(503, 'The server did not issue a valid device credential');
  return credential;
}

async function reconcileDeviceCredential(binding: DeviceBinding, status?: DeviceAuthStatus) {
  // The JSON development server intentionally omits deviceAuth and remains
  // compatible with unsigned local Expo sessions.
  if (!status) return;
  const stored = await cachedDeviceCredential().catch(() => null);
  if (stored && status.keyId === stored.keyId) return;
  if (status.enforced) {
    throw new SongdeeApiError(401, 'Device access must be reset from Fleet admin', 'DEVICE_ACCESS_RESET_REQUIRED');
  }
  await claimDeviceCredential(binding);
}

export async function saveVehicleBinding(binding: DeviceBinding) {
  const body = JSON.stringify(binding);
  const response = await deviceFetch('/api/device-config', { method: 'POST', body });
  if (!response.ok) throw await responseError(response, response.status === 409 ? 'Device is already connected' : 'Could not save vehicle binding');
  const data = await response.json() as BindingEnvelope;
  if (data.deviceCredential) await storeIssuedCredential(data.deviceCredential);
  return data;
}

export async function changeVehicleBindingWithAdminPassword(binding: DeviceBinding, password: string) {
  const body = JSON.stringify({ ...binding, password });
  const response = await deviceFetch('/api/device-config/rebind', { method: 'POST', body }, 8000);
  if (!response.ok) throw await responseError(response, response.status === 401 ? 'Invalid password' : 'Could not change vehicle binding');
  const data = await response.json() as BindingEnvelope;
  if (!data.deviceConfig
    || data.deviceConfig.deviceId !== binding.deviceId
    || data.deviceConfig.vehicleNumber !== binding.vehicleNumber) {
    throw new Error('The server returned an invalid vehicle binding');
  }
  return data.deviceConfig;
}

export async function fetchVehicleBinding(deviceId: string) {
  const path = `/api/device-config?deviceId=${encodeURIComponent(deviceId)}`;
  const response = await deviceFetch(path);
  if (!response.ok) throw await responseError(response, 'Could not load vehicle binding');
  const data = await response.json() as BindingEnvelope;
  if (data.deviceConfig) await reconcileDeviceCredential(data.deviceConfig, data.deviceAuth);
  return data.deviceConfig;
}

export async function fetchDriverIdentity(deviceId: string, vehicleNumber: string) {
  const query = new URLSearchParams({ deviceId, vehicleNumber });
  const path = `/api/driver-identity?${query.toString()}`;
  const response = await deviceFetch(path);
  if (!response.ok) throw await responseError(response, 'Could not load driver identity');
  return normalizeDriverIdentityLookup(await response.json());
}

export async function fetchVehicleMotion(deviceId: string) {
  const path = `/api/vehicle-motion?deviceId=${encodeURIComponent(deviceId)}`;
  const response = await deviceFetch(path);
  if (!response.ok) throw await responseError(response, 'Could not load vehicle motion');
  return normalizeVehicleMotion(await response.json());
}

export async function saveJobStart(jobStart: JobStartInput) {
  const body = JSON.stringify(jobStart);
  const response = await deviceFetch('/api/job-starts', { method: 'POST', body }, 8000);
  if (!response.ok) throw await responseError(response, 'Could not save job start');
  return response.json();
}

export async function saveJob(job: JobReportInput) {
  const body = JSON.stringify(job);
  const response = await deviceFetch('/api/reports', { method: 'POST', body }, 8000);
  if (!response.ok) throw await responseError(response, 'Could not save job');
  return response.json();
}

export type JobGpsSyncRequest = {
  jobId: string;
  vehicleNumber: string;
  deviceId: string;
  targetAt: string;
};

export async function requestJobGpsSync(input: JobGpsSyncRequest) {
  const body = JSON.stringify(input);
  const response = await deviceFetch('/api/job-gps-sync', { method: 'POST', body }, 12_000);
  if (!response.ok) throw await responseError(response, 'Could not reconcile job GPS');
  return response.json();
}

export async function fetchDeviceJobs(deviceId: string, vehicleNumber: string, historyQuery: MobileJobQuery, page = 1) {
  const query = deviceJobHistorySearchParams(historyQuery, page);
  query.set('deviceId', deviceId);
  query.set('vehicleNumber', vehicleNumber);
  const path = `/api/device-jobs?${query.toString()}`;
  const response = await deviceFetch(path, {}, 8000);
  if (!response.ok) throw await responseError(response, 'Could not load saved jobs');
  const data = await response.json() as Partial<DeviceJobHistoryResponse>;
  if (!Array.isArray(data.jobs) || !data.pageInfo || !data.summary) throw new Error('The saved-job response is invalid');
  return {
    jobs: data.jobs as SavedJob[],
    facets: { months: Array.isArray(data.facets?.months) ? data.facets.months : [] },
    pageInfo: data.pageInfo,
    summary: data.summary,
  } as DeviceJobHistoryResponse;
}
