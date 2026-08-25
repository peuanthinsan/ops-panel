'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminFetchReportGpsSamples } from './dashboard-api';

const speedSampleCache = new Map();
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
  const requestKey = eligibleReports.map(report => `${report.id}:${Number(report.deviceGpsSamples) || 0}`).sort().join('|');
  const [state, setState] = useState({ requestKey: '', samplesByReportId: {}, loading: false, failedReports: 0 });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!eligibleReports.length) {
      setState({ requestKey, samplesByReportId: {}, loading: false, failedReports: 0 });
      return () => controller.abort();
    }

    const cachedSamples = Object.fromEntries(eligibleReports.flatMap(report => {
      const cacheKey = `${report.id}:${Number(report.deviceGpsSamples) || 0}`;
      return speedSampleCache.has(cacheKey) ? [[report.id, speedSampleCache.get(cacheKey)]] : [];
    }));
    setState({ requestKey, samplesByReportId: cachedSamples, loading: true, failedReports: 0 });

    async function load() {
      const nextSamples = { ...cachedSamples };
      let failedReports = 0;
      for (let start = 0; start < eligibleReports.length; start += loadConcurrency) {
        const batch = eligibleReports.slice(start, start + loadConcurrency);
        const results = await Promise.all(batch.map(async report => {
          const cacheKey = `${report.id}:${Number(report.deviceGpsSamples) || 0}`;
          if (speedSampleCache.has(cacheKey)) return { reportId: report.id, samples: speedSampleCache.get(cacheKey) };
          try {
            const samples = await adminFetchReportGpsSamples(report.id, { signal: controller.signal });
            speedSampleCache.set(cacheKey, samples);
            return { reportId: report.id, samples };
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return { reportId: report.id, samples: [], failed: true };
          }
        }));
        if (!active) return;
        for (const result of results) {
          nextSamples[result.reportId] = result.samples;
          if (result.failed) failedReports += 1;
        }
        setState({ requestKey, samplesByReportId: { ...nextSamples }, loading: true, failedReports });
      }
      if (active) setState({ requestKey, samplesByReportId: nextSamples, loading: false, failedReports });
    }

    void load().catch(error => {
      if (active && error?.name !== 'AbortError') setState({ requestKey, samplesByReportId: cachedSamples, loading: false, failedReports: eligibleReports.length });
    });
    return () => { active = false; controller.abort(); };
  }, [requestKey]);

  return state.requestKey === requestKey
    ? state
    : { samplesByReportId: {}, loading: Boolean(eligibleReports.length), failedReports: 0 };
}
