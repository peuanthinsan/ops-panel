import { useEffect, useRef, useState } from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { AccessibilityInfo, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RedGpsPin } from '../components/RedGpsPin';
import { operationActions } from '../lib/actions';
import { fetchDeviceJobs, fetchDriverIdentity, fetchVehicleBinding, fetchVehicleMotion, requestJobGpsSync, saveJob, saveJobStart, saveVehicleBinding } from '../lib/api';
import { isDeviceAccessError, isRetryableApiError } from '../lib/api-error';
import { clearActiveJob, clearBinding, finalizeActiveJob, getActiveJob, getBinding, getDeviceId, persistActiveJob, persistBinding, type ActiveJob, type DeviceBinding } from '../lib/device';
import { activeJobBelongsToBinding, deviceBindingKey, mobileStartupReady, recoverBindingFromActiveJob, shouldPreserveLocalBindingWithoutRemote, waitingCancellationBindingDecision } from '../lib/device-state';
import { driverHeaderText } from '../lib/driver-display';
import { driverLookupBelongsToBinding } from '../lib/driver-identity';
import { deliverJobReport } from '../lib/job-delivery';
import { createJobId, decideAction, isActionUnavailable, jobInitiatedAt, reportDriver, snapshotDriver, type DriverIdentity } from '../lib/job-flow';
import { enqueueJobReport, listPendingJobReports, listStoredJobReports, markPendingJobReportPermanentFailure, removePendingJobReport } from '../lib/job-outbox';
import { enqueueJobStart, listPendingJobStarts, markPendingJobStartPermanentFailure, removePendingJobStart } from '../lib/job-start-outbox';
import { useLanguage } from '../lib/language';
import { mobileOperationErrorMessage } from '../lib/mobile-error-copy';
import { usesCompactLandscapeLayout } from '../lib/mobile-layout';
import { motionStartsJob } from '../lib/motion-state';
import { finalReportForIntent } from '../lib/report-recovery';
import type { JobStartInput } from '../lib/job-start';
import type { JobReportInput } from '../lib/report';
import { serverNowMs } from '../lib/server-clock';
import { mergeSavedJobs, type SavedJob } from '../lib/saved-jobs';

const actions = operationActions;
const actionRows = [actions.slice(0, 3), actions.slice(3, 6), actions.slice(6, 9)];
const JOB_GPS_SYNC_INTERVAL_MS = 60_000;

function scheduleIdleTask(task: () => void) {
  const callbackId = requestIdleCallback(task, { timeout: 1000 });
  return () => cancelIdleCallback(callbackId);
}

