'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { formatReportDateTime } from '../lib/report-view';
import { localizedDashboardAdminError } from '../lib/dashboard-errors';
import { fleetSnapshotAfterRequest, normalizeFleetBindings } from '../lib/fleet-admin-state';
import { paginateReports } from '../lib/report-pagination';
import { adminFetch } from './dashboard-api';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';

const pageSize = 10;
const text = {
  en: {
    eyebrow: 'MANAGE FLEET', title: 'Vehicles & tablets', subtitle: 'Connect one or more Android device identifiers to each vehicle.', bindings: 'Vehicle bindings', import: 'Import CSV', export: 'Export CSV', importHint: 'CSV columns: vehicleNumber, deviceId. A vehicle may appear on multiple rows; each device ID can belong to only one vehicle.', vehicle: 'Vehicle', device: 'Tablet (Android ID)', activity: 'Last activity', status: 'Status', actions: 'Actions', bound: 'Bound', signedAccess: 'Signed access active', enrollmentPending: 'Security enrollment pending', legacyAccess: 'Awaiting app upgrade', resetAccess: 'Reset access', resettingAccess: 'Resetting…', resetTitle: 'Reset this tablet’s access?', resetBody: 'The tablet must reopen the app to obtain a new signed credential. Saved jobs on the tablet are not deleted.', resetDone: 'Tablet access reset. Reopen the tablet app to reconnect securely.', add: 'Add device', adding: 'Adding…', search: 'Search vehicle or device ID', edit: 'Edit', save: 'Save', cancel: 'Cancel', unbind: 'Unbind', refresh: 'Refresh', refreshing: 'Refreshing…', loading: 'Loading vehicle bindings…', empty: 'No vehicles connected yet', emptyBody: 'Add a vehicle and Android device ID above, or import a fleet CSV to get started.', noMatch: 'No vehicle or device matches this search.', updated: 'Fleet binding updated.', added: 'Device binding added.', confirmTitle: 'Unbind this tablet?', confirmBody: 'The tablet will ask for a vehicle number the next time the app opens.', keep: 'Keep binding', imported: ({ added, updated, skipped }) => `Import complete: ${added} added, ${updated} updated, ${skipped} skipped.`, importPartial: (done, total) => `Imported ${done} of ${total} bindings. Check the rows that failed and try again.`, invalidFile: 'Choose a CSV file with the exact columns vehicleNumber and deviceId.', showing: 'Showing', of: 'of', previous: 'Previous', next: 'Next', page: 'Page',
  },
  th: {
    eyebrow: 'จัดการรถ', title: 'รถและแท็บเล็ต', subtitle: 'เชื่อมรหัสอุปกรณ์ Android ได้หลายเครื่องกับรถแต่ละคัน', bindings: 'การเชื่อมต่อรถ', import: 'นำเข้า CSV', export: 'ส่งออก CSV', importHint: 'คอลัมน์ CSV: vehicleNumber, deviceId รถหนึ่งคันมีได้หลายแถว แต่รหัสอุปกรณ์แต่ละรหัสเชื่อมได้กับรถเพียงคันเดียว', vehicle: 'รถ', device: 'แท็บเล็ต (รหัส Android)', activity: 'กิจกรรมล่าสุด', status: 'สถานะ', actions: 'การดำเนินการ', bound: 'เชื่อมแล้ว', signedAccess: 'เปิดใช้การยืนยันคำขอแล้ว', enrollmentPending: 'รอลงทะเบียนความปลอดภัย', legacyAccess: 'รออัปเกรดแอป', resetAccess: 'รีเซ็ตสิทธิ์', resettingAccess: 'กำลังรีเซ็ต…', resetTitle: 'รีเซ็ตสิทธิ์แท็บเล็ตเครื่องนี้?', resetBody: 'ต้องเปิดแอปบนแท็บเล็ตอีกครั้งเพื่อรับข้อมูลยืนยันตัวตนใหม่ งานที่บันทึกไว้ในแท็บเล็ตจะไม่ถูกลบ', resetDone: 'รีเซ็ตสิทธิ์แท็บเล็ตแล้ว กรุณาเปิดแอปบนแท็บเล็ตอีกครั้ง', add: 'เพิ่มอุปกรณ์', adding: 'กำลังเพิ่ม…', search: 'ค้นหาหมายเลขรถหรือรหัสอุปกรณ์', edit: 'แก้ไข', save: 'บันทึก', cancel: 'ยกเลิก', unbind: 'ยกเลิกการเชื่อมต่อ', refresh: 'รีเฟรช', refreshing: 'กำลังรีเฟรช…', loading: 'กำลังโหลดการเชื่อมต่อรถ…', empty: 'ยังไม่มีรถที่เชื่อมต่อ', emptyBody: 'เพิ่มหมายเลขรถและรหัสอุปกรณ์ Android ด้านบน หรือนำเข้าไฟล์ CSV ของฝูงรถ', noMatch: 'ไม่พบหมายเลขรถหรืออุปกรณ์ที่ค้นหา', updated: 'อัปเดตการเชื่อมต่อแล้ว', added: 'เพิ่มการเชื่อมต่ออุปกรณ์แล้ว', confirmTitle: 'ยกเลิกการเชื่อมต่อแท็บเล็ต?', confirmBody: 'แท็บเล็ตจะขอหมายเลขรถเมื่อเปิดแอปครั้งถัดไป', keep: 'คงการเชื่อมต่อ', imported: ({ added, updated, skipped }) => `นำเข้าสำเร็จ: เพิ่ม ${added} อัปเดต ${updated} ข้าม ${skipped} รายการ`, importPartial: (done, total) => `นำเข้าสำเร็จ ${done} จาก ${total} รายการ กรุณาตรวจสอบรายการที่ไม่สำเร็จ`, invalidFile: 'กรุณาเลือกไฟล์ CSV ที่มีคอลัมน์ vehicleNumber และ deviceId เท่านั้น', showing: 'แสดง', of: 'จาก', previous: 'ก่อนหน้า', next: 'ถัดไป', page: 'หน้า',
  },
};

