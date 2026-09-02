'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminFetchReportGpsData } from './dashboard-api';

const reportGpsCache = new Map();
const loadConcurrency = 4;

export function useReportSpeedSeries(reports = []) {
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

  return state.requestKey === requestKey
    ? state
    : { samplesByReportId: {}, routeDeviationByReportId: {}, loading: Boolean(eligibleReports.length), failedReports: 0 };
}