export default function Index() {
  useKeepAwake('songdee-ops-panel');
  const { language, setLanguage, t } = useLanguage();
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const compactLandscape = usesCompactLandscapeLayout(width, height);
  const [binding, setBinding] = useState<DeviceBinding | null>(null);
  const [bindingChecked, setBindingChecked] = useState(false);
  const [deviceAccessBlocked, setDeviceAccessBlocked] = useState(false);
  const [bindingRefreshToken, setBindingRefreshToken] = useState(0);
  const [recoveredBindingKey, setRecoveredBindingKey] = useState<string | null>(null);
  const [driverIdentity, setDriverIdentity] = useState<DriverIdentity>(null);
  const [jobDriverIdentity, setJobDriverIdentity] = useState<DriverIdentity>(null);
  const [vehicleInput, setVehicleInput] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [awaitingMovement, setAwaitingMovement] = useState(false);
  const [pendingReport, setPendingReport] = useState<JobReportInput | null>(null);
  const [confirmType, setConfirmType] = useState<'start' | 'finish' | 'cancel' | null>(null);
  const [message, setMessage] = useState('');
  const [savingSetup, setSavingSetup] = useState(false);
  const [startingJob, setStartingJob] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [jobsVisible, setJobsVisible] = useState(false);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const pendingReportRef = useRef<JobReportInput | null>(null);
  const confirmationTitleRef = useRef<Text | null>(null);
  const headerTitleRef = useRef<Text | null>(null);
  const actionButtonRefs = useRef<Record<string, View | null>>({});
  const cancelJobButtonRef = useRef<View | null>(null);
  const confirmationTriggerNodeRef = useRef<number | null>(null);
  const focusRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const restoreConfirmationTriggerFocus = () => {
    const node = confirmationTriggerNodeRef.current;
    if (!node) return;
    if (focusRestoreTimerRef.current) clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = setTimeout(() => {
      AccessibilityInfo.setAccessibilityFocus(node);
      focusRestoreTimerRef.current = null;
    }, 100);
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
        setActiveJobId(restoredJobId);
        setStartedAt(storedJob.startedAt || null);
        setAwaitingMovement(Boolean(storedJob.awaitingMovement));
        updatePendingReport(storedJob.pendingReport ?? null);
        const restoredDriver = snapshotDriver({ driverName: storedJob.driverName, driverId: storedJob.driverId });
        setJobDriverIdentity(restoredDriver);
        if (!storedJob.jobId) void persistActiveJob({ ...storedJob, jobId: restoredJobId }).catch(() => { /* Older active jobs remain usable if migration persistence fails. */ });
        if (storedJob.startedAt) void queueJobStartForSync({ id: restoredJobId, vehicleNumber: storedJob.vehicleNumber, deviceId: storedJob.deviceId, driverName: restoredDriver?.driverName ?? null, driverId: restoredDriver?.driverId ?? null, mode: actionLabel(storedJob.selected, 'en'), startTime: new Date(storedJob.startedAt).toISOString() });
        setMessage(storedJob.pendingReport
          ? storedJob.pendingReport.status === 'Cancelled'
            ? (language === 'en' ? 'Cancellation restored — retry saving it' : 'กู้คืนการยกเลิกงาน — กรุณาลองบันทึกอีกครั้ง')
            : (language === 'en' ? 'Completed job restored — tap Done to retry saving it' : 'กู้คืนงานที่จบแล้ว — กดจบงานเพื่อลองบันทึกอีกครั้ง')
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
    const timer = setInterval(() => { void sync(); }, JOB_GPS_SYNC_INTERVAL_MS);
    return () => { active = false; cancelIdleTask(); clearInterval(timer); };
  }, [activeJobId, binding?.deviceId, binding?.vehicleNumber, pendingReport, startedAt]);

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
        await persistActiveJob({ jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, selected, startedAt: timestamp, driverName: startedDriver?.driverName ?? null, driverId: startedDriver?.driverId ?? null });
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
      void queueJobStartForSync({ id: jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: startedDriver?.driverName ?? null, driverId: startedDriver?.driverId ?? null, mode: actionLabel(selected, 'en'), startTime: new Date(timestamp).toISOString() });
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
  }, [activeJobId, awaitingMovement, binding?.deviceId, binding?.vehicleNumber, driverIdentity?.driverId, driverIdentity?.driverName, jobDriverIdentity, language, pendingReport, selected]);

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

  function selectAction(number: string) {
    if (number === '9' && pendingReport?.status === 'Cancelled') {
      setMessage(language === 'en' ? 'Cancellation is pending — use Retry cancellation' : 'กำลังรอบันทึกการยกเลิก — กดลองบันทึกการยกเลิกอีกครั้ง');
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
    setSelected(number);
    setConfirmType('start');
  }
  function dismissConfirmation() { if (savingJob) return; if (confirmType === 'start') setSelected(null); setConfirmType(null); restoreConfirmationTriggerFocus(); }

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
        const stored = await persistNewActiveJob({ jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, selected, startedAt: 0, awaitingMovement: true, driverName: pendingDriver?.driverName ?? null, driverId: pendingDriver?.driverId ?? null });
        if (!stored) return;
        setActiveJobId(jobId);
        setJobDriverIdentity(pendingDriver);
        setAwaitingMovement(true);
        setMessage(waitMessage);
        return;
      }
      const timestamp = serverNowMs();
      const stored = await persistNewActiveJob({ jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, selected, startedAt: timestamp, driverName: pendingDriver?.driverName ?? null, driverId: pendingDriver?.driverId ?? null });
      if (!stored) return;
      setActiveJobId(jobId);
      setJobDriverIdentity(pendingDriver);
      setStartedAt(timestamp);
      setAwaitingMovement(false);
      setMessage(language === 'en' ? 'Vehicle started' : 'รถเริ่มแล้ว');
      void queueJobStartForSync({ id: jobId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: pendingDriver?.driverName ?? null, driverId: pendingDriver?.driverId ?? null, mode: actionLabel(selected, 'en'), startTime: new Date(timestamp).toISOString() });
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

  async function confirmFinish() {
    if (savingJob || !binding || !selected || (!startedAt && !awaitingMovement)) return;
    const fallbackStart = startedAt ?? jobInitiatedAt(activeJobId) ?? serverNowMs();
    const reportId = activeJobId ?? createJobId(binding.deviceId, selected, fallbackStart);
    setSavingJob(true);
    try {
      const report = finalReportForIntent(pendingReport, 'completed', () => {
        const end = Math.max(serverNowMs(), fallbackStart);
        const jobDriver = reportDriver(jobDriverIdentity, driverIdentity);
        return { id: reportId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: jobDriver?.driverName || null, driverId: jobDriver?.driverId || null, mode: actionLabel(selected, 'en'), startTime: new Date(fallbackStart).toISOString(), endTime: new Date(end).toISOString(), duration: formatDuration(end - fallbackStart) };
      });
      if (!report) {
        setMessage(language === 'en' ? 'Cancellation is already pending' : 'กำลังรอบันทึกการยกเลิกงาน');
        return;
      }
      if (!pendingReport && !await persistPendingFinalReport(report)) return;
      const syncState = await saveOrQueueJob(report);
      if (syncState === 'synced') {
        void requestJobGpsSync({ jobId: report.id, vehicleNumber: report.vehicleNumber, deviceId: report.deviceId, targetAt: report.endTime }).catch(() => { /* The next reconciliation can backfill this point. */ });
      }
      await removePendingJobStart(reportId).catch(() => { /* Server-side report creation also closes the active start. */ });
      const localStateFinalized = await finalizeActiveJob();
      const deliveryMessage = syncState === 'synced'
        ? (language === 'en' ? 'Job saved to dashboard' : 'บันทึกงานไปยังแดชบอร์ดแล้ว')
        : (language === 'en' ? 'Job saved on tablet — dashboard sync pending' : 'บันทึกงานในแท็บเล็ตแล้ว — รอส่งไปยังแดชบอร์ด');
      setMessage(localStateFinalized
        ? deliveryMessage
        : `${deliveryMessage}${language === 'en' ? ' — local cleanup failed; tap Done again before starting another job' : ' — ล้างข้อมูลงานในเครื่องไม่สำเร็จ กรุณากดจบงานอีกครั้งก่อนเริ่มงานใหม่'}`);
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
      setMessage(mobileOperationErrorMessage(error, language, 'finish'));
    } finally {
      setSavingJob(false);
      setConfirmType(null);
      restoreConfirmationTriggerFocus();
    }
  }

  async function confirmCancel() {
    if (savingJob || !binding || !selected) return;
    const reportId = activeJobId ?? createJobId(binding.deviceId, selected, startedAt ?? serverNowMs());
    setSavingJob(true);
    try {
      if (awaitingMovement && !startedAt && !pendingReport) {
        let remoteBinding: DeviceBinding | null;
        try {
          remoteBinding = await fetchVehicleBinding(binding.deviceId);
        } catch {
          setMessage(language === 'en'
            ? 'Connect to the server before cancelling this not-yet-started job.'
            : 'กรุณาเชื่อมต่อเซิร์ฟเวอร์ก่อนยกเลิกงานที่ยังไม่เริ่ม');
          return;
        }
        const bindingDecision = waitingCancellationBindingDecision(binding, remoteBinding);
        if (bindingDecision !== 'proceed') {
          const localStateFinalized = await finalizeActiveJob();
          if (!localStateFinalized) {
            setMessage(language === 'en'
              ? 'Vehicle connection changed, but local cleanup failed. Retry cancellation.'
              : 'การเชื่อมต่อรถเปลี่ยนแล้ว แต่ล้างข้อมูลงานในเครื่องไม่สำเร็จ กรุณาลองยกเลิกอีกครั้ง');
            return;
          }
          if (remoteBinding) await persistBinding(remoteBinding).catch(() => { /* The live binding remains usable for this session. */ });
          else await clearBinding().catch(() => { /* The next startup will reconcile the removed binding. */ });
          setBinding(remoteBinding);
          setDriverIdentity(null);
          setJobDriverIdentity(null);
          setSelected(null);
          setActiveJobId(null);
          setStartedAt(null);
          setAwaitingMovement(false);
          updatePendingReport(null);
          setMessage(bindingDecision === 'binding_removed'
            ? (language === 'en' ? 'Vehicle connection removed by admin; the unstarted selection was cleared.' : 'ผู้ดูแลยกเลิกการเชื่อมต่อรถแล้ว ระบบล้างกิจกรรมที่ยังไม่เริ่ม')
            : (language === 'en' ? 'Vehicle connection updated by admin; the unstarted selection was cleared.' : 'ผู้ดูแลอัปเดตการเชื่อมต่อรถแล้ว ระบบล้างกิจกรรมที่ยังไม่เริ่ม'));
          return;
        }
      }
      const report = finalReportForIntent(pendingReport, 'cancelled', () => {
        const end = serverNowMs();
        const effectiveStart = startedAt ?? end;
        const jobDriver = reportDriver(jobDriverIdentity, driverIdentity);
        return { id: reportId, vehicleNumber: binding.vehicleNumber, deviceId: binding.deviceId, driverName: jobDriver?.driverName || null, driverId: jobDriver?.driverId || null, mode: actionLabel(selected, 'en'), startTime: new Date(effectiveStart).toISOString(), endTime: new Date(end).toISOString(), duration: formatDuration(end - effectiveStart), status: 'Cancelled' };
      });
      if (!report) {
        setMessage(language === 'en' ? 'Job completion is already pending — tap Done to retry' : 'กำลังรอบันทึกการจบงาน — กดจบงานเพื่อลองอีกครั้ง');
        return;
      }
      if (!pendingReport && !await persistPendingFinalReport(report)) return;
      const syncState = await saveOrQueueJob(report);
      await removePendingJobStart(reportId).catch(() => { /* Server-side report creation also closes the active start. */ });
      const localStateFinalized = await finalizeActiveJob();
      const deliveryMessage = syncState === 'synced'
        ? (language === 'en' ? 'Job cancelled and recorded' : 'ยกเลิกและบันทึกงานแล้ว')
        : (language === 'en' ? 'Cancellation saved on tablet — dashboard sync pending' : 'บันทึกการยกเลิกในแท็บเล็ตแล้ว — รอส่งไปยังแดชบอร์ด');
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

  async function refreshSavedJobs() {
    if (!binding || jobsLoading) return;
    setJobsLoading(true);
    setJobsError('');
    let serverJobs: SavedJob[] = [];
    let remoteFailed = false;
    try {
      serverJobs = await fetchDeviceJobs(binding.deviceId, binding.vehicleNumber);
    } catch {
      remoteFailed = true;
    }
    try {
      const localJobs = await listStoredJobReports(100);
      setSavedJobs(mergeSavedJobs(binding, serverJobs, localJobs));
    } catch {
      setSavedJobs(serverJobs);
      remoteFailed = true;
    }
    if (remoteFailed) setJobsError(language === 'en' ? 'Could not refresh the dashboard. Showing jobs saved on this tablet.' : 'ไม่สามารถโหลดข้อมูลจากแดชบอร์ด แสดงงานที่บันทึกในแท็บเล็ต');
    setJobsLoading(false);
  }

  function openSavedJobs() {
    setJobsVisible(true);
    void refreshSavedJobs();
  }

  const setupDisabled = savingSetup || !vehicleInput.trim();

  if (!mobileStartupReady(bindingChecked, binding, recoveredBindingKey)) return <SafeAreaView style={styles.setup} edges={['top', 'right', 'bottom', 'left']}><View style={styles.loading}><RedGpsPin size={58} /><Text style={styles.eyebrow}>SONGDEE OPS PANEL</Text><Text accessibilityLiveRegion="polite" style={styles.body}>{language === 'en' ? 'Restoring vehicle and job state…' : 'กำลังกู้คืนข้อมูลรถและสถานะงาน…'}</Text></View></SafeAreaView>;

  if (deviceAccessBlocked) return <SafeAreaView style={styles.setupPage} edges={['top', 'right', 'bottom', 'left']}>
    <View style={styles.setupScroll}>
      <View style={styles.setupCard}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Switch to Thai' : 'เปลี่ยนเป็นภาษาอังกฤษ'} onPress={() => setLanguage(language === 'en' ? 'th' : 'en')} style={languageStyles.setupButton}><Text style={languageStyles.setupButtonText}>{language === 'en' ? 'ไทย' : 'EN'}</Text></Pressable>
        <RedGpsPin size={58} />
        <Text style={styles.eyebrow}>SONGDEE OPS PANEL</Text>
        <Text accessibilityRole="header" style={styles.title}>{language === 'en' ? 'Device access needs reset' : 'ต้องรีเซ็ตสิทธิ์อุปกรณ์'}</Text>
        <Text style={styles.body}>{language === 'en' ? 'Ask a fleet administrator to reset access for this Android device, then try again. Your saved jobs remain on this tablet.' : 'กรุณาให้ผู้ดูแลฝูงรถรีเซ็ตสิทธิ์ของอุปกรณ์ Android เครื่องนี้ แล้วลองอีกครั้ง งานที่บันทึกไว้ยังคงอยู่ในแท็บเล็ต'}</Text>
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
          accessibilityHint={language === 'en' ? 'Later changes must be made in Fleet admin.' : 'การเปลี่ยนภายหลังต้องทำในหน้าจัดการฝูงรถ'}
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
    ? (language === 'en' ? 'Confirm this mode?' : 'ยืนยันกิจกรรมนี้หรือไม่?')
    : confirmType === 'finish'
      ? (language === 'en' ? 'Finish and save this job?' : 'จบงานและบันทึกหรือไม่?')
      : (language === 'en' ? 'Cancel this job?' : 'ยกเลิกงานนี้หรือไม่?');
  const confirmationDismissLabel = confirmType === 'start'
    ? (language === 'en' ? 'Choose another mode' : 'เลือกกิจกรรมอื่น')
    : (language === 'en' ? 'Keep current job' : 'ทำงานปัจจุบันต่อ');
  const confirmationSubmitLabel = confirmType === 'start'
    ? (language === 'en' ? `Confirm ${actionLabel(selected, language)}` : `ยืนยัน ${actionLabel(selected, language)}`)
    : confirmType === 'finish'
      ? (language === 'en' ? 'Finish and save job' : 'จบและบันทึกงาน')
      : (language === 'en' ? 'Confirm job cancellation' : 'ยืนยันการยกเลิกงาน');
  return <SafeAreaView style={styles.page} edges={['top', 'right', 'bottom', 'left']}>
    <View style={[styles.header, compactLandscape && compactStyles.header]}>
      <RedGpsPin size={compactLandscape ? 30 : 38} />
      <View style={styles.headerInfo}>
        <Text ref={headerTitleRef} accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, portrait && layoutStyles.headerTitlePortrait, compactLandscape && compactStyles.headerTitle]}>SONGDEE OPS PANEL · {binding.vehicleNumber}</Text>
        <Text numberOfLines={1} style={[styles.headerMeta, compactLandscape && compactStyles.headerMeta]}>{driverSummary}</Text>
        {message ? <Text accessibilityLiveRegion="polite" numberOfLines={compactLandscape ? 1 : 2} style={[styles.headerStatus, compactLandscape && compactStyles.headerStatus]}>{message}</Text> : null}
      </View>
      {(startedAt || awaitingMovement) && (!pendingReport || pendingReport.status === 'Cancelled') ? <Pressable ref={cancelJobButtonRef} accessibilityRole="button" accessibilityLabel={pendingReport ? (language === 'en' ? 'Retry cancellation' : 'ลองบันทึกการยกเลิกอีกครั้ง') : (language === 'en' ? 'Cancel current job' : 'ยกเลิกงานปัจจุบัน')} onPress={() => { rememberConfirmationTrigger(cancelJobButtonRef.current); setConfirmType('cancel'); }} style={[readableStyles.cancelJob, compactLandscape && compactStyles.cancelJob]}><Text style={[readableStyles.cancelJobText, compactLandscape && compactStyles.cancelJobText]}>{pendingReport ? (language === 'en' ? 'Retry cancellation' : 'ลองบันทึกอีกครั้ง') : (language === 'en' ? 'Cancel job' : 'ยกเลิกงาน')}</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'View saved jobs' : 'ดูงานที่บันทึก'} onPress={openSavedJobs} style={[historyStyles.headerButton, compactLandscape && historyStyles.headerButtonCompact]}><Text style={historyStyles.headerButtonText}>{language === 'en' ? 'Jobs' : 'งาน'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Switch to Thai' : 'เปลี่ยนเป็นภาษาอังกฤษ'} onPress={() => setLanguage(language === 'en' ? 'th' : 'en')} style={languageStyles.headerButton}><Text style={styles.language}>{language === 'en' ? 'ไทย' : 'EN'}</Text></Pressable>
    </View>
    <View style={[styles.content, portrait && layoutStyles.contentPortrait, compactLandscape && compactStyles.content]}>
      <View style={[styles.columns, portrait && layoutStyles.columnsPortrait]}>
        <View style={[styles.panel, compactLandscape && compactStyles.panel]}>
          <View style={[styles.grid, compactLandscape && compactStyles.grid]}>
            {actionRows.map((row, rowIndex) => (
              <View style={[styles.actionRow, compactLandscape && compactStyles.actionRow]} key={rowIndex}>
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
                        number === '9' && styles.done,
                        selected === number && styles.actionSelected,
                        unavailable && selected !== number && disabledActionStyles.tile,
                      ]}
                    >
                      <Text style={[styles.number, readableStyles.number, compactLandscape && compactStyles.number, unavailable && selected !== number && readableStyles.disabledNumber]}>{number}</Text>
                      <Text style={[styles.actionTitle, readableStyles.actionTitle, compactLandscape && compactStyles.actionTitle, unavailable && selected !== number && readableStyles.disabledText]}>{language === 'en' ? english : thai}</Text>
                      <Text style={[styles.actionSub, readableStyles.actionSub, compactLandscape && compactStyles.actionSub, unavailable && selected !== number && readableStyles.disabledText]}>{language === 'en' ? englishDescription : thaiDescription}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
    <Modal animationType="fade" onRequestClose={dismissConfirmation} onShow={focusConfirmationTitle} statusBarTranslucent transparent visible={confirmType !== null}>
      {confirmType ? <View style={modalStyles.overlay}><View accessibilityViewIsModal onAccessibilityEscape={dismissConfirmation} style={modalStyles.card}><RedGpsPin size={42} /><Text ref={confirmationTitleRef} accessible accessibilityLiveRegion="assertive" accessibilityRole="header" style={modalStyles.title}>{confirmationTitle}</Text><Text style={modalStyles.body}>{confirmType === 'start' ? (language === 'en' ? `Mode: ${actionLabel(selected, language)}\nThe start time will be recorded when the vehicle moves.` : `กิจกรรม: ${actionLabel(selected, language)}\nระบบจะบันทึกเวลาเริ่มเมื่อรถเคลื่อนที่`) : confirmType === 'finish' ? awaitingMovement && !startedAt ? (language === 'en' ? 'Movement has not been detected. The mode confirmation time will be used as the start time, and the job will be saved to the dashboard.' : 'ยังไม่ตรวจพบการเคลื่อนที่ ระบบจะใช้เวลาที่ยืนยันกิจกรรมเป็นเวลาเริ่ม และบันทึกงานไปยังแดชบอร์ด') : (language === 'en' ? 'The completed job will be saved and sent to the web dashboard.' : 'ระบบจะบันทึกงานที่เสร็จแล้วและส่งไปยังแดชบอร์ดเว็บ') : (language === 'en' ? 'The job will be recorded as cancelled.' : 'งานนี้จะถูกบันทึกเป็นงานที่ยกเลิก')}</Text><View style={modalStyles.actions}><Pressable accessibilityLabel={confirmationDismissLabel} accessibilityRole="button" accessibilityState={{ disabled: savingJob }} disabled={savingJob} onPress={dismissConfirmation} style={[modalStyles.cancel, savingJob && layoutStyles.disabled]}><Text style={modalStyles.cancelText}>{confirmType === 'start' ? (language === 'en' ? 'Choose another' : 'เลือกกิจกรรมอื่น') : (language === 'en' ? 'Keep job' : 'ทำงานต่อ')}</Text></Pressable><Pressable accessibilityLabel={confirmationSubmitLabel} accessibilityRole="button" accessibilityState={{ disabled: savingJob, busy: savingJob }} disabled={savingJob} onPress={confirmType === 'start' ? confirmStart : confirmType === 'finish' ? confirmFinish : confirmCancel} style={[modalStyles.confirm, savingJob && layoutStyles.disabled]}><Text style={modalStyles.confirmText}>{savingJob ? (language === 'en' ? 'Saving…' : 'กำลังบันทึก…') : confirmType === 'cancel' ? (language === 'en' ? 'Cancel job' : 'ยกเลิกงาน') : (language === 'en' ? 'Confirm' : 'ยืนยัน')}</Text></Pressable></View></View></View> : null}
    </Modal>
    <Modal animationType="slide" onRequestClose={() => setJobsVisible(false)} statusBarTranslucent visible={jobsVisible}>
      <SafeAreaView style={historyStyles.page} edges={['top', 'right', 'bottom', 'left']}>
        <View style={historyStyles.header}>
          <RedGpsPin size={34} />
          <View style={historyStyles.headerInfo}>
            <Text accessibilityRole="header" style={historyStyles.title}>{language === 'en' ? 'Saved jobs' : 'งานที่บันทึก'}</Text>
            <Text numberOfLines={1} style={historyStyles.subtitle}>{binding.vehicleNumber} · {binding.deviceId}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Refresh saved jobs' : 'รีเฟรชงานที่บันทึก'} disabled={jobsLoading} onPress={() => { void refreshSavedJobs(); }} style={historyStyles.secondaryButton}><Text style={historyStyles.secondaryButtonText}>{jobsLoading ? '…' : (language === 'en' ? 'Refresh' : 'รีเฟรช')}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Close saved jobs' : 'ปิดรายการงาน'} onPress={() => setJobsVisible(false)} style={historyStyles.closeButton}><Text style={historyStyles.closeButtonText}>×</Text></Pressable>
        </View>
        {jobsError ? <Text accessibilityRole="alert" style={historyStyles.error}>{jobsError}</Text> : null}
        <FlatList
          contentContainerStyle={[historyStyles.list, !savedJobs.length && historyStyles.emptyList]}
          data={savedJobs}
          key={portrait ? 'portrait-jobs' : 'landscape-jobs'}
          keyExtractor={item => item.id}
          numColumns={portrait ? 1 : 2}
          refreshing={jobsLoading}
          onRefresh={refreshSavedJobs}
          renderItem={({ item }) => <View style={[historyStyles.jobCard, !portrait && historyStyles.jobCardLandscape]}>
            <View style={historyStyles.jobTopRow}>
              <Text style={historyStyles.jobMode}>{localizedJobMode(item.mode, language)}</Text>
              <Text style={[historyStyles.jobStatus, item.status === 'Cancelled' && historyStyles.cancelledStatus, item.pendingUpload && historyStyles.pendingStatus, item.uploadFailed && historyStyles.failedStatus]}>{savedJobStatus(item, language)}</Text>
            </View>
            <Text style={historyStyles.jobTime}>{formatJobDate(item.startTime, language)} — {formatJobDate(item.endTime, language)}</Text>
            <Text style={historyStyles.jobMeta}>{language === 'en' ? 'Duration' : 'ระยะเวลา'} {item.duration} · {item.driverName || (language === 'en' ? 'No driver identified' : 'ไม่พบข้อมูลพนักงานขับรถ')}</Text>
            <Text numberOfLines={1} style={historyStyles.jobId}>{item.id}</Text>
          </View>}
          ListEmptyComponent={<View style={historyStyles.empty}><Text style={historyStyles.emptyTitle}>{jobsLoading ? (language === 'en' ? 'Loading jobs…' : 'กำลังโหลดงาน…') : (language === 'en' ? 'No saved jobs yet' : 'ยังไม่มีงานที่บันทึก')}</Text><Text style={historyStyles.emptyBody}>{language === 'en' ? 'Finished and cancelled jobs for this vehicle will appear here.' : 'งานที่จบหรือยกเลิกของรถคันนี้จะแสดงที่นี่'}</Text></View>}
        />
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

function formatDuration(ms: number) { const total = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function actionLabel(number: string | null, language: 'en' | 'th') { const action = actions.find(item => item[0] === number); return action ? (language === 'en' ? action[2] : action[1]) : ''; }
function apiFailureMessage(error: unknown) { return error instanceof Error && error.message ? error.message : 'Permanent API rejection'; }
function localizedJobMode(mode: string, language: 'en' | 'th') { const action = actions.find(item => item[2] === mode); return language === 'th' && action ? action[1] : mode; }
function formatJobDate(value: string, language: 'en' | 'th') { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(language === 'en' ? 'en-GB' : 'th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : value; }
function savedJobStatus(job: SavedJob, language: 'en' | 'th') { if (job.uploadFailed) return language === 'en' ? 'Needs attention' : 'ต้องตรวจสอบ'; if (job.pendingUpload) return language === 'en' ? 'Waiting to sync' : 'รอซิงค์'; if (job.status === 'Cancelled') return language === 'en' ? 'Cancelled' : 'ยกเลิก'; return language === 'en' ? 'Saved' : 'บันทึกแล้ว'; }

const colors = { red: '#E31B23', maroon: '#7A1424', black: '#111111', grey: '#68727D', lightGrey: '#EEF0F2', white: '#FFFFFF' };
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.lightGrey }, header: { minHeight: 76, backgroundColor: colors.black, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 }, headerInfo: { flex: 1, minWidth: 0 }, headerTitle: { color: colors.white, fontWeight: '800', letterSpacing: 1 }, headerMeta: { color: '#C8CDD2', fontSize: 12, marginTop: 4 }, headerStatus: { color: '#FFB3B6', fontSize: 11, marginTop: 3 }, language: { color: colors.white, fontWeight: '700' }, content: { padding: 8, flex: 1 }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: colors.grey }, title: { fontSize: 30, fontWeight: '800', color: colors.black, marginTop: 7 }, body: { fontSize: 14, color: colors.grey, marginTop: 8, lineHeight: 21 }, columns: { flex: 1, flexDirection: 'row' }, panel: { flex: 1, backgroundColor: colors.white, borderColor: '#D7DBDF', borderWidth: 1, borderRadius: 8, padding: 8 }, grid: { flex: 1, gap: 8 }, actionRow: { flex: 1, flexDirection: 'row', gap: 8 }, action: { flex: 1, minHeight: 0, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 8, padding: 10, justifyContent: 'center' }, actionSelected: { borderColor: colors.red, borderWidth: 2 }, done: { backgroundColor: '#FFF1F1' }, number: { backgroundColor: colors.red, color: colors.white, width: 27, height: 27, borderRadius: 14, textAlign: 'center', textAlignVertical: 'center', fontWeight: '800', marginBottom: 10 }, actionTitle: { fontWeight: '800', color: colors.black, fontSize: 14 }, actionSub: { color: colors.grey, fontSize: 10, marginTop: 4 }, setup: { flex: 1, justifyContent: 'center', padding: 40, backgroundColor: colors.lightGrey }, setupPage: { flex: 1, backgroundColor: colors.lightGrey }, setupScroll: { flexGrow: 1, justifyContent: 'center', padding: 40 }, loading: { alignItems: 'center', gap: 10 }, setupCard: { maxWidth: 520, width: '100%', alignSelf: 'center', backgroundColor: colors.white, padding: 30, borderRadius: 14, borderWidth: 1, borderColor: '#D7DBDF' }, inputLabel: { color: colors.black, fontSize: 13, fontWeight: '700', marginTop: 22 }, input: { backgroundColor: colors.white, borderColor: '#C8CDD2', borderWidth: 1, borderRadius: 8, padding: 14, marginTop: 6, fontSize: 16, color: colors.black }, primary: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.red, padding: 14, borderRadius: 8, marginTop: 14 }, primaryText: { color: colors.white, textAlign: 'center', fontWeight: '800' }, error: { color: colors.maroon, marginTop: 12, fontSize: 12 },
});