const accessRepairCopy = {
  en: {
    resetAccess: 'Repair tablet connection',
    resettingAccess: 'Repairing…',
    resetTitle: 'Repair this tablet’s connection?',
    resetBody: 'Use this only when the tablet shows “Tablet connection needs repair.” Reopening the app creates a new secure connection. The vehicle binding, device ID, and saved jobs stay unchanged.',
    resetDone: 'Tablet connection repaired. Reopen the tablet app and tap Try again.',
  },
  th: {
    resetAccess: 'ซ่อมการเชื่อมต่อแท็บเล็ต',
    resettingAccess: 'กำลังซ่อม…',
    resetTitle: 'ซ่อมการเชื่อมต่อของแท็บเล็ตเครื่องนี้?',
    resetBody: 'ใช้เฉพาะเมื่อแท็บเล็ตแสดงข้อความ “ต้องซ่อมการเชื่อมต่อแท็บเล็ต” เมื่อเปิดแอปอีกครั้ง แท็บเล็ตจะสร้างการเชื่อมต่อที่ปลอดภัยใหม่ โดยหมายเลขรถ รหัสอุปกรณ์ และงานที่บันทึกไว้จะไม่เปลี่ยน',
    resetDone: 'ซ่อมการเชื่อมต่อแท็บเล็ตแล้ว กรุณาเปิดแอปและกด “ลองอีกครั้ง”',
  },
};

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if ((character === ',' || character === '\t' || character === ';') && !quoted) { values.push(value.trim()); value = ''; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}

function parseBindingsCsv(contents) {
  const rows = String(contents).replace(/^\uFEFF/, '').split(/\r?\n/).map(parseCsvLine).filter(row => row.some(Boolean));
  if (!rows.length) return [];
  const normalizedHeader = rows[0].map(value => value.toLowerCase().replace(/[\s_-]/g, ''));
  const vehicleIndex = normalizedHeader.findIndex(value => ['vehiclenumber', 'vehicle', 'trucknumber', 'truck', 'เบอร์รถ', 'หมายเลขรถ'].includes(value));
  const deviceIndex = normalizedHeader.findIndex(value => ['deviceid', 'androidid', 'tabletandroidid', 'tablet', 'รหัสแท็บเล็ต', 'รหัสอุปกรณ์'].includes(value));
  const hasHeader = vehicleIndex >= 0 && deviceIndex >= 0;
  if (!hasHeader) return [];
  const dataRows = rows.slice(1);
  const resolvedVehicleIndex = vehicleIndex;
  const resolvedDeviceIndex = deviceIndex;
  return dataRows.map(row => ({
    vehicleNumber: row[resolvedVehicleIndex]?.trim(),
    deviceId: row[resolvedDeviceIndex]?.trim(),
  })).filter(binding => binding.vehicleNumber && binding.deviceId);
}

