import { useEffect, useRef, useState } from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { AccessibilityInfo, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileJobReport } from '../components/MobileJobReport';
import { RedGpsPin } from '../components/RedGpsPin';
import { operationActions } from '../lib/actions';
import { changeVehicleBindingWithAdminPassword, fetchDeviceJobs, fetchDriverIdentity, fetchJobRoutes, fetchVehicleBinding, fetchVehicleMotion, requestJobGpsSync, saveJob, saveJobStart, saveVehicleBinding, type JobRouteOption } from '../lib/api';
import { isDeviceAccessError, isRetryableApiError } from '../lib/api-error';
import { clearActiveJob, clearBinding, finalizeActiveJob, getActiveJob, getBinding, getDeviceId, persistActiveJob, persistBinding, type ActiveJob, type DeviceBinding } from '../lib/device';
import { activeJobBelongsToBinding, deviceBindingKey, mobileStartupReady, recoverBindingFromActiveJob, shouldPreserveLocalBindingWithoutRemote } from '../lib/device-state';
import { driverHeaderText } from '../lib/driver-display';
import { driverLookupBelongsToBinding } from '../lib/driver-identity';
import { deliverJobReport } from '../lib/job-delivery';
import { createJobId, decideAction, isActionUnavailable, jobInitiatedAt, reportDriver, snapshotDriver, type DriverIdentity } from '../lib/job-flow';
import { emptyDeviceJobHistory, type DeviceJobHistoryResponse, type DeviceJobHistorySummary } from '../lib/device-job-history';
import { enqueueJobReport, listPendingJobReports, listStoredJobReportsPage, markPendingJobReportPermanentFailure, removePendingJobReport } from '../lib/job-outbox';
import { enqueueJobStart, listPendingJobStarts, markPendingJobStartPermanentFailure, removePendingJobStart } from '../lib/job-start-outbox';
import { useLanguage } from '../lib/language';
import { mobileOperationErrorMessage } from '../lib/mobile-error-copy';
import type { MobileJobQuery } from '../lib/mobile-job-query';
import { usesCompactLandscapeLayout } from '../lib/mobile-layout';
import { mobileReportDayKey } from '../lib/mobile-report';
import { motionStartsJob } from '../lib/motion-state';
import { cancellationReportForIntent, finalReportForIntent } from '../lib/report-recovery';
import type { JobStartInput } from '../lib/job-start';
import type { JobReportInput } from '../lib/report';
import { serverNowMs } from '../lib/server-clock';
import { mergeSavedJobs, type SavedJob } from '../lib/saved-jobs';
import { GPS_SYNC_INTERVAL_MS } from '../lib/gps-sample';

const actions = operationActions;
const ACTION_COLUMN_COUNT = 3;
const actionRows = Array.from(
  { length: Math.ceil(actions.length / ACTION_COLUMN_COUNT) },
  (_, index) => actions.slice(index * ACTION_COLUMN_COUNT, (index + 1) * ACTION_COLUMN_COUNT),
);
const initialJobHistoryQuery: MobileJobQuery = { dayKey: null, endAt: null, startAt: null, monthKey: null, mode: null, search: '', sort: 'newest', status: 'all' };

function combinedJobSummary(left: DeviceJobHistorySummary, right: DeviceJobHistorySummary): DeviceJobHistorySummary {
  return {
    total: left.total + right.total,
    completed: left.completed + right.completed,
    cancelled: left.cancelled + right.cancelled,
    durationSeconds: left.durationSeconds + right.durationSeconds,
  };
}

function scheduleIdleTask(task: () => void) {
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const callbackId = requestIdleCallback(task, { timeout: 1000 });
    return () => cancelIdleCallback(callbackId);
  }
  const timeoutId = setTimeout(task, 0);
  return () => clearTimeout(timeoutId);
}

