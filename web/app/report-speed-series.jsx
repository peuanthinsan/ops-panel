'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { adminFetchReportGpsData, adminFetchReportTelemetry } from './dashboard-api';

const reportGpsCache = new Map();
const reportTelemetryCache = new Map();
const loadConcurrency = 4;
const telemetryCacheLifetimeMs = 60_000;
const emptyReports = [];

function useReportTelemetry(reports) {
  // Fuel history is available even when no tablet GPS samples were saved.
  const requests = useMemo(() => [...new Map(reports.filter(report => report?.id && report.vehicleNumber && report.startTime && report.endTime)
    .map(report => [report.id, {
      id: report.id,
      key: JSON.stringify([report.id, report.vehicleNumber, report.startTime, report.endTime]),
    }])).values()], [reports]);
  const requestKey = requests.map(request => request.key).sort().join('|');
  const [state, setState] = useState({ requestKey: '', telemetryByReportId: {}, telemetryLoading: false });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const loadingRef = useRef(false);
  const lastLoadedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadingRef.current = true;
    const cached = Object.fromEntries(requests.flatMap(request => {
      const entry = reportTelemetryCache.get(request.key);
      return entry?.expiresAt > Date.now() ? [[request.id, entry.data]] : [];
    }));
    setState({ requestKey, telemetryByReportId: cached, telemetryLoading: requests.some(request => !cached[request.id]) });
    async function load() {
      const next = { ...cached };
      const pending = requests.filter(request => !cached[request.id]);
      // Bound upstream fan-out independently of the existing GPS/alert reads.
      for (let start = 0; start < pending.length; start += 2) {
        const batch = await Promise.all(pending.slice(start, start + 2).map(async request => {
          let data;
          try {
            data = await adminFetchReportTelemetry(request.id, { signal: controller.signal });
            if (!Array.isArray(data?.samples)) throw new Error('Invalid telemetry response');
            if (data.status === 'received') {
              reportTelemetryCache.delete(request.key);
              reportTelemetryCache.set(request.key, { data, expiresAt: Date.now() + telemetryCacheLifetimeMs });
              while (reportTelemetryCache.size > 100) reportTelemetryCache.delete(reportTelemetryCache.keys().next().value);
            }
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
            data = { status: 'unavailable', samples: [], source: 'data-fm', fuelUnit: null };
          }
          return [request.id, data];
        }));
        if (!active) return;
        Object.assign(next, Object.fromEntries(batch));
        setState({ requestKey, telemetryByReportId: { ...next }, telemetryLoading: start + 2 < pending.length });
      }
      if (active) setState({ requestKey, telemetryByReportId: next, telemetryLoading: false });
    }
    void load().catch(() => {
      if (active) setState({ requestKey, telemetryByReportId: cached, telemetryLoading: false });
    }).finally(() => {
      if (active) { loadingRef.current = false; lastLoadedAt.current = Date.now(); }
    });
    return () => { active = false; loadingRef.current = false; controller.abort(); };
    // Keep an unchanged queue running when the dashboard refreshes report objects.
  }, [requestKey, refreshVersion]);

  useEffect(() => {
    // Revalidate on a later report refresh after the current queue has completed.
    // Printed reports do not poll or disappear while someone is reviewing them.
    if (!loadingRef.current && lastLoadedAt.current && Date.now() - lastLoadedAt.current >= telemetryCacheLifetimeMs) {
      setRefreshVersion(value => value + 1);
    }
  }, [requests]);

  return state.requestKey === requestKey ? state : { telemetryByReportId: {}, telemetryLoading: requests.length > 0 };
}

export function useReportSpeedSeries(reports = emptyReports) {
  const telemetry = useReportTelemetry(reports);
  const eligibleReports = useMemo(() => {
    const unique = new Map();
    for (const report of reports) {
      if (!report?.id || Number(report.deviceGpsSamples) <= 0) continue;
      unique.set(report.id, report);
    }
    return [...unique.values()];
  }, [reports]);
  const requestKey = eligibleReports.map(report => `${report.id}:${Number(report.deviceGpsSamples) || 0}:${report.routeName || ''}`).sort().join('|');
  const [state, setState] = useState({ requestKey: '', samplesByReportId: {}, routeDeviationByReportId: {}, loading: false, failedReports: 0 });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!eligibleReports.length) {
      setState({ requestKey, samplesByReportId: {}, routeDeviationByReportId: {}, loading: false, failedReports: 0 });
      return () => controller.abort();
    }

    const cachedData = Object.fromEntries(eligibleReports.flatMap(report => {
      const cacheKey = `${report.id}:${Number(report.deviceGpsSamples) || 0}:${report.routeName || ''}`;
      return reportGpsCache.has(cacheKey) ? [[report.id, reportGpsCache.get(cacheKey)]] : [];
    }));
    const cachedSamples = Object.fromEntries(Object.entries(cachedData).map(([reportId, data]) => [reportId, data.samples]));
    const cachedRouteDeviations = Object.fromEntries(Object.entries(cachedData).map(([reportId, data]) => [reportId, data.routeDeviation]));
    setState({ requestKey, samplesByReportId: cachedSamples, routeDeviationByReportId: cachedRouteDeviations, loading: true, failedReports: 0 });

    async function load() {
      const nextSamples = { ...cachedSamples };
      const nextRouteDeviations = { ...cachedRouteDeviations };
      let failedReports = 0;
      for (let start = 0; start < eligibleReports.length; start += loadConcurrency) {
        const batch = eligibleReports.slice(start, start + loadConcurrency);
        const results = await Promise.all(batch.map(async report => {
          const cacheKey = `${report.id}:${Number(report.deviceGpsSamples) || 0}:${report.routeName || ''}`;
          if (reportGpsCache.has(cacheKey)) return { reportId: report.id, data: reportGpsCache.get(cacheKey) };
          try {
            const data = await adminFetchReportGpsData(report.id, { signal: controller.signal });
            reportGpsCache.set(cacheKey, data);
            while (reportGpsCache.size > 100) reportGpsCache.delete(reportGpsCache.keys().next().value);
            return { reportId: report.id, data };
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return { reportId: report.id, data: { samples: [], routeDeviation: null }, failed: true };
          }
        }));
        if (!active) return;
        for (const result of results) {
          nextSamples[result.reportId] = result.data.samples;
          nextRouteDeviations[result.reportId] = result.data.routeDeviation;
          if (result.failed) failedReports += 1;
        }
        setState({ requestKey, samplesByReportId: { ...nextSamples }, routeDeviationByReportId: { ...nextRouteDeviations }, loading: true, failedReports });
      }
      if (active) setState({ requestKey, samplesByReportId: nextSamples, routeDeviationByReportId: nextRouteDeviations, loading: false, failedReports });
    }

    void load().catch(error => {
      if (active && error?.name !== 'AbortError') setState({ requestKey, samplesByReportId: cachedSamples, routeDeviationByReportId: cachedRouteDeviations, loading: false, failedReports: eligibleReports.length });
    });
    return () => { active = false; controller.abort(); };
  }, [requestKey]);

  const gps = state.requestKey === requestKey
    ? state
    : { samplesByReportId: {}, routeDeviationByReportId: {}, loading: Boolean(eligibleReports.length), failedReports: 0 };
  return { ...gps, telemetryByReportId: telemetry.telemetryByReportId, telemetryLoading: telemetry.telemetryLoading };
}