function BindingRow({ binding, lastActivity, lang, t, onSave, onAskUnbind, onAskReset }) {
  const [editing, setEditing] = useState(false);
  const [vehicle, setVehicle] = useState(binding.vehicleNumber);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setVehicle(binding.vehicleNumber);
  }, [binding.vehicleNumber, editing]);

  async function save() {
    if (!vehicle.trim() || vehicle.trim() === binding.vehicleNumber || busy) { setEditing(false); return; }
    setBusy(true);
    try {
      if (await onSave({ ...binding, vehicleNumber: vehicle.trim() })) setEditing(false);
    } finally { setBusy(false); }
  }

  return (
    <tr aria-busy={busy}>
      <td>
        {editing ? <input className="table-input" aria-label={t.vehicle} autoCapitalize="characters" maxLength={80} value={vehicle} onChange={event => setVehicle(event.target.value)} disabled={busy} /> : <strong>{binding.vehicleNumber}</strong>}
      </td>
      <td className="device-id">{binding.deviceId}</td>
      <td>{lastActivity || binding.deviceAccessLastUsedAt ? formatReportDateTime(lastActivity || binding.deviceAccessLastUsedAt, lang) : '—'}</td>
      <td><span className="status status-bound">{t.bound}</span><small className="secondary-line">{binding.deviceAccessEnforced ? t.signedAccess : binding.deviceKeyId ? t.enrollmentPending : t.legacyAccess}</small></td>
      <td>
        <div className="row-actions">
          {editing ? <>
            <button className="small-button primary" type="button" aria-label={`${t.save}: ${binding.deviceId}`} onClick={save} disabled={busy || !vehicle.trim()}>{t.save}</button>
            <button className="small-button secondary" type="button" aria-label={`${t.cancel}: ${binding.deviceId}`} onClick={() => { setVehicle(binding.vehicleNumber); setEditing(false); }} disabled={busy}>{t.cancel}</button>
          </> : <button className="small-button secondary" type="button" aria-label={`${t.edit}: ${binding.deviceId}`} onClick={() => setEditing(true)}>{t.edit}</button>}
          <button className="small-button danger-button" type="button" aria-label={`${t.unbind}: ${binding.deviceId}`} onClick={event => onAskUnbind(binding, event.currentTarget)} disabled={busy}>{t.unbind}</button>
          <button className="small-button secondary" type="button" aria-label={`${t.resetAccess}: ${binding.deviceId}`} onClick={event => onAskReset(binding, event.currentTarget)} disabled={busy}>{t.resetAccess}</button>
        </div>
      </td>
    </tr>
  );
}

function BindingCard({ binding, lastActivity, lang, t, onSave, onAskUnbind, onAskReset }) {
  const [editing, setEditing] = useState(false);
  const [vehicle, setVehicle] = useState(binding.vehicleNumber);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setVehicle(binding.vehicleNumber);
  }, [binding.vehicleNumber, editing]);

  async function save() {
    if (!vehicle.trim() || vehicle.trim() === binding.vehicleNumber || busy) { setEditing(false); return; }
    setBusy(true);
    try {
      if (await onSave({ ...binding, vehicleNumber: vehicle.trim() })) setEditing(false);
    } finally { setBusy(false); }
  }

  return (
    <article className="fleet-card" role="listitem" aria-busy={busy}>
      <div className="fleet-card-heading">
        <div>
          {editing ? <input className="table-input" aria-label={t.vehicle} autoCapitalize="characters" maxLength={80} value={vehicle} onChange={event => setVehicle(event.target.value)} disabled={busy} /> : <h3>{binding.vehicleNumber}</h3>}
          <small className="device-id">{binding.deviceId}</small>
        </div>
        <span className="status status-bound">{t.bound}</span>
      </div>
      <dl>
        <div><dt>{t.activity}</dt><dd>{lastActivity || binding.deviceAccessLastUsedAt ? formatReportDateTime(lastActivity || binding.deviceAccessLastUsedAt, lang) : '—'}</dd></div>
        <div><dt>{t.status}</dt><dd>{binding.deviceAccessEnforced ? t.signedAccess : binding.deviceKeyId ? t.enrollmentPending : t.legacyAccess}</dd></div>
      </dl>
      <div className="row-actions fleet-card-actions">
        {editing ? <>
          <button className="small-button primary" type="button" aria-label={`${t.save}: ${binding.deviceId}`} onClick={save} disabled={busy || !vehicle.trim()}>{t.save}</button>
          <button className="small-button secondary" type="button" aria-label={`${t.cancel}: ${binding.deviceId}`} onClick={() => { setVehicle(binding.vehicleNumber); setEditing(false); }} disabled={busy}>{t.cancel}</button>
        </> : <button className="small-button secondary" type="button" aria-label={`${t.edit}: ${binding.deviceId}`} onClick={() => setEditing(true)}>{t.edit}</button>}
        <button className="small-button danger-button" type="button" aria-label={`${t.unbind}: ${binding.deviceId}`} onClick={event => onAskUnbind(binding, event.currentTarget)} disabled={busy}>{t.unbind}</button>
        <button className="small-button secondary" type="button" aria-label={`${t.resetAccess}: ${binding.deviceId}`} onClick={event => onAskReset(binding, event.currentTarget)} disabled={busy}>{t.resetAccess}</button>
      </div>
    </article>
  );
}

