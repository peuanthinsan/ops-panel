'use client';

import { clearAdminSessionToken, getAdminSessionToken } from './dashboard-session';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL
  || (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

export async function adminFetch(path, options = {}) {
  const token = typeof window !== 'undefined' ? getAdminSessionToken() : '';
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
    throw new Error('Could not reach the Songdee Ops server.');
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
  return data;
}

export async function adminFetchAllReports(filters = {}, maximumReports = 10_000) {
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
    if (reports.length > maximumReports) throw new Error(`Report export exceeds the ${maximumReports.toLocaleString()} row safety limit.`);
    page += 1;
  } while (page <= totalPages);
  return reports;
}