export default function Index() {
  useKeepAwake('songdee-ops-panel');
  const { language, setLanguage, t } = useLanguage();
  const { width, height, fontScale } = useWindowDimensions();
  const portrait = height > width;
  const largeText = fontScale >= 1.3;
  const compactLandscape = !largeText && usesCompactLandscapeLayout(width, height);
  const [binding, setBinding] = useState<DeviceBinding | null>(null);
  const [bindingChecked, setBindingChecked] = useState(false);
  const [deviceAccessBlocked, setDeviceAccessBlocked] = useState(false);
  const [bindingRefreshToken, setBindingRefreshToken] = useState(0);
  const [recoveredBindingKey, setRecoveredBindingKey] = useState<string | null>(null);
  const [driverIdentity, setDriverIdentity] = useState<DriverIdentity>(null);
  const [jobDriverIdentity, setJobDriverIdentity] = useState<DriverIdentity>(null);
  const [vehicleInput, setVehicleInput] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [routeOptions, setRouteOptions] = useState<JobRouteOption[]>([]);
  const [selectedRouteName, setSelectedRouteName] = useState<string | null>(null);
  const [routesVisible, setRoutesVisible] = useState(false);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState('');
  const [routeSearch, setRouteSearch] = useState('');
  const [routesHasMore, setRoutesHasMore] = useState(false);
  const routeSearchRequestRef = useRef(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [awaitingMovement, setAwaitingMovement] = useState(false);
  const [pendingReport, setPendingReport] = useState<JobReportInput | null>(null);
  const [confirmType, setConfirmType] = useState<'start' | 'finish' | 'day_end' | 'cancel' | null>(null);
  const [message, setMessage] = useState('');
  const [savingSetup, setSavingSetup] = useState(false);
  const [startingJob, setStartingJob] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [jobsVisible, setJobsVisible] = useState(false);
  const [reportDay, setReportDay] = useState<string | null>(null);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);
  const [jobHistory, setJobHistory] = useState<DeviceJobHistoryResponse>(emptyDeviceJobHistory);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [vehicleAdminVisible, setVehicleAdminVisible] = useState(false);
  const [vehicleAdminInput, setVehicleAdminInput] = useState('');
  const [vehicleAdminPassword, setVehicleAdminPassword] = useState('');
  const [vehicleAdminError, setVehicleAdminError] = useState('');
  const [changingVehicle, setChangingVehicle] = useState(false);
  const pendingReportRef = useRef<JobReportInput | null>(null);
  const confirmationTitleRef = useRef<Text | null>(null);
  const vehicleAdminTitleRef = useRef<Text | null>(null);
  const headerTitleRef = useRef<Text | null>(null);
  const vehicleAdminButtonRef = useRef<View | null>(null);
  const savedJobsButtonRef = useRef<View | null>(null);
  const actionButtonRefs = useRef<Record<string, View | null>>({});
  const confirmationTriggerNodeRef = useRef<number | null>(null);
  const vehicleAdminTriggerNodeRef = useRef<number | null>(null);
  const savedJobsTriggerNodeRef = useRef<number | null>(null);
  const focusRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobHistoryQueryRef = useRef<MobileJobQuery>(initialJobHistoryQuery);
  const jobHistoryRequestRef = useRef(0);
  const recordedGpsSyncJobsRef = useRef(new Map<string, { jobId: string; vehicleNumber: string; deviceId: string; targetAt: string }>());

  const updatePendingReport = (report: JobReportInput | null) => {
    pendingReportRef.current = report;
    setPendingReport(report);
  };

  const focusConfirmationTitle = () => {
    if (focusRestoreTimerRef.current) {
      clearTimeout(focusRestoreTimerRef.current);
      focusRestoreTimerRef.current = null;
    }
    const node = findNodeHandle(confirmationTitleRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };

  const rememberConfirmationTrigger = (view: View | null) => {
    confirmationTriggerNodeRef.current = findNodeHandle(view);
  };

  const restoreFocusToNode = (node: number | null) => {
    if (!node) return;
    if (focusRestoreTimerRef.current) clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = setTimeout(() => {
      AccessibilityInfo.setAccessibilityFocus(node);
      focusRestoreTimerRef.current = null;
    }, 100);
  };

  const restoreConfirmationTriggerFocus = () => restoreFocusToNode(confirmationTriggerNodeRef.current);

  const focusVehicleAdminTitle = () => {
    const node = findNodeHandle(vehicleAdminTitleRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };

  useEffect(() => () => {
    if (focusRestoreTimerRef.current) clearTimeout(focusRestoreTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    const initializeBinding = async () => {
      setDeviceAccessBlocked(false);
      let local: DeviceBinding | null = null;
      let localJob: ActiveJob | null = null;
      try {
        [local, localJob] = await Promise.all([getBinding(), getActiveJob()]);
      } catch { /* Continue with the Android identifier if local storage is unavailable. */ }
      if (!active) return;
      const storedBinding = local;
      local = recoverBindingFromActiveJob(localJob, local);
      setBinding(local);
      // A valid local binding can render immediately while authoritative server
      // reconciliation continues in the background. Signed writes still fail
      // safely if Fleet admin revoked or changed the device.
      if (local) setBindingChecked(true);
      const preserveLocalBinding = shouldPreserveLocalBindingWithoutRemote(localJob, local);
      if (preserveLocalBinding) {
        if (!storedBinding && local) {
          await persistBinding(local).catch(() => { /* The active job still supplies the binding for this session. */ });
        }
        setBindingChecked(true);
        return;
      }
      try {
        const deviceId = local?.deviceId ?? localJob?.deviceId ?? await getDeviceId();
        const remote = await fetchVehicleBinding(deviceId);
        if (!active) return;
        if (remote) {
          setBinding(remote);
          await persistBinding(remote).catch(() => { /* The live remote binding remains usable for this session. */ });
        } else {
          setBinding(null);
          await clearBinding().catch(() => { /* The next startup will reconcile the stale local copy again. */ });
        }
      } catch (error) {
        if (active && isDeviceAccessError(error)) setDeviceAccessBlocked(true);
        /* Keep the last local binding when the API is unavailable. */
      }
      finally { if (active) setBindingChecked(true); }
    };
    void initializeBinding();
    return () => { active = false; };
  }, [bindingRefreshToken]);

  useEffect(() => {
    if (!binding) {
      setRecoveredBindingKey(null);
      return;
    }
    let mounted = true;
    const bindingKey = deviceBindingKey(binding);
    getActiveJob().then(storedJob => {
      if (!mounted) return;
      if (activeJobBelongsToBinding(storedJob, binding) && storedJob) {
        const restoredJobId = storedJob.jobId ?? createJobId(storedJob.deviceId, storedJob.selected, storedJob.startedAt || serverNowMs());
        setSelected(storedJob.selected);
        setSelectedRouteName(storedJob.routeName || storedJob.pendingReport?.routeName || null);
        setActiveJobId(restoredJobId);
        setStartedAt(storedJob.startedAt || null);
        setAwaitingMovement(Boolean(storedJob.awaitingMovement));
        updatePendingReport(storedJob.pendingReport ?? null);
        const restoredDriver = snapshotDriver({ driverName: storedJob.driverName, driverId: storedJob.driverId });
        setJobDriverIdentity(restoredDriver);
        if (!storedJob.jobId) void persistActiveJob({ ...storedJob, jobId: restoredJobId }).catch(() => { /* Older active jobs remain usable if migration persistence fails. */ });
        if (storedJob.startedAt) void queueJobStartForSync({ id: restoredJobId, vehicleNumber: storedJob.vehicleNumber, deviceId: storedJob.deviceId, driverName: restoredDriver?.driverName ?? null, driverId: restoredDriver?.driverId ?? null, mode: actionLabel(storedJob.selected, 'en'), routeName: storedJob.routeName || storedJob.pendingReport?.routeName || null, startTime: new Date(storedJob.startedAt).toISOString() });
        setMessage(storedJob.pendingReport
          ? storedJob.pendingReport.status === 'Cancelled'
            ? (language === 'en' ? 'Cancellation restored — retry saving it' : 'กู้คืนการยกเลิกงาน — กรุณาลองบันทึกอีกครั้ง')
            : (language === 'en' ? 'Completed job restored — tap the active job to retry saving it' : 'กู้คืนงานที่จบแล้ว — กดกิจกรรมที่กำลังทำเพื่อลองบันทึกอีกครั้ง')
          : (language === 'en' ? 'Active job restored' : 'กู้คืนงานที่กำลังทำอยู่'));
      } else if (storedJob) {
        setActiveJobId(null);
        setJobDriverIdentity(null);
        updatePendingReport(null);
        return clearActiveJob();
      }
    }).catch(() => { /* A missing local job should not block the control panel. */ })
      .finally(() => { if (mounted) setRecoveredBindingKey(bindingKey); });
    return () => { mounted = false; };
  }, [binding?.vehicleNumber, binding?.deviceId]);

  useEffect(() => {
    if (!binding) return;
    let active = true;
    const refreshBinding = async () => {
      if (startedAt || pendingReport) return;
      try {
        const remote = await fetchVehicleBinding(binding.deviceId);
        if (!active) return;
        if (!remote) {
          await Promise.all([
            clearBinding().catch(() => { /* The live server state still takes precedence for this session. */ }),
            awaitingMovement ? clearActiveJob().catch(() => { /* A stale waiting job is rejected on the next startup reconciliation. */ }) : Promise.resolve(),
          ]);
          setBinding(null);
          setDriverIdentity(null);
          setJobDriverIdentity(null);
          setSelected(null);
          setSelectedRouteName(null);
          setActiveJobId(null);
          setStartedAt(null);
          setAwaitingMovement(false);
          updatePendingReport(null);
          setConfirmType(null);
          setMessage(language === 'en' ? 'Vehicle connection removed by admin' : 'ผู้ดูแลระบบยกเลิกการเชื่อมต่อรถแล้ว');
          return;
        }
        if (remote.vehicleNumber !== binding.vehicleNumber) {
          await Promise.all([
            persistBinding(remote).catch(() => { /* The live server state remains usable for this session. */ }),
            awaitingMovement ? clearActiveJob().catch(() => { /* A stale waiting job is rejected on the next startup reconciliation. */ }) : Promise.resolve(),
          ]);
          setBinding(remote);
          setDriverIdentity(null);
          setJobDriverIdentity(null);
          setSelected(null);
          setSelectedRouteName(null);
          setActiveJobId(null);
          setStartedAt(null);
          setAwaitingMovement(false);
          updatePendingReport(null);
          setConfirmType(null);
          setMessage(language === 'en' ? 'Vehicle connection updated by admin' : 'ผู้ดูแลระบบอัปเดตการเชื่อมต่อรถแล้ว');
        }
      } catch (error) {
        if (active && isDeviceAccessError(error)) setDeviceAccessBlocked(true);
        /* Keep the current binding during a temporary API outage. */
      }
    };
    const timer = setInterval(refreshBinding, awaitingMovement ? 5000 : 30000);
    return () => { active = false; clearInterval(timer); };
  }, [binding?.deviceId, binding?.vehicleNumber, startedAt, awaitingMovement, pendingReport, language]);

  useEffect(() => {
    if (!binding) return;
    let active = true;
    setDriverIdentity(null);
    const refresh = async () => {
      try {
        const lookup = await fetchDriverIdentity(binding.deviceId, binding.vehicleNumber);
        if (active && driverLookupBelongsToBinding(binding, lookup)) setDriverIdentity(lookup.driverIdentity);
      } catch { /* Driver API may be unavailable during setup. */ }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [binding?.deviceId, binding?.vehicleNumber]);

  async function loadRoutes(search = '') {
    if (!binding) return;
    const requestId = ++routeSearchRequestRef.current;
    setRoutesLoading(true);
    setRoutesError('');
    try {
      const result = await fetchJobRoutes(binding.deviceId, search, 50);
      if (requestId !== routeSearchRequestRef.current) return;
      setRouteOptions(result.routes);
      setRoutesHasMore(result.hasMore);
      setSelectedRouteName(current => {
        if (current) return current;
        return !search && result.routes.length === 1 && !result.hasMore ? result.routes[0].routeName : null;
      });
    } catch {
      if (requestId === routeSearchRequestRef.current) setRoutesError(language === 'en' ? 'Could not load routes. Tap to retry.' : 'ไม่สามารถโหลดเส้นทางได้ แตะเพื่อลองใหม่');
    } finally {
      if (requestId === routeSearchRequestRef.current) setRoutesLoading(false);
    }
  }

  useEffect(() => {
    if (!binding) {
      setRouteOptions([]);
      setSelectedRouteName(null);
      setRoutesHasMore(false);
      return;
    }
    void loadRoutes('');
  }, [binding?.deviceId, binding?.vehicleNumber]);

  useEffect(() => {
    if (!routesVisible || !binding) return undefined;
    const timer = setTimeout(() => { void loadRoutes(routeSearch); }, 250);
    return () => clearTimeout(timer);
  }, [binding?.deviceId, routeSearch, routesVisible]);

  useEffect(() => {
    let active = true;
    let syncing = false;
    const flush = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        const pending = await listPendingJobReports(10);
        for (const report of pending) {
          if (!active) break;
          try {
            await saveJob(report);
            if (report.status !== 'Cancelled') {
              await requestJobGpsSync({ jobId: report.id, vehicleNumber: report.vehicleNumber, deviceId: report.deviceId, targetAt: report.endTime }).catch(() => { /* Dashboard save succeeds independently of GPS source availability. */ });
            }
            await removePendingJobReport(report.id);
            await removePendingJobStart(report.id).catch(() => { /* A later start retry is safe because the report closes it server-side. */ });
          } catch (error) {
            if (isRetryableApiError(error)) break;
            await markPendingJobReportPermanentFailure(report.id, apiFailureMessage(error));
          }
        }
      } catch { /* Pending reports remain in SQLite for the next retry. */ }
      finally { syncing = false; }
    };
    const cancelIdleTask = scheduleIdleTask(() => { void flush(); });
    const timer = setInterval(() => { void flush(); }, 30000);
    return () => { active = false; cancelIdleTask(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    let syncing = false;
    const flush = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        const pending = await listPendingJobStarts(10);
        for (const jobStart of pending) {
          if (!active) break;
          try {
            await saveJobStart(jobStart);
            await removePendingJobStart(jobStart.id);
          } catch (error) {
            if (isRetryableApiError(error)) break;
            await markPendingJobStartPermanentFailure(jobStart.id, apiFailureMessage(error));
          }
        }
      } catch { /* Pending starts remain in SQLite for the next retry. */ }
      finally { syncing = false; }
    };
    const cancelIdleTask = scheduleIdleTask(() => { void flush(); });
    const timer = setInterval(() => { void flush(); }, 30000);
    return () => { active = false; cancelIdleTask(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!binding || !activeJobId || !startedAt || pendingReport) return;
    let active = true;
    let syncing = false;
    const sync = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        await requestJobGpsSync({
          jobId: activeJobId,
          vehicleNumber: binding.vehicleNumber,
          deviceId: binding.deviceId,
          targetAt: new Date(serverNowMs()).toISOString(),
        });
      } catch { /* The backend retries source reconciliation on the next heartbeat and when the job closes. */ }
      finally { syncing = false; }
    };
    const cancelIdleTask = scheduleIdleTask(() => { void sync(); });
    const timer = setInterval(() => { void sync(); }, GPS_SYNC_INTERVAL_MS);
    return () => { active = false; cancelIdleTask(); clearInterval(timer); };
  }, [activeJobId, binding?.deviceId, binding?.vehicleNumber, pendingReport, startedAt]);

  useEffect(() => {
    let active = true;
    let syncing = false;
    const syncRecordedJobs = async () => {
      if (!active || syncing || !recordedGpsSyncJobsRef.current.size) return;
      syncing = true;
      try {
        for (const [jobId, job] of recordedGpsSyncJobsRef.current) {
          if (!active) break;
          try {
            const result = await requestJobGpsSync(job);
            const status = result?.report?.gpsLookupStatus || result?.deviceSource?.status;
            if (status && !['pending', 'no_data', 'lookup_failed', 'lookup_unavailable'].includes(status)) {
              recordedGpsSyncJobsRef.current.delete(jobId);
            }
          } catch { /* Keep the job queued; the next 60-second sync can recover transient failures. */ }
        }
      } finally { syncing = false; }
    };
    const timer = setInterval(() => { void syncRecordedJobs(); }, GPS_SYNC_INTERVAL_MS);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!awaitingMovement || !binding || pendingReport) return;
    let active = true;
    let polling = false;
    let starting = false;
    const startDetectedJob = async () => {
      if (starting || !active || pendingReportRef.current || !selected) return;
      starting = true;
      const timestamp = serverNowMs();
      const startedDriver = snapshotDriver(driverIdentity) ?? jobDriverIdentity;
      const jobId = activeJobId ?? createJobId(binding.deviceId, selected, timestamp);
      try {
        await persistActiveJob({ jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, selected, routeName: selectedRouteName, startedAt: timestamp, driverName: startedDriver?.driverName ?? null, driverId: startedDriver?.driverId ?? null });
      } catch {
        if (active) setMessage(language === 'en' ? 'Could not save the job start — retrying' : 'ไม่สามารถบันทึกเวลาเริ่มงานได้ — กำลังลองใหม่');
        starting = false;
        return;
      }
      if (!active) return;
      setStartedAt(timestamp);
      setActiveJobId(jobId);
      setJobDriverIdentity(startedDriver);
      setAwaitingMovement(false);
      setMessage(language === 'en' ? 'Vehicle movement detected' : 'ตรวจพบรถเริ่มเคลื่อนที่แล้ว');
      void queueJobStartForSync({ id: jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: startedDriver?.driverName ?? null, driverId: startedDriver?.driverId ?? null, mode: actionLabel(selected, 'en'), routeName: selectedRouteName, startTime: new Date(timestamp).toISOString() });
    };
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const motion = await fetchVehicleMotion(binding.deviceId);
        if (motionStartsJob(binding, motion)) await startDetectedJob();
      } catch { /* Keep waiting for the next motion check. */ }
      finally { polling = false; }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [activeJobId, awaitingMovement, binding?.deviceId, binding?.vehicleNumber, driverIdentity?.driverId, driverIdentity?.driverName, jobDriverIdentity, language, pendingReport, selected, selectedRouteName]);

  async function connectVehicle() {
    if (!vehicleInput.trim() || savingSetup) return;
    setSavingSetup(true); setMessage('');
    try {
      const next = { vehicleNumber: vehicleInput.trim(), deviceId: await getDeviceId() };
      await saveVehicleBinding(next);
      setBinding(next);
      try { await persistBinding(next); }
      catch { setMessage(language === 'en' ? 'Vehicle connected; local recovery will retry at the next start' : 'เชื่อมต่อรถแล้ว ระบบจะลองบันทึกในเครื่องอีกครั้งเมื่อเปิดแอป'); }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '';
      const duplicateDevice = errorText.includes('Device is already connected');
      const missingDeviceId = errorText.includes('Android device ID is unavailable');
      const serverUnavailable = errorText === 'Songdee GPS server is unreachable' || errorText === 'Songdee GPS server timed out';
      setMessage(language === 'en'
        ? (duplicateDevice ? 'This tablet is already connected. Change it in the admin dashboard.' : missingDeviceId ? 'This app requires an Android device identifier.' : serverUnavailable ? 'Cannot reach the Songdee GPS server. Check the tablet network and API address.' : errorText || 'Could not connect to the server')
        : (duplicateDevice ? 'แท็บเล็ตนี้เชื่อมต่ออยู่แล้ว ให้เปลี่ยนจากแดชบอร์ดผู้ดูแล' : missingDeviceId ? 'แอปนี้ต้องใช้รหัสอุปกรณ์ Android' : serverUnavailable ? 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Songdee GPS ได้ กรุณาตรวจสอบเครือข่ายและที่อยู่ API' : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'));
    } finally { setSavingSetup(false); }
  }

  function openVehicleAdmin() {
    if (!binding) return;
    vehicleAdminTriggerNodeRef.current = findNodeHandle(vehicleAdminButtonRef.current);
    setVehicleAdminInput(binding.vehicleNumber);
    setVehicleAdminPassword('');
    setVehicleAdminError('');
    setVehicleAdminVisible(true);
  }

  function dismissVehicleAdmin() {
    if (changingVehicle) return;
    setVehicleAdminPassword('');
    setVehicleAdminError('');
    setVehicleAdminVisible(false);
    restoreFocusToNode(vehicleAdminTriggerNodeRef.current);
  }

  async function changeVehicle() {
    if (!binding || changingVehicle) return;
    if (selected) {
      setVehicleAdminError(language === 'en'
        ? 'Turn off or cancel the current job before changing the vehicle.'
        : 'กรุณาปิดหรือยกเลิกงานปัจจุบันก่อนเปลี่ยนรถ');
      return;
    }
    const vehicleNumber = vehicleAdminInput.trim();
    const password = vehicleAdminPassword;
    if (!vehicleNumber || !password) return;
    setChangingVehicle(true);
    setVehicleAdminError('');
    try {
      // Vehicle changes are only allowed with no active selection, so remove
      // any stale durable recovery marker before changing the authoritative
      // binding. This prevents the new binding from waiting forever for an
      // old vehicle's job state to reconcile.
      await clearActiveJob();
      const next = await changeVehicleBindingWithAdminPassword({ vehicleNumber, deviceId: binding.deviceId }, password);
      await persistBinding(next).catch(() => { /* The authoritative server binding will be restored on the next launch. */ });
      setBinding(next);
      setRecoveredBindingKey(deviceBindingKey(next));
      setDriverIdentity(null);
      setJobDriverIdentity(null);
      setSelected(null);
      setSelectedRouteName(null);
      setActiveJobId(null);
      setStartedAt(null);
      setAwaitingMovement(false);
      updatePendingReport(null);
      setConfirmType(null);
      jobHistoryRequestRef.current += 1;
      jobHistoryQueryRef.current = initialJobHistoryQuery;
      setSavedJobs([]);
      setJobHistory(emptyDeviceJobHistory());
      setVehicleAdminVisible(false);
      restoreFocusToNode(vehicleAdminTriggerNodeRef.current);
      setMessage(language === 'en'
        ? `Vehicle changed to ${next.vehicleNumber}`
        : `เปลี่ยนรถเป็น ${next.vehicleNumber} แล้ว`);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '';
      setVehicleAdminError(language === 'en'
        ? (errorText === 'Invalid password' ? 'Incorrect admin password.' : errorText || 'Could not change the vehicle number.')
        : (errorText === 'Invalid password' ? 'รหัสผ่านผู้ดูแลไม่ถูกต้อง' : 'ไม่สามารถล้างสถานะงานหรือเปลี่ยนหมายเลขรถได้'));
    } finally {
      setVehicleAdminPassword('');
      setChangingVehicle(false);
    }
  }

  function selectAction(number: string) {
    if (number !== '9' && !selected && !selectedRouteName && (routesLoading || routeOptions.length)) {
      setMessage(routesLoading
        ? (language === 'en' ? 'Loading job routes…' : 'กำลังโหลดเส้นทางงาน…')
        : (language === 'en' ? 'Choose a route before starting this job' : 'เลือกเส้นทางก่อนเริ่มงานนี้'));
      if (!routesLoading) setRoutesVisible(true);
      return;
    }
    if (number === selected && pendingReport?.status === 'Cancelled') {
      setConfirmType('cancel');
      return;
    }
    const decision = decideAction(number, { selected, startedAt, awaitingMovement });
    if (decision.type === 'blocked') {
      setMessage(decision.reason === 'job_in_progress'
        ? (language === 'en' ? 'Finish or cancel the current job first' : 'กรุณาจบหรือยกเลิกงานปัจจุบันก่อน')
        : decision.reason === 'waiting_for_movement'
        ? (language === 'en' ? 'Waiting for vehicle movement' : 'กำลังรอรถเริ่มเคลื่อนที่')
        : (language === 'en' ? 'Start the vehicle first' : 'กรุณาเริ่มรถก่อน'));
      return;
    }
    if (decision.type === 'confirm_finish') { setConfirmType('finish'); return; }
    if (decision.type === 'confirm_day_end') {
      setSelected(number);
      setConfirmType('day_end');
      return;
    }
    setSelected(number);
    setConfirmType('start');
  }
  function dismissConfirmation() { if (savingJob) return; if (confirmType === 'start' || confirmType === 'day_end') setSelected(null); setConfirmType(null); restoreConfirmationTriggerFocus(); }

  async function persistNewActiveJob(job: Parameters<typeof persistActiveJob>[0]) {
    try {
      await persistActiveJob(job);
      return true;
    } catch {
      setSelected(null);
      setActiveJobId(null);
      setStartedAt(null);
      setAwaitingMovement(false);
      updatePendingReport(null);
      setJobDriverIdentity(null);
      setMessage(language === 'en' ? 'Could not save job state. Please select the mode again.' : 'ไม่สามารถบันทึกสถานะงานได้ กรุณาเลือกกิจกรรมอีกครั้ง');
      return false;
    }
  }

  async function queueJobStartForSync(jobStart: JobStartInput) {
    let queued = false;
    try {
      await enqueueJobStart(jobStart);
      queued = true;
    } catch { /* The server attempt below can still preserve the start. */ }
    try {
      await saveJobStart(jobStart);
      if (queued) await removePendingJobStart(jobStart.id);
    } catch { /* A queued start retries in the background; the final report also contains this timestamp. */ }
  }

  async function confirmStart() {
    if (startingJob || !binding || !selected) return;
    setStartingJob(true);
    setConfirmType(null);
    restoreConfirmationTriggerFocus();
    try {
      setMessage(language === 'en' ? 'Checking vehicle movement…' : 'กำลังตรวจสอบการเคลื่อนที่ของรถ…');
      const pendingDriver = snapshotDriver(driverIdentity);
      const jobId = activeJobId ?? createJobId(binding.deviceId, selected, serverNowMs());
      let waitForMovement = false;
      let waitMessage = language === 'en' ? 'Waiting for vehicle movement' : 'กำลังรอรถเริ่มเคลื่อนที่';
      try {
        const motion = await fetchVehicleMotion(binding.deviceId);
        waitForMovement = !motionStartsJob(binding, motion);
        if (motion.vehicleNumber !== binding.vehicleNumber || motion.deviceId !== binding.deviceId) {
          waitMessage = language === 'en' ? 'Vehicle connection changed — checking setup' : 'การเชื่อมต่อรถมีการเปลี่ยนแปลง — กำลังตรวจสอบการตั้งค่า';
        }
      } catch {
        waitForMovement = true;
      }
      if (waitForMovement) {
        const stored = await persistNewActiveJob({ jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, selected, routeName: selectedRouteName, startedAt: 0, awaitingMovement: true, driverName: pendingDriver?.driverName ?? null, driverId: pendingDriver?.driverId ?? null });
        if (!stored) return;
        setActiveJobId(jobId);
        setJobDriverIdentity(pendingDriver);
        setAwaitingMovement(true);
        setMessage(waitMessage);
        return;
      }
      const timestamp = serverNowMs();
      const stored = await persistNewActiveJob({ jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, selected, routeName: selectedRouteName, startedAt: timestamp, driverName: pendingDriver?.driverName ?? null, driverId: pendingDriver?.driverId ?? null });
      if (!stored) return;
      setActiveJobId(jobId);
      setJobDriverIdentity(pendingDriver);
      setStartedAt(timestamp);
      setAwaitingMovement(false);
      setMessage(language === 'en' ? 'Vehicle started' : 'รถเริ่มแล้ว');
      void queueJobStartForSync({ id: jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: pendingDriver?.driverName ?? null, driverId: pendingDriver?.driverId ?? null, mode: actionLabel(selected, 'en'), routeName: selectedRouteName, startTime: new Date(timestamp).toISOString() });
    } finally {
      setStartingJob(false);
    }
  }

  function saveOrQueueJob(report: JobReportInput) {
    return deliverJobReport(report, {
      enqueue: enqueueJobReport,
      send: saveJob,
      remove: removePendingJobReport,
      markPermanentFailure: markPendingJobReportPermanentFailure,
      isRetryable: isRetryableApiError,
      errorMessage: apiFailureMessage,
    });
  }

  async function persistPendingFinalReport(report: JobReportInput) {
    if (!binding || !selected) return false;
    const previousPendingReport = pendingReportRef.current;
    pendingReportRef.current = report;
    try {
      const completedStart = report.status === 'Cancelled' ? null : Date.parse(report.startTime);
      await persistActiveJob({
        jobId: report.id,
        vehicleNumber: binding.vehicleNumber,
        deviceId: binding.deviceId,
        selected,
        routeName: report.routeName || selectedRouteName,
        startedAt: startedAt ?? (typeof completedStart === 'number' && Number.isFinite(completedStart) ? completedStart : 0),
        ...(awaitingMovement && report.status === 'Cancelled' ? { awaitingMovement: true } : {}),
        driverName: report.driverName,
        driverId: report.driverId,
        pendingReport: report,
      });
      setPendingReport(report);
      return true;
    } catch {
      pendingReportRef.current = previousPendingReport;
      setMessage(language === 'en'
        ? 'Could not safely store the final job. Retry without closing the app.'
        : 'ไม่สามารถบันทึกข้อมูลงานสุดท้ายอย่างปลอดภัย กรุณาลองอีกครั้งโดยไม่ปิดแอป');
      return false;
    }
  }

  function queueRecordedGpsSync(report: JobReportInput) {
    if (report.status === 'Cancelled') return;
    const job = { jobId: report.id, vehicleNumber: report.vehicleNumber, deviceId: report.deviceId, targetAt: report.endTime };
    recordedGpsSyncJobsRef.current.set(report.id, job);
    void requestJobGpsSync(job).then(result => {
      const status = result?.report?.gpsLookupStatus || result?.deviceSource?.status;
      if (status && !['pending', 'no_data', 'lookup_failed', 'lookup_unavailable'].includes(status)) {
        recordedGpsSyncJobsRef.current.delete(report.id);
      }
    }).catch(() => { /* The 60-second sync keeps retrying after a transient failure. */ });
  }

  async function confirmFinish() {
    const immediateDayEnd = confirmType === 'day_end' && selected === '9';
    if (savingJob || !binding || !selected || (!immediateDayEnd && !startedAt && !awaitingMovement)) return;
    const fallbackStart = startedAt ?? jobInitiatedAt(activeJobId) ?? serverNowMs();
    const reportId = activeJobId ?? createJobId(binding.deviceId, selected, fallbackStart);
    const finishingDay = selected === '9';
    let completedDayReport: SavedJob | null = null;
    setSavingJob(true);
    try {
      const report = finalReportForIntent(pendingReport, 'completed', () => {
        const end = Math.max(serverNowMs(), fallbackStart);
        const jobDriver = reportDriver(jobDriverIdentity, driverIdentity);
        return { id: reportId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: jobDriver?.driverName || null, driverId: jobDriver?.driverId || null, mode: actionLabel(selected, 'en'), routeName: selectedRouteName, startTime: new Date(fallbackStart).toISOString(), endTime: new Date(end).toISOString(), duration: formatDuration(end - fallbackStart) };
      });
      if (!report) {
        setMessage(language === 'en' ? 'Cancellation is already pending' : 'กำลังรอบันทึกการยกเลิกงาน');
        return;
      }
      if (!pendingReport && !await persistPendingFinalReport(report)) return;
      const syncState = await saveOrQueueJob(report);
      if (syncState === 'synced' || syncState === 'queued') queueRecordedGpsSync(report);
      await removePendingJobStart(reportId).catch(() => { /* Server-side report creation also closes the active start. */ });
      const localStateFinalized = await finalizeActiveJob();
      const deliveryMessage = syncState === 'synced'
        ? (language === 'en' ? 'Job saved to dashboard' : 'บันทึกงานไปยังแดชบอร์ดแล้ว')
        : syncState === 'queued'
          ? (language === 'en' ? 'Job saved on tablet — dashboard sync pending' : 'บันทึกงานในแท็บเล็ตแล้ว — รอส่งไปยังแดชบอร์ด')
          : (language === 'en' ? 'Job saved on tablet — dashboard rejected it; admin review needed' : 'บันทึกงานในแท็บเล็ตแล้ว — แดชบอร์ดปฏิเสธข้อมูล กรุณาให้ผู้ดูแลตรวจสอบ');
      setMessage(localStateFinalized
        ? deliveryMessage
        : `${deliveryMessage}${language === 'en' ? ' — local cleanup failed; tap the active job again before starting another job' : ' — ล้างข้อมูลงานในเครื่องไม่สำเร็จ กรุณากดกิจกรรมที่กำลังทำอีกครั้งก่อนเริ่มงานใหม่'}`);
      if (localStateFinalized) {
        confirmationTriggerNodeRef.current = findNodeHandle(headerTitleRef.current);
        setSelected(null);
        setActiveJobId(null);
        setStartedAt(null);
        setAwaitingMovement(false);
        setJobDriverIdentity(null);
        updatePendingReport(null);
        if (finishingDay) setSelectedRouteName(null);
        if (finishingDay) completedDayReport = { ...report, pendingUpload: syncState === 'queued', uploadFailed: syncState === 'rejected' };
      }
    } catch (error) {
      setMessage(mobileOperationErrorMessage(error, language, 'finish'));
    } finally {
      setSavingJob(false);
      setConfirmType(null);
      if (completedDayReport) {
        const dayReport = completedDayReport;
        savedJobsTriggerNodeRef.current = findNodeHandle(headerTitleRef.current);
        setSavedJobs(current => [dayReport, ...current.filter(job => job.id !== dayReport.id)]);
        setReportDay(mobileReportDayKey(dayReport.endTime));
        setJobsVisible(true);
      } else restoreConfirmationTriggerFocus();
    }
  }

  async function confirmCancel() {
    if (savingJob || !binding || !selected) return;
    const reportId = activeJobId ?? createJobId(binding.deviceId, selected, startedAt ?? serverNowMs());
    setSavingJob(true);
    try {
      const report = cancellationReportForIntent(pendingReport, () => {
        const end = serverNowMs();
        const effectiveStart = startedAt ?? end;
        const jobDriver = reportDriver(jobDriverIdentity, driverIdentity);
        return { id: reportId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: jobDriver?.driverName || null, driverId: jobDriver?.driverId || null, mode: actionLabel(selected, 'en'), routeName: selectedRouteName, startTime: new Date(effectiveStart).toISOString(), endTime: new Date(end).toISOString(), duration: formatDuration(end - effectiveStart), status: 'Cancelled' };
      });
      if (report !== pendingReport && !await persistPendingFinalReport(report)) return;
      const syncState = await saveOrQueueJob(report);
      await removePendingJobStart(reportId).catch(() => { /* Server-side report creation also closes the active start. */ });
      const localStateFinalized = await finalizeActiveJob();
      const deliveryMessage = syncState === 'synced'
        ? (language === 'en' ? 'Job cancelled and recorded' : 'ยกเลิกและบันทึกงานแล้ว')
        : syncState === 'queued'
          ? (language === 'en' ? 'Cancellation saved on tablet — dashboard sync pending' : 'บันทึกการยกเลิกในแท็บเล็ตแล้ว — รอส่งไปยังแดชบอร์ด')
          : (language === 'en' ? 'Cancellation saved on tablet — dashboard rejected it; admin review needed' : 'บันทึกการยกเลิกในแท็บเล็ตแล้ว — แดชบอร์ดปฏิเสธข้อมูล กรุณาให้ผู้ดูแลตรวจสอบ');
      setMessage(localStateFinalized
        ? deliveryMessage
        : `${deliveryMessage}${language === 'en' ? ' — local cleanup failed; use Retry cancellation again' : ' — ล้างข้อมูลงานในเครื่องไม่สำเร็จ กรุณาลองบันทึกการยกเลิกอีกครั้ง'}`);
      if (localStateFinalized) {
        confirmationTriggerNodeRef.current = findNodeHandle(headerTitleRef.current);
        setSelected(null);
        setActiveJobId(null);
        setStartedAt(null);
        setAwaitingMovement(false);
        setJobDriverIdentity(null);
        updatePendingReport(null);
      }
    } catch (error) {
      setMessage(mobileOperationErrorMessage(error, language, 'cancel'));
    } finally {
      setSavingJob(false);
      setConfirmType(null);
      restoreConfirmationTriggerFocus();
    }
  }

  async function refreshSavedJobs(query = jobHistoryQueryRef.current, page = 1, append = false) {
    if (!binding) return;
    const requestId = jobHistoryRequestRef.current + 1;
    jobHistoryRequestRef.current = requestId;
    if (append) setJobsLoadingMore(true);
    else setJobsLoading(true);
    setJobsError('');
    let serverHistory: DeviceJobHistoryResponse | null = null;
    let localHistory = null;
    let remoteFailed = false;
    try {
      serverHistory = await fetchDeviceJobs(binding.deviceId, binding.vehicleNumber, query, page);
    } catch {
      remoteFailed = true;
    }
    try {
      localHistory = await listStoredJobReportsPage(binding.deviceId, binding.vehicleNumber, query, page, Boolean(serverHistory));
    } catch {
      if (!serverHistory) remoteFailed = true;
    }
    if (requestId !== jobHistoryRequestRef.current) return;
    const serverJobs = serverHistory?.jobs || [];
    const localJobs = localHistory?.jobs || [];
    const pageJobs = mergeSavedJobs(binding, serverJobs, localJobs);
    setSavedJobs(current => append ? mergeSavedJobs(binding, [...current, ...pageJobs], []) : pageJobs);
    const serverSummary = serverHistory?.summary || emptyDeviceJobHistory().summary;
    const localSummary = localHistory?.summary || emptyDeviceJobHistory().summary;
    const summary = serverHistory ? combinedJobSummary(serverSummary, localSummary) : localSummary;
    const hasNextPage = Boolean(serverHistory?.pageInfo.hasNextPage || localHistory?.pageInfo.hasNextPage);
    const months = [...new Set([...(serverHistory?.facets.months || []), ...(localHistory?.facets.months || [])])].sort().reverse();
    setJobHistory({
      jobs: pageJobs,
      facets: { months },
      pageInfo: {
        page,
        pageSize: serverHistory?.pageInfo.pageSize || localHistory?.pageInfo.pageSize || 50,
        total: summary.total,
        totalPages: Math.max(1, Math.ceil(summary.total / (serverHistory?.pageInfo.pageSize || localHistory?.pageInfo.pageSize || 50))),
        start: summary.total ? 1 : 0,
        end: Math.min(summary.total, page * (serverHistory?.pageInfo.pageSize || localHistory?.pageInfo.pageSize || 50)),
        hasNextPage,
      },
      summary,
    });
    if (remoteFailed) setJobsError(language === 'en' ? 'Could not refresh the dashboard. Showing jobs saved on this tablet.' : 'ไม่สามารถโหลดข้อมูลจากแดชบอร์ด แสดงงานที่บันทึกในแท็บเล็ต');
    setJobsLoading(false);
    setJobsLoadingMore(false);
  }

  function openSavedJobs() {
    savedJobsTriggerNodeRef.current = findNodeHandle(savedJobsButtonRef.current);
    setReportDay(null);
    setJobsVisible(true);
  }

  function closeSavedJobs() {
    setJobsVisible(false);
    restoreFocusToNode(savedJobsTriggerNodeRef.current ?? findNodeHandle(headerTitleRef.current));
  }

  const setupDisabled = savingSetup || !vehicleInput.trim();

  if (!mobileStartupReady(bindingChecked, binding, recoveredBindingKey)) return <SafeAreaView style={styles.setup} edges={['top', 'right', 'bottom', 'left']}><View style={styles.loading}><RedGpsPin size={58} /><Text style={styles.eyebrow}>SONGDEE OPS PANEL</Text><Text accessibilityLiveRegion="polite" style={styles.body}>{language === 'en' ? 'Restoring vehicle and job state…' : 'กำลังกู้คืนข้อมูลรถและสถานะงาน…'}</Text></View></SafeAreaView>;

  if (deviceAccessBlocked) return <SafeAreaView style={styles.setupPage} edges={['top', 'right', 'bottom', 'left']}>
    <View style={styles.setupScroll}>
      <View style={styles.setupCard}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Switch to Thai' : 'เปลี่ยนเป็นภาษาอังกฤษ'} onPress={() => setLanguage(language === 'en' ? 'th' : 'en')} style={languageStyles.setupButton}><Text style={languageStyles.setupButtonText}>{language === 'en' ? 'ไทย' : 'EN'}</Text></Pressable>
        <RedGpsPin size={58} />
        <Text style={styles.eyebrow}>SONGDEE OPS PANEL</Text>
        <Text accessibilityRole="header" style={styles.title}>{language === 'en' ? 'Tablet connection needs repair' : 'ต้องซ่อมการเชื่อมต่อแท็บเล็ต'}</Text>
        <Text style={styles.body}>{language === 'en' ? 'Ask an administrator to open Fleet and choose Repair tablet access for this device. Then tap Try again. The vehicle binding and saved jobs will not change.' : 'ให้ผู้ดูแลเปิดหน้า Fleet และเลือก “ซ่อมการเข้าถึงแท็บเล็ต” สำหรับอุปกรณ์นี้ แล้วกดลองอีกครั้ง การเชื่อมรถและงานที่บันทึกไว้จะไม่เปลี่ยนแปลง'}</Text>
        <Pressable accessibilityRole="button" onPress={() => { setBindingChecked(false); setBindingRefreshToken(value => value + 1); }} style={styles.primary}><Text style={styles.primaryText}>{language === 'en' ? 'Try again' : 'ลองอีกครั้ง'}</Text></Pressable>
      </View>
    </View>
  </SafeAreaView>;

  if (!binding) return <SafeAreaView style={styles.setupPage} edges={['top', 'right', 'bottom', 'left']}>
    <ScrollView
      contentContainerStyle={[styles.setupScroll, compactLandscape && compactStyles.setupScroll]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.setupCard, compactLandscape && compactStyles.setupCard]}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Switch to Thai' : 'เปลี่ยนเป็นภาษาอังกฤษ'} onPress={() => setLanguage(language === 'en' ? 'th' : 'en')} style={languageStyles.setupButton}><Text style={languageStyles.setupButtonText}>{language === 'en' ? 'ไทย' : 'EN'}</Text></Pressable>
        <RedGpsPin size={compactLandscape ? 42 : 58} />
        <Text style={styles.eyebrow}>{t.setupEyebrow}</Text>
        <Text accessibilityRole="header" style={[styles.title, compactLandscape && compactStyles.setupTitle]}>{t.setup}</Text>
        <Text style={styles.body}>{t.setupBody}</Text>
        <Text style={styles.inputLabel}>{t.vehicle}</Text>
        <TextInput
          accessibilityHint={language === 'en' ? 'Later changes require the admin password.' : 'การเปลี่ยนภายหลังต้องใช้รหัสผ่านผู้ดูแล'}
          accessibilityLabel={t.vehicle}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          editable={!savingSetup}
          maxLength={80}
          onSubmitEditing={() => { void connectVehicle(); }}
          returnKeyType="done"
          value={vehicleInput}
          onChangeText={setVehicleInput}
          placeholder={t.vehicle}
          placeholderTextColor={colors.grey}
          style={styles.input}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t.save} accessibilityState={{ disabled: setupDisabled, busy: savingSetup }} disabled={setupDisabled} onPress={connectVehicle} style={[styles.primary, setupDisabled && layoutStyles.disabled]}><Text style={styles.primaryText}>{savingSetup ? (language === 'en' ? 'Connecting…' : 'กำลังเชื่อมต่อ…') : t.save}</Text></Pressable>
        {message ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
      </View>
    </ScrollView>
  </SafeAreaView>;

  const jobSnapshot = { selected, startedAt, awaitingMovement };
  const driverSummary = driverHeaderText(driverIdentity, binding.deviceId, language);
  const confirmationTitle = confirmType === 'start'
    ? (language === 'en' ? 'Turn this job on?' : 'เริ่มกิจกรรมนี้หรือไม่?')
    : confirmType === 'day_end'
      ? (language === 'en' ? 'Finish work?' : 'จบงานหรือไม่?')
    : confirmType === 'finish'
      ? selected === '9'
        ? (language === 'en' ? 'Finish work and view today’s report?' : 'จบงานและดูรายงานวันนี้หรือไม่?')
        : (language === 'en' ? 'Turn off and save this job?' : 'ปิดและบันทึกงานนี้หรือไม่?')
      : (language === 'en' ? 'Cancel this job?' : 'ยกเลิกงานนี้หรือไม่?');
  const confirmationDismissLabel = confirmType === 'start'
    ? (language === 'en' ? 'Choose another job' : 'เลือกกิจกรรมอื่น')
    : confirmType === 'day_end'
      ? (language === 'en' ? 'Cancel' : 'ยกเลิก')
    : (language === 'en' ? 'Keep current job on' : 'ทำงานปัจจุบันต่อ');
  const confirmationSubmitLabel = confirmType === 'start'
    ? (language === 'en' ? `Turn on ${actionLabel(selected, language)}` : `เริ่ม ${actionLabel(selected, language)}`)
    : confirmType === 'day_end'
      ? (language === 'en' ? 'Finish and view report' : 'จบงานและดูรายงาน')
    : confirmType === 'finish'
      ? selected === '9'
        ? (language === 'en' ? 'Finish and view report' : 'จบงานและดูรายงาน')
        : (language === 'en' ? 'Turn off and save job' : 'ปิดและบันทึกงาน')
      : (language === 'en' ? 'Confirm job cancellation' : 'ยืนยันการยกเลิกงาน');
  // The tablet control surface is intentionally a fixed nine-dot layout in
  // both orientations. Enlarged text changes the spacing inside each tile,
  // never the number or position of the job buttons.
  const actionPanel = <View style={styles.columns}>
    <View style={[styles.panel, compactLandscape && compactStyles.panel, largeText && accessibilityStyles.panel]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selectedRouteName ? `${language === 'en' ? 'Selected route' : 'เส้นทางที่เลือก'} ${selectedRouteName}` : (language === 'en' ? 'Choose job route' : 'เลือกเส้นทางงาน')}
        accessibilityHint={selected ? (language === 'en' ? 'Finish or cancel the active activity before changing route' : 'จบหรือยกเลิกกิจกรรมปัจจุบันก่อนเปลี่ยนเส้นทาง') : undefined}
        accessibilityState={{ disabled: Boolean(selected), busy: routesLoading }}
        disabled={Boolean(selected)}
        onPress={() => {
          setRouteSearch('');
          setRoutesVisible(true);
        }}
        style={[routeStyles.selector, compactLandscape && routeStyles.selectorCompact, selected && routeStyles.selectorLocked]}
      >
        <View style={routeStyles.selectorText}><Text style={routeStyles.selectorLabel}>{language === 'en' ? 'JOB ROUTE' : 'เส้นทางงาน'}</Text><Text numberOfLines={1} style={routeStyles.selectorValue}>{selectedRouteName || (routesLoading ? (language === 'en' ? 'Loading routes…' : 'กำลังโหลดเส้นทาง…') : routesError || (language === 'en' ? 'Choose route' : 'เลือกเส้นทาง'))}</Text></View>
        <Text style={routeStyles.selectorAction}>{selected ? (language === 'en' ? 'Locked' : 'ล็อก') : (language === 'en' ? 'Change' : 'เปลี่ยน')}</Text>
      </Pressable>
      <View style={[styles.grid, compactLandscape && compactStyles.grid, largeText && accessibilityStyles.grid]}>
        {actionRows.map((row, rowIndex) => (
          <View style={[styles.actionRow, compactLandscape && compactStyles.actionRow, largeText && accessibilityStyles.actionRow]} key={rowIndex}>
            {row.map(([number, thai, english, thaiDescription, englishDescription]) => {
              const unavailable = startingJob || isActionUnavailable(jobSnapshot, number);
              return (
                <Pressable
                  ref={node => { actionButtonRefs.current[number] = node; }}
                  accessibilityRole="button"
                  accessibilityLabel={`${number}. ${language === 'en' ? `${english}. ${englishDescription}` : `${thai}. ${thaiDescription}`}`}
                  accessibilityState={{ selected: selected === number, disabled: unavailable }}
                  disabled={unavailable}
                  key={number}
                  onPress={() => { rememberConfirmationTrigger(actionButtonRefs.current[number]); selectAction(number); }}
                  style={[
                    styles.action,
                    readableStyles.action,
                    compactLandscape && compactStyles.action,
                    largeText && accessibilityStyles.action,
                    selected === number && styles.actionSelected,
                    unavailable && selected !== number && disabledActionStyles.tile,
                  ]}
                >
                  <View style={[styles.actionNumberSlot, compactLandscape && compactStyles.actionNumberSlot, largeText && accessibilityStyles.actionNumberSlot]}>
                    <Text style={[styles.number, readableStyles.number, compactLandscape && compactStyles.number, unavailable && selected !== number && readableStyles.disabledNumber]}>{number}</Text>
                  </View>
                  <View style={[styles.actionTextSlot, compactLandscape && compactStyles.actionTextSlot, largeText && accessibilityStyles.actionTextSlot]}>
                    <Text numberOfLines={largeText ? undefined : 2} style={[styles.actionTitle, readableStyles.actionTitle, compactLandscape && compactStyles.actionTitle, unavailable && selected !== number && readableStyles.disabledText]}>{language === 'en' ? english : thai}</Text>
                    <Text numberOfLines={largeText ? undefined : compactLandscape ? 2 : 5} style={[styles.actionSub, readableStyles.actionSub, compactLandscape && compactStyles.actionSub, unavailable && selected !== number && readableStyles.disabledText]}>{language === 'en' ? englishDescription : thaiDescription}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  </View>;
  return <SafeAreaView style={styles.page} edges={['top', 'right', 'bottom', 'left']}>
    <View style={[styles.header, compactLandscape && compactStyles.header, largeText && accessibilityStyles.header]}>
      <Pressable ref={vehicleAdminButtonRef} accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Open admin vehicle settings' : 'เปิดการตั้งค่ารถสำหรับผู้ดูแล'} accessibilityHint={language === 'en' ? 'Admin password required to change the vehicle number' : 'ต้องใช้รหัสผ่านผู้ดูแลเพื่อเปลี่ยนหมายเลขรถ'} onPress={openVehicleAdmin} style={languageStyles.headerButton}><RedGpsPin size={compactLandscape ? 30 : 38} /></Pressable>
      <View style={[styles.headerInfo, largeText && accessibilityStyles.headerInfo]}>
        <Text ref={headerTitleRef} accessibilityRole="header" numberOfLines={largeText ? undefined : 1} style={[styles.headerTitle, portrait && layoutStyles.headerTitlePortrait, compactLandscape && compactStyles.headerTitle]}>SONGDEE OPS PANEL · {binding.vehicleNumber}</Text>
        <Text numberOfLines={largeText ? undefined : 1} style={[styles.headerMeta, compactLandscape && compactStyles.headerMeta]}>{driverSummary}</Text>
        {message ? <Text accessibilityLiveRegion="polite" numberOfLines={largeText ? undefined : compactLandscape ? 1 : 2} style={[styles.headerStatus, compactLandscape && compactStyles.headerStatus]}>{message}</Text> : null}
      </View>
      <Pressable ref={savedJobsButtonRef} accessibilityRole="button" accessibilityLabel={language === 'en' ? 'View saved jobs and daily timeline' : 'ดูงานที่บันทึกและไทม์ไลน์ประจำวัน'} onPress={openSavedJobs} style={[headerUtilityStyles.button, compactLandscape && headerUtilityStyles.buttonCompact]}><Text style={headerUtilityStyles.buttonText}>{language === 'en' ? 'Jobs' : 'งาน'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Switch to Thai' : 'เปลี่ยนเป็นภาษาอังกฤษ'} onPress={() => setLanguage(language === 'en' ? 'th' : 'en')} style={languageStyles.headerButton}><Text style={styles.language}>{language === 'en' ? 'ไทย' : 'EN'}</Text></Pressable>
    </View>
    <View style={[styles.content, portrait && layoutStyles.contentPortrait, compactLandscape && compactStyles.content, largeText && accessibilityStyles.content]}>{actionPanel}</View>
    <Modal animationType="fade" onRequestClose={dismissConfirmation} onShow={focusConfirmationTitle} statusBarTranslucent transparent visible={confirmType !== null}>
      {confirmType ? <Pressable accessible={false} onPress={dismissConfirmation} style={modalStyles.overlay}><Pressable accessibilityViewIsModal onAccessibilityEscape={dismissConfirmation} onPress={event => event.stopPropagation()} style={modalStyles.card}><ScrollView contentContainerStyle={modalStyles.cardContent} keyboardShouldPersistTaps="handled"><RedGpsPin size={42} /><Text ref={confirmationTitleRef} accessible accessibilityLiveRegion="assertive" accessibilityRole="header" style={modalStyles.title}>{confirmationTitle}</Text>{selectedRouteName ? <Text style={routeStyles.confirmRoute}>{language === 'en' ? 'Route' : 'เส้นทาง'} · {selectedRouteName}</Text> : null}<Text style={modalStyles.body}>{confirmType === 'start' ? (language === 'en' ? `Job: ${actionLabel(selected, language)}\nThe start time will be recorded when the vehicle moves.` : `กิจกรรม: ${actionLabel(selected, language)}\nระบบจะบันทึกเวลาเริ่มเมื่อรถเคลื่อนที่`) : confirmType === 'day_end' ? (language === 'en' ? 'Finish work will be saved immediately, then today’s saved jobs and timeline will open.' : 'ระบบจะบันทึกการจบงานทันที แล้วเปิดงานที่บันทึกและไทม์ไลน์ของวันนี้') : confirmType === 'finish' ? selected === '9' ? (language === 'en' ? 'Finish work will be saved, then today’s saved jobs and timeline will open on this tablet.' : 'ระบบจะบันทึกการจบงาน แล้วเปิดงานที่บันทึกและไทม์ไลน์ของวันนี้บนแท็บเล็ต') : awaitingMovement && !startedAt ? (language === 'en' ? 'Movement has not been detected. The job selection time will be used as the start time, and the job will be saved to the dashboard.' : 'ยังไม่ตรวจพบการเคลื่อนที่ ระบบจะใช้เวลาที่เลือกกิจกรรมเป็นเวลาเริ่ม และบันทึกงานไปยังแดชบอร์ด') : (language === 'en' ? 'The completed job will be saved and sent to the web dashboard.' : 'ระบบจะบันทึกงานที่เสร็จแล้วและส่งไปยังแดชบอร์ดเว็บ') : (language === 'en' ? 'The job will be recorded as cancelled.' : 'งานนี้จะถูกบันทึกเป็นงานที่ยกเลิก')}</Text><View style={modalStyles.actions}><Pressable accessibilityLabel={confirmationDismissLabel} accessibilityRole="button" accessibilityState={{ disabled: savingJob }} disabled={savingJob} onPress={dismissConfirmation} style={[modalStyles.cancel, savingJob && layoutStyles.disabled]}><Text style={modalStyles.cancelText}>{confirmType === 'start' ? (language === 'en' ? 'Choose another' : 'เลือกกิจกรรมอื่น') : confirmType === 'day_end' ? (language === 'en' ? 'Cancel' : 'ยกเลิก') : (language === 'en' ? 'Keep job on' : 'ทำงานต่อ')}</Text></Pressable>{confirmType === 'finish' ? <Pressable accessibilityLabel={language === 'en' ? 'Cancel current job' : 'ยกเลิกงานปัจจุบัน'} accessibilityRole="button" accessibilityState={{ disabled: savingJob, busy: savingJob }} disabled={savingJob} onPress={confirmCancel} style={[modalStyles.cancelJob, savingJob && layoutStyles.disabled]}><Text style={modalStyles.cancelJobText}>{language === 'en' ? 'Cancel job' : 'ยกเลิกงาน'}</Text></Pressable> : null}<Pressable accessibilityLabel={confirmationSubmitLabel} accessibilityRole="button" accessibilityState={{ disabled: savingJob, busy: savingJob }} disabled={savingJob} onPress={confirmType === 'start' ? confirmStart : confirmType === 'finish' || confirmType === 'day_end' ? confirmFinish : confirmCancel} style={[modalStyles.confirm, savingJob && layoutStyles.disabled]}><Text style={modalStyles.confirmText}>{savingJob ? (language === 'en' ? 'Saving…' : 'กำลังบันทึก…') : confirmType === 'cancel' ? (language === 'en' ? 'Retry cancellation' : 'ลองบันทึกการยกเลิกอีกครั้ง') : confirmType === 'start' ? (language === 'en' ? 'Turn on' : 'เริ่มงาน') : confirmType === 'day_end' ? (language === 'en' ? 'Finish and view report' : 'จบงานและดูรายงาน') : selected === '9' ? (language === 'en' ? 'Finish and view report' : 'จบงานและดูรายงาน') : (language === 'en' ? 'Turn off' : 'ปิดงาน')}</Text></Pressable></View></ScrollView></Pressable></Pressable> : null}
    </Modal>
    <Modal animationType="fade" onRequestClose={() => setRoutesVisible(false)} statusBarTranslucent transparent visible={routesVisible && !selected}>
      <Pressable accessible={false} onPress={() => setRoutesVisible(false)} style={modalStyles.overlay}>
        <Pressable accessibilityViewIsModal onAccessibilityEscape={() => setRoutesVisible(false)} onPress={event => event.stopPropagation()} style={modalStyles.card}>
          <Text accessibilityRole="header" style={modalStyles.title}>{language === 'en' ? 'Choose job route' : 'เลือกเส้นทางงาน'}</Text>
          <Text style={modalStyles.body}>{language === 'en' ? 'Search by route name. The route stays selected for each activity until you change it or finish work.' : 'ค้นหาด้วยชื่อเส้นทาง เส้นทางนี้จะใช้กับแต่ละกิจกรรมจนกว่าจะเปลี่ยนเส้นทางหรือจบงาน'}</Text>
          <TextInput
            accessibilityLabel={language === 'en' ? 'Search job routes' : 'ค้นหาเส้นทางงาน'}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={setRouteSearch}
            placeholder={language === 'en' ? 'Search route name' : 'ค้นหาชื่อเส้นทาง'}
            placeholderTextColor={colors.grey}
            style={routeStyles.routeSearch}
            value={routeSearch}
          />
          {routesLoading ? <Text accessibilityLiveRegion="polite" style={routeStyles.routeState}>{language === 'en' ? 'Searching routes…' : 'กำลังค้นหาเส้นทาง…'}</Text> : null}
          {routesError ? <Text accessibilityRole="alert" style={routeStyles.routeError}>{routesError}</Text> : null}
          <FlatList
            data={routeOptions}
            initialNumToRender={12}
            keyboardShouldPersistTaps="handled"
            keyExtractor={route => route.id}
            maxToRenderPerBatch={16}
            renderItem={({ item: route }) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selectedRouteName === route.routeName }} onPress={() => { setSelectedRouteName(route.routeName); setRoutesVisible(false); setMessage(language === 'en' ? `Route ${route.routeName} selected` : `เลือกเส้นทาง ${route.routeName} แล้ว`); }} style={[routeStyles.routeOption, selectedRouteName === route.routeName && routeStyles.routeOptionSelected]}><Text style={routeStyles.routeOptionName}>{route.routeName}</Text><Text style={routeStyles.routeOptionMark}>{selectedRouteName === route.routeName ? '✓' : '›'}</Text></Pressable>}
            style={routeStyles.routeList}
            windowSize={5}
          />
          {!routesLoading && !routeOptions.length ? <Text style={routeStyles.routeState}>{routeSearch.trim() ? (language === 'en' ? 'No matching routes.' : 'ไม่พบเส้นทางที่ตรงกัน') : (language === 'en' ? 'No routes are configured yet. Ask an administrator to add one in the Routes dashboard.' : 'ยังไม่มีเส้นทาง ให้ผู้ดูแลเพิ่มในหน้าเส้นทางบนแดชบอร์ด')}</Text> : null}
          {!routesLoading && routesHasMore ? <Text style={routeStyles.routeMore}>{language === 'en' ? 'More routes match. Keep typing to narrow the results.' : 'ยังมีเส้นทางที่ตรงกันอีก กรุณาพิมพ์เพิ่มเพื่อจำกัดผลลัพธ์'}</Text> : null}
          <View style={modalStyles.actions}><Pressable accessibilityRole="button" onPress={() => void loadRoutes(routeSearch)} style={modalStyles.cancel}><Text style={modalStyles.cancelText}>{language === 'en' ? 'Refresh routes' : 'รีเฟรชเส้นทาง'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setRoutesVisible(false)} style={modalStyles.confirm}><Text style={modalStyles.confirmText}>{language === 'en' ? 'Close' : 'ปิด'}</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal animationType="fade" onAccessibilityEscape={dismissVehicleAdmin} onRequestClose={dismissVehicleAdmin} onShow={focusVehicleAdminTitle} statusBarTranslucent transparent visible={vehicleAdminVisible}>
      <ScrollView contentContainerStyle={vehicleAdminStyles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable accessible={false} onPress={dismissVehicleAdmin} style={vehicleAdminStyles.backdrop}>
        <Pressable accessibilityViewIsModal onAccessibilityEscape={dismissVehicleAdmin} onPress={event => event.stopPropagation()} style={modalStyles.card}>
          <RedGpsPin size={42} />
          <Text ref={vehicleAdminTitleRef} accessible accessibilityRole="header" style={modalStyles.title}>{language === 'en' ? 'Change vehicle number' : 'เปลี่ยนหมายเลขรถ'}</Text>
          <Text style={modalStyles.body}>{language === 'en'
            ? `Current vehicle: ${binding.vehicleNumber}\nDevice ID: ${binding.deviceId}`
            : `รถปัจจุบัน: ${binding.vehicleNumber}\nรหัสอุปกรณ์: ${binding.deviceId}`}</Text>
          {selected ? <Text accessibilityRole="alert" style={vehicleAdminStyles.warning}>{language === 'en' ? 'Turn off or cancel the current job before changing the vehicle.' : 'กรุณาปิดหรือยกเลิกงานปัจจุบันก่อนเปลี่ยนรถ'}</Text> : null}
          <Text style={vehicleAdminStyles.label}>{language === 'en' ? 'New vehicle number' : 'หมายเลขรถใหม่'}</Text>
          <TextInput accessibilityLabel={language === 'en' ? 'New vehicle number' : 'หมายเลขรถใหม่'} accessibilityState={{ disabled: changingVehicle }} autoCapitalize="characters" autoCorrect={false} editable={!changingVehicle} maxLength={80} onChangeText={setVehicleAdminInput} placeholder={language === 'en' ? 'Vehicle number' : 'หมายเลขรถ'} placeholderTextColor={colors.grey} style={vehicleAdminStyles.input} value={vehicleAdminInput} />
          <Text style={vehicleAdminStyles.label}>{language === 'en' ? 'Admin password' : 'รหัสผ่านผู้ดูแล'}</Text>
          <TextInput accessibilityLabel={language === 'en' ? 'Admin password' : 'รหัสผ่านผู้ดูแล'} accessibilityState={{ disabled: changingVehicle || Boolean(selected) }} autoCapitalize="none" autoCorrect={false} editable={!changingVehicle && !selected} maxLength={128} onChangeText={setVehicleAdminPassword} onSubmitEditing={() => { void changeVehicle(); }} placeholder={language === 'en' ? 'Enter admin password' : 'กรอกรหัสผ่านผู้ดูแล'} placeholderTextColor={colors.grey} returnKeyType="done" secureTextEntry style={vehicleAdminStyles.input} value={vehicleAdminPassword} />
          {vehicleAdminError ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={vehicleAdminStyles.error}>{vehicleAdminError}</Text> : null}
          <View style={modalStyles.actions}>
            <Pressable accessibilityRole="button" disabled={changingVehicle} onPress={dismissVehicleAdmin} style={[modalStyles.cancel, changingVehicle && layoutStyles.disabled]}><Text style={modalStyles.cancelText}>{language === 'en' ? 'Cancel' : 'ยกเลิก'}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ busy: changingVehicle, disabled: changingVehicle || Boolean(selected) || !vehicleAdminInput.trim() || !vehicleAdminPassword }} disabled={changingVehicle || Boolean(selected) || !vehicleAdminInput.trim() || !vehicleAdminPassword} onPress={() => { void changeVehicle(); }} style={[modalStyles.confirm, (changingVehicle || Boolean(selected) || !vehicleAdminInput.trim() || !vehicleAdminPassword) && layoutStyles.disabled]}><Text style={modalStyles.confirmText}>{changingVehicle ? (language === 'en' ? 'Changing…' : 'กำลังเปลี่ยน…') : (language === 'en' ? 'Change vehicle' : 'เปลี่ยนรถ')}</Text></Pressable>
          </View>
        </Pressable>
        </Pressable>
      </ScrollView>
    </Modal>
    <Modal animationType="slide" onAccessibilityEscape={closeSavedJobs} onRequestClose={closeSavedJobs} statusBarTranslucent visible={jobsVisible}>
      <SafeAreaView style={historyStyles.page} edges={['top', 'right', 'bottom', 'left']}>
        <MobileJobReport
          binding={binding}
          error={jobsError}
          hasMore={jobHistory.pageInfo.hasNextPage}
          jobs={savedJobs}
          language={language}
          loading={jobsLoading}
          loadingMore={jobsLoadingMore}
          monthKeys={jobHistory.facets.months}
          onClose={closeSavedJobs}
          onLoadMore={() => { void refreshSavedJobs(jobHistoryQueryRef.current, jobHistory.pageInfo.page + 1, true); }}
          onQueryChange={query => { jobHistoryQueryRef.current = query; void refreshSavedJobs(query, 1, false); }}
          onRefresh={() => { void refreshSavedJobs(jobHistoryQueryRef.current, 1, false); }}
          onSelectDay={setReportDay}
          portrait={portrait}
          reportDay={reportDay}
          summary={jobHistory.summary}
          totalJobs={jobHistory.pageInfo.total}
        />
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

function formatDuration(ms: number) { const total = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function actionLabel(number: string | null, language: 'en' | 'th') { const action = actions.find(item => item[0] === number); return action ? (language === 'en' ? action[2] : action[1]) : ''; }
function apiFailureMessage(error: unknown) { return error instanceof Error && error.message ? error.message : 'Permanent API rejection'; }

const colors = { red: '#E31B23', maroon: '#7A1424', black: '#111111', grey: '#5E6872', lightGrey: '#EEF0F2', white: '#FFFFFF' };
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.lightGrey }, header: { minHeight: 76, backgroundColor: colors.black, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 }, headerInfo: { flex: 1, minWidth: 0 }, headerTitle: { color: colors.white, fontWeight: '800', letterSpacing: 1 }, headerMeta: { color: '#C8CDD2', fontSize: 12, marginTop: 4 }, headerStatus: { color: '#FFB3B6', fontSize: 11, marginTop: 3 }, language: { color: colors.white, fontWeight: '700' }, content: { padding: 8, flex: 1 }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: colors.grey }, title: { fontSize: 30, fontWeight: '800', color: colors.black, marginTop: 7 }, body: { fontSize: 14, color: colors.grey, marginTop: 8, lineHeight: 21 }, columns: { flex: 1, flexDirection: 'row' }, panel: { flex: 1, backgroundColor: colors.white, borderColor: '#D7DBDF', borderWidth: 1, borderRadius: 8, padding: 8 }, grid: { flex: 1, gap: 8 }, actionRow: { flex: 1, flexDirection: 'row', gap: 8 }, action: { flex: 1, minHeight: 0, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 8, padding: 10 }, actionNumberSlot: { height: '45%', alignItems: 'center', justifyContent: 'flex-end' }, actionTextSlot: { flex: 1, minHeight: 0, width: '100%', alignItems: 'center', paddingTop: 16 }, actionSelected: { borderColor: colors.red, borderWidth: 2, backgroundColor: '#FFF1F1' }, number: { backgroundColor: colors.red, color: colors.white, width: 27, height: 27, borderRadius: 14, textAlign: 'center', textAlignVertical: 'center', fontWeight: '800' }, actionTitle: { fontWeight: '800', color: colors.black, fontSize: 14 }, actionSub: { color: colors.grey, fontSize: 10 }, setup: { flex: 1, justifyContent: 'center', padding: 40, backgroundColor: colors.lightGrey }, setupPage: { flex: 1, backgroundColor: colors.lightGrey }, setupScroll: { flexGrow: 1, justifyContent: 'center', padding: 40 }, loading: { alignItems: 'center', gap: 10 }, setupCard: { maxWidth: 520, width: '100%', alignSelf: 'center', backgroundColor: colors.white, padding: 30, borderRadius: 14, borderWidth: 1, borderColor: '#D7DBDF' }, inputLabel: { color: colors.black, fontSize: 13, fontWeight: '700', marginTop: 22 }, input: { backgroundColor: colors.white, borderColor: '#C8CDD2', borderWidth: 1, borderRadius: 8, padding: 14, marginTop: 6, fontSize: 16, color: colors.black }, primary: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.red, padding: 14, borderRadius: 8, marginTop: 14 }, primaryText: { color: colors.white, textAlign: 'center', fontWeight: '800' }, error: { color: colors.maroon, marginTop: 12, fontSize: 12 },
});

const disabledActionStyles = StyleSheet.create({
  tile: { backgroundColor: '#D9DDDF', borderColor: '#B9C0C5', opacity: 1 },
});

const languageStyles = StyleSheet.create({
  setupButton: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-end', borderWidth: 1, borderColor: '#C8CDD2', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  setupButtonText: { color: colors.black, fontWeight: '800' },
  headerButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});

const routeStyles = StyleSheet.create({
  selector: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#C8CDD2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 8, backgroundColor: '#F8F9FA' },
  selectorCompact: { minHeight: 42, marginBottom: 6, paddingVertical: 5 },
  selectorLocked: { backgroundColor: '#EEF0F2' },
  selectorText: { flex: 1, minWidth: 0 },
  selectorLabel: { color: colors.grey, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  selectorValue: { color: colors.black, fontSize: 15, fontWeight: '800', marginTop: 1 },
  selectorAction: { color: colors.red, fontSize: 12, fontWeight: '800' },
  confirmRoute: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#FFF1F1', color: colors.maroon, fontSize: 12, fontWeight: '800' },
  routeSearch: { minHeight: 46, borderWidth: 1, borderColor: '#9FA8AF', borderRadius: 8, paddingHorizontal: 13, marginTop: 14, color: colors.black, backgroundColor: colors.white, fontSize: 16 },
  routeList: { maxHeight: 300, marginTop: 14 },
  routeOption: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 8, paddingHorizontal: 14, marginBottom: 8, backgroundColor: colors.white },
  routeOptionSelected: { borderColor: colors.red, borderWidth: 2, backgroundColor: '#FFF7F7' },
  routeOptionName: { flex: 1, color: colors.black, fontSize: 16, fontWeight: '800' },
  routeOptionMark: { color: colors.red, fontSize: 18, fontWeight: '800' },
  routeState: { color: colors.grey, fontSize: 13, lineHeight: 19, marginTop: 14 },
  routeMore: { color: colors.grey, fontSize: 11, lineHeight: 16, marginTop: 8 },
  routeError: { color: colors.maroon, fontSize: 12, fontWeight: '700', marginTop: 12 },
});

const modalStyles = StyleSheet.create({ overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }, card: { width: '100%', maxWidth: 420, maxHeight: '90%', backgroundColor: colors.white, borderRadius: 14, padding: 26 }, cardContent: { flexGrow: 1 }, title: { color: colors.black, fontSize: 22, fontWeight: '800', marginTop: 12 }, body: { color: colors.grey, fontSize: 14, lineHeight: 21, marginTop: 8 }, actions: { gap: 8, marginTop: 24 }, cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#D7DBDF' }, cancelText: { color: colors.black, fontWeight: '700', textAlign: 'center' }, cancelJob: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.red, backgroundColor: '#FFF1F1' }, cancelJobText: { color: colors.red, fontWeight: '800', textAlign: 'center' }, confirm: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, backgroundColor: colors.red }, confirmText: { color: colors.white, fontWeight: '800', textAlign: 'center' } });
const vehicleAdminStyles = StyleSheet.create({ scroll: { flexGrow: 1, padding: 24 }, backdrop: { flex: 1, width: '100%', minHeight: '100%', backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 0 }, label: { color: colors.black, fontSize: 13, fontWeight: '800', marginTop: 16 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#C8CDD2', borderRadius: 8, paddingHorizontal: 13, marginTop: 6, color: colors.black, backgroundColor: colors.white, fontSize: 16 }, warning: { color: colors.maroon, backgroundColor: '#FFF1F1', borderRadius: 7, padding: 10, marginTop: 14, fontSize: 12, fontWeight: '700' }, error: { color: colors.maroon, marginTop: 12, fontSize: 12, fontWeight: '700' } });
const historyStyles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.lightGrey } });
const headerUtilityStyles = StyleSheet.create({ button: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: '#4D5358', borderRadius: 7, paddingHorizontal: 13 }, buttonCompact: { minHeight: 48, paddingHorizontal: 9 }, buttonText: { color: colors.white, fontWeight: '800', fontSize: 12 } });
const readableStyles = StyleSheet.create({ action: { alignItems: 'center' }, number: { width: 38, height: 38, borderRadius: 19, fontSize: 17 }, disabledNumber: { backgroundColor: '#727A80', color: '#FFFFFF' }, actionTitle: { fontSize: 18, lineHeight: 24, textAlign: 'center' }, actionSub: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 8 }, disabledText: { color: '#596167' } });
const layoutStyles = StyleSheet.create({ headerTitlePortrait: { fontSize: 12 }, contentPortrait: { padding: 8 }, disabled: { opacity: 0.48 } });
const accessibilityStyles = StyleSheet.create({ header: { flexWrap: 'wrap', paddingVertical: 10 }, headerInfo: { minWidth: 180 }, content: { padding: 6 }, panel: { padding: 6 }, grid: { gap: 6 }, actionRow: { gap: 6 }, action: { padding: 6 }, actionNumberSlot: { height: '32%' }, actionTextSlot: { paddingTop: 4 } });
const compactStyles = StyleSheet.create({
  header: { minHeight: 60, paddingHorizontal: 10, gap: 7 },
  headerTitle: { fontSize: 11, letterSpacing: 0.5 },
  headerMeta: { fontSize: 10, marginTop: 2 },
  headerStatus: { fontSize: 9, marginTop: 1 },
  content: { padding: 5 },
  panel: { padding: 5 },
  grid: { gap: 5 },
  actionRow: { gap: 5 },
  action: { padding: 4 },
  actionNumberSlot: { height: '38%' },
  actionTextSlot: { paddingTop: 0 },
  number: { width: 28, height: 28, borderRadius: 14, fontSize: 14 },
  actionTitle: { fontSize: 13, lineHeight: 15 },
  actionSub: { fontSize: 10, lineHeight: 12, marginTop: 2 },
  setupScroll: { padding: 16 },
  setupCard: { padding: 20 },
  setupTitle: { fontSize: 24 },
});
