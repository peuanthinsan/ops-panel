'use client';

import { clearAdminSessionToken, getAdminSessionToken } from './dashboard-session.js';
import { readOfflineResponse, writeOfflineResponse } from './offline-store.js';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL
  || (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

export async function adminFetch(path, options = {}) {
  const token = typeof window !== 'undefined' ? getAdminSessionToken() : '';
  const isGet = (options.method || 'GET').toUpperCase() === 'GET';
  const isLocalPreview = process.env.NODE_ENV === 'development'
    && typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const cacheKey = String(path);
  const useOfflineCache = isGet && options.cacheOffline !== false;
  const offlineFallback = async (message) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('songdee-offline-data', { detail: { path: cacheKey, hasCache: false } }));
    if (useOfflineCache) {
      const cached = await readOfflineResponse(cacheKey);
      if (cached !== null) {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('songdee-offline-data', { detail: { path: cacheKey, hasCache: true } }));
        return cached;
      }
    }
    throw new Error(message);
  };
  if (isGet && !isLocalPreview && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return offlineFallback('Offline and no cached dashboard data is available.');
  }
  if (!isGet && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Offline. Changes cannot be saved until the connection returns.');
  }
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 8000);
  let response;

  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-admin-token': token } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    if (externalSignal?.aborted) {
      const error = new Error('Request cancelled');
      error.name = 'AbortError';
      throw error;
    }
    return offlineFallback('Could not reach the Songdee Ops server.');
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && typeof window !== 'undefined') {
    clearAdminSessionToken();
    window.dispatchEvent(new Event('songdee-auth-expired'));
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  if (useOfflineCache) {
    await writeOfflineResponse(cacheKey, data);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('songdee-online-data'));
  }
  return data;
}

export async function adminFetchAllReports(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const text = String(value || '').trim();
    if (text) params.set(key, text);
  }
  params.set('pageSize', '100');
  const reports = [];
  let page = 1;
  let totalPages = 1;
  do {
    params.set('page', String(page));
    const result = await adminFetch(`/api/reports?${params}`);
    reports.push(...(Array.isArray(result.reports) ? result.reports : []));
    totalPages = Math.max(1, Number(result.pageInfo?.totalPages || 1));
    page += 1;
  } while (page <= totalPages);
  return reports;
}

export async function adminFetchReportGpsSamples(reportId, { signal } = {}) {
  const samples = [];
  const pageSize = 200;
  let page = 1;
  let totalPages = 1;
  do {
    const result = await adminFetch(`/api/admin/reports/${encodeURIComponent(reportId)}/gps?page=${page}&pageSize=${pageSize}`, { signal });
    samples.push(...(Array.isArray(result.samples) ? result.samples : []));
    totalPages = Math.max(1, Number(result.pageInfo?.totalPages || 1));
    page += 1;
  } while (page <= totalPages);
  return samples;
}