const disabledActionStyles = StyleSheet.create({
  tile: { backgroundColor: '#D9DDDF', borderColor: '#B9C0C5', opacity: 1 },
});

const languageStyles = StyleSheet.create({
  setupButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end', borderWidth: 1, borderColor: '#C8CDD2', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  setupButtonText: { color: colors.black, fontWeight: '800' },
  headerButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});

const modalStyles = StyleSheet.create({ overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }, card: { width: '100%', maxWidth: 420, backgroundColor: colors.white, borderRadius: 14, padding: 26 }, title: { color: colors.black, fontSize: 22, fontWeight: '800', marginTop: 12 }, body: { color: colors.grey, fontSize: 14, lineHeight: 21, marginTop: 8 }, actions: { flexDirection: 'row', gap: 8, marginTop: 24 }, cancel: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#D7DBDF' }, cancelText: { color: colors.black, fontWeight: '700', textAlign: 'center' }, confirm: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, backgroundColor: colors.red }, confirmText: { color: colors.white, fontWeight: '800', textAlign: 'center' } });
const historyStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.lightGrey },
  header: { minHeight: 76, backgroundColor: colors.black, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  headerInfo: { flex: 1, minWidth: 0 },
  title: { color: colors.white, fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#C8CDD2', fontSize: 11, marginTop: 3 },
  headerButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#4D5358', borderRadius: 7, paddingHorizontal: 13 },
  headerButtonCompact: { minHeight: 40, paddingHorizontal: 9 },
  headerButtonText: { color: colors.white, fontWeight: '800', fontSize: 12 },
  secondaryButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#5C6268', borderRadius: 7, paddingHorizontal: 12 },
  secondaryButtonText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: colors.white, fontSize: 30, lineHeight: 32 },
  error: { color: colors.maroon, backgroundColor: '#FFE8E9', paddingHorizontal: 16, paddingVertical: 10, fontWeight: '700' },
  list: { padding: 12, gap: 10 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  jobCard: { flex: 1, minWidth: 0, backgroundColor: colors.white, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 10, padding: 16 },
  jobCardLandscape: { marginHorizontal: 5 },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jobMode: { flex: 1, color: colors.black, fontSize: 18, fontWeight: '800' },
  jobStatus: { color: '#176B3A', backgroundColor: '#E7F7ED', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden', fontSize: 11, fontWeight: '800' },
  cancelledStatus: { color: colors.grey, backgroundColor: '#E4E7E9' },
  pendingStatus: { color: '#7A4C00', backgroundColor: '#FFF0CC' },
  failedStatus: { color: colors.maroon, backgroundColor: '#FFE0E2' },
  jobTime: { color: colors.black, fontSize: 14, fontWeight: '700', marginTop: 12 },
  jobMeta: { color: colors.grey, fontSize: 12, marginTop: 6 },
  jobId: { color: '#8A9299', fontSize: 10, marginTop: 10 },
  empty: { alignItems: 'center', padding: 30 },
  emptyTitle: { color: colors.black, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: colors.grey, fontSize: 13, textAlign: 'center', marginTop: 7 },
});
const readableStyles = StyleSheet.create({ action: { alignItems: 'center' }, number: { width: 38, height: 38, borderRadius: 19, fontSize: 17, marginBottom: 12 }, disabledNumber: { backgroundColor: '#727A80', color: '#FFFFFF' }, actionTitle: { fontSize: 18, textAlign: 'center' }, actionSub: { fontSize: 13, textAlign: 'center', marginTop: 6 }, disabledText: { color: '#596167' }, cancelJob: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.red, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8 }, cancelJobText: { color: colors.white, fontWeight: '800', fontSize: 12 } });
const layoutStyles = StyleSheet.create({ headerTitlePortrait: { fontSize: 12 }, contentPortrait: { padding: 8 }, columnsPortrait: { flexDirection: 'column' }, disabled: { opacity: 0.48 } });
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
  number: { width: 28, height: 28, borderRadius: 14, fontSize: 14, marginBottom: 4 },
  actionTitle: { fontSize: 13, lineHeight: 15 },
  actionSub: { fontSize: 10, lineHeight: 12, marginTop: 2 },
  cancelJob: { minHeight: 42, paddingHorizontal: 8 },
  cancelJobText: { fontSize: 10 },
  setupScroll: { padding: 16 },
  setupCard: { padding: 20 },
  setupTitle: { fontSize: 24 },
});