export default function FleetDashboard({ lang }) {
  const t = { ...text[lang], ...accessRepairCopy[lang] };
  const [bindings, setBindings] = useState([]);
  const [lastActivity, setLastActivity] = useState({});
  const [vehicle, setVehicle] = useState('');
  const [device, setDevice] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState('success');
  const [confirmBinding, setConfirmBinding] = useState(null);
  const [confirmKind, setConfirmKind] = useState('unbind');
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef(null);
  const fleetSearchRef = useRef(null);
  const keepBindingRef = useRef(null);
  const confirmTriggerRef = useRef(null);
  const requestInFlight = useRef(false);
  const mutationVersion = useRef(0);

  const showMessage = (value, kind = 'success') => { setMessage(value); setMessageKind(kind); };
  const loadBindings = useCallback(async ({ silent = false } = {}) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const requestMutationVersion = mutationVersion.current;
    if (!silent) setRefreshing(true);
    try {
      const result = await adminFetch('/api/admin/device-bindings');
      setBindings(current => fleetSnapshotAfterRequest(current, result.deviceBindings, requestMutationVersion, mutationVersion.current));
      setLastActivity(Object.fromEntries(normalizeFleetBindings(result.deviceBindings)
        .filter(binding => binding.lastActivityAt)
        .map(binding => [binding.deviceId, binding.lastActivityAt])));
    } catch (error) {
      if (!silent) showMessage(localizedDashboardAdminError(error instanceof Error ? error.message : '', lang), 'error');
    } finally {
      requestInFlight.current = false;
      setLoading(false);
      if (!silent) setRefreshing(false);
    }
  }, [lang]);

  useEffect(() => {
    void loadBindings();
    const refreshVisible = () => { if (document.visibilityState === 'visible') void loadBindings({ silent: true }); };
    const timer = window.setInterval(refreshVisible, 30_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [loadBindings]);

  useEffect(() => { setMessage(''); }, [lang]);

  useEffect(() => {
    if (!confirmBinding) return undefined;
    const frame = window.requestAnimationFrame(() => keepBindingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmBinding]);

  const visibleBindings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return bindings.filter(binding => !query || `${binding.vehicleNumber} ${binding.deviceId}`.toLowerCase().includes(query))
      .sort((left, right) => left.vehicleNumber.localeCompare(right.vehicleNumber, undefined, { numeric: true }));
  }, [bindings, search]);
  const bindingPage = useMemo(() => paginateReports(visibleBindings, page, pageSize), [visibleBindings, page]);
  useEffect(() => { setPage(1); }, [search]);

  async function saveBinding(binding, successMessage = t.updated) {
    mutationVersion.current += 1;
    try {
      await adminFetch('/api/admin/device-config', { method: 'POST', body: JSON.stringify(binding) });
      setBindings(items => normalizeFleetBindings(items.some(item => item.deviceId === binding.deviceId)
        ? items.map(item => item.deviceId === binding.deviceId ? binding : item)
        : [...items, binding]));
      showMessage(successMessage);
      return true;
    } catch (error) {
      showMessage(localizedDashboardAdminError(error instanceof Error ? error.message : '', lang), 'error');
      return false;
    }
  }

  async function addBinding(event) {
    event.preventDefault();
    if (!vehicle.trim() || !device.trim() || adding) return;
    setAdding(true);
    const saved = await saveBinding({ vehicleNumber: vehicle.trim(), deviceId: device.trim() }, t.added);
    if (saved) { setVehicle(''); setDevice(''); }
    setAdding(false);
  }

  async function unbind() {
    if (!confirmBinding || removing) return;
    setRemoving(true);
    mutationVersion.current += 1;
    try {
      await adminFetch('/api/admin/device-config', { method: 'DELETE', body: JSON.stringify({ deviceId: confirmBinding.deviceId }) });
      setBindings(items => items.filter(item => item.deviceId !== confirmBinding.deviceId));
      showMessage(t.updated);
      setConfirmBinding(null);
      window.requestAnimationFrame(() => fleetSearchRef.current?.focus());
    } catch (error) {
      showMessage(localizedDashboardAdminError(error instanceof Error ? error.message : '', lang), 'error');
    } finally { setRemoving(false); }
  }

  function askUnbind(binding, trigger) {
    confirmTriggerRef.current = trigger;
    setConfirmKind('unbind');
    setConfirmBinding(binding);
  }

  function askResetAccess(binding, trigger) {
    confirmTriggerRef.current = trigger;
    setConfirmKind('reset');
    setConfirmBinding(binding);
  }

  async function resetAccess() {
    if (!confirmBinding || removing) return;
    setRemoving(true);
    mutationVersion.current += 1;
    try {
      const result = await adminFetch('/api/admin/device-credentials/reset', {
        method: 'POST',
        body: JSON.stringify({ deviceId: confirmBinding.deviceId }),
      });
      setBindings(items => items.map(item => item.deviceId === confirmBinding.deviceId ? {
        ...item,
        deviceKeyId: result.deviceAuth?.keyId || null,
        deviceAccessEnforced: false,
        deviceAccessLastUsedAt: null,
      } : item));
      showMessage(t.resetDone);
      setConfirmBinding(null);
      window.requestAnimationFrame(() => (confirmTriggerRef.current?.isConnected ? confirmTriggerRef.current : fleetSearchRef.current)?.focus());
    } catch (error) {
      showMessage(localizedDashboardAdminError(error instanceof Error ? error.message : '', lang), 'error');
    } finally { setRemoving(false); }
  }

  function closeUnbindDialog() {
    if (removing) return;
    const trigger = confirmTriggerRef.current;
    setConfirmBinding(null);
    window.requestAnimationFrame(() => (trigger?.isConnected ? trigger : fleetSearchRef.current)?.focus());
  }

  function handleDialogKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeUnbindDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function exportCsv() {
    const escape = value => `"${String(value).replaceAll('"', '""')}"`;
    const csv = ['vehicleNumber,deviceId', ...visibleBindings.map(binding => `${escape(binding.vehicleNumber)},${escape(binding.deviceId)}`)].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `songdee-fleet-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || importing) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { showMessage(t.invalidFile, 'error'); return; }
    setImporting(true);
    const importedBindings = parseBindingsCsv(await file.text());
    if (!importedBindings.length) {
      showMessage(t.invalidFile, 'error');
      setImporting(false);
      return;
    }
    try {
      const result = await adminFetch('/api/admin/device-bindings/import', {
        method: 'POST',
        body: JSON.stringify({ bindings: importedBindings }),
      });
      mutationVersion.current += 1;
      showMessage(t.imported(result.importResult || { added: 0, updated: 0, skipped: 0 }));
      await loadBindings({ silent: true });
    } catch (error) {
      showMessage(localizedDashboardAdminError(error instanceof Error ? error.message : '', lang), 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="main fleet-workspace" id="main-content" tabIndex={-1}>
      <div className="page-header">
        <div><div className="eyebrow">{t.eyebrow}</div><h1>{t.title}</h1><p>{t.subtitle}</p></div>
        <button className="secondary refresh-button" type="button" aria-label={refreshing ? t.refreshing : t.refresh} title={refreshing ? t.refreshing : t.refresh} aria-busy={refreshing} onClick={() => void loadBindings()} disabled={refreshing}><ArrowsClockwiseIcon size={17} weight="bold" aria-hidden="true" /></button>
      </div>

      <section className="panel fleet-panel" aria-busy={loading || refreshing || importing}>
        <div className="section-heading fleet-heading">
          <div><h2>{t.bindings}</h2><p>{t.importHint}</p></div>
          <div className="section-actions">
            <input ref={fileInputRef} hidden type="file" accept=".csv,text/csv" onChange={importCsv} />
            <button className="secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>{importing ? t.refreshing : t.import}</button>
            <button className="secondary" type="button" onClick={exportCsv} disabled={!visibleBindings.length}>{t.export}</button>
          </div>
        </div>

        <form className="add-grid" onSubmit={addBinding}>
          <label>{t.vehicle}<input autoCapitalize="characters" autoComplete="off" maxLength={80} value={vehicle} onChange={event => setVehicle(event.target.value)} disabled={adding} required /></label>
          <label>{t.device}<input autoCapitalize="none" autoComplete="off" maxLength={180} value={device} onChange={event => setDevice(event.target.value)} disabled={adding} required /></label>
          <button className="primary" type="submit" disabled={adding || !vehicle.trim() || !device.trim()}>{adding ? t.adding : t.add}</button>
        </form>

        <label className="fleet-search"><span className="sr-only">{t.search}</span><input ref={fleetSearchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t.search} /></label>
        {message ? <div className={`inline-message ${messageKind}`} role={messageKind === 'error' ? 'alert' : 'status'}>{message}</div> : null}

        {visibleBindings.length ? <div className="table-wrap fleet-table-wrap" tabIndex={0} aria-label={t.bindings}>
          <table className="fleet-table">
            <caption className="sr-only">{t.bindings}</caption>
            <thead><tr><th scope="col">{t.vehicle}</th><th scope="col">{t.device}</th><th scope="col">{t.activity}</th><th scope="col">{t.status}</th><th scope="col">{t.actions}</th></tr></thead>
            <tbody>{bindingPage.items.map(binding => <BindingRow key={binding.deviceId} binding={binding} lastActivity={lastActivity[binding.deviceId]} lang={lang} t={t} onSave={saveBinding} onAskUnbind={askUnbind} onAskReset={askResetAccess} />)}</tbody>
          </table>
        </div> : null}
        {visibleBindings.length ? <div className="fleet-cards" role="list" aria-label={t.bindings}>
          {bindingPage.items.map(binding => <BindingCard key={binding.deviceId} binding={binding} lastActivity={lastActivity[binding.deviceId]} lang={lang} t={t} onSave={saveBinding} onAskUnbind={askUnbind} onAskReset={askResetAccess} />)}
        </div> : null}
        {loading ? <p className="empty" role="status">{t.loading}</p> : null}
        {!loading && !visibleBindings.length ? bindings.length ? <div className="empty-state compact-empty-state"><h3>{t.noMatch}</h3></div> : <div className="empty-state compact-empty-state">
          <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} />
          <h3>{t.empty}</h3>
          <p>{t.emptyBody}</p>
        </div> : null}
        {visibleBindings.length ? <div className="table-footer"><span aria-live="polite">{t.showing} {bindingPage.start}–{bindingPage.end} {t.of} {visibleBindings.length}</span><div className="pager"><button className="small-button secondary" type="button" disabled={bindingPage.page <= 1} onClick={() => setPage(value => value - 1)}>{t.previous}</button><span>{t.page} {bindingPage.page} / {bindingPage.totalPages}</span><button className="small-button secondary" type="button" disabled={bindingPage.page >= bindingPage.totalPages} onClick={() => setPage(value => value + 1)}>{t.next}</button></div></div> : null}
      </section>

      {confirmBinding ? <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeUnbindDialog(); }}>
        <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="unbind-title" aria-describedby="unbind-description" onKeyDown={handleDialogKeyDown}>
          <h2 id="unbind-title">{confirmKind === 'reset' ? t.resetTitle : t.confirmTitle}</h2>
          <p id="unbind-description">{confirmBinding.vehicleNumber} · {confirmBinding.deviceId}<br />{confirmKind === 'reset' ? t.resetBody : t.confirmBody}</p>
          <div className="modal-actions"><button ref={keepBindingRef} className="secondary" type="button" onClick={closeUnbindDialog} disabled={removing}>{confirmKind === 'reset' ? t.cancel : t.keep}</button><button className="primary" type="button" onClick={confirmKind === 'reset' ? resetAccess : unbind} disabled={removing} aria-busy={removing}>{removing && confirmKind === 'reset' ? t.resettingAccess : confirmKind === 'reset' ? t.resetAccess : t.unbind}</button></div>
        </section>
      </div> : null}
    </main>
  );
}
