'use client';

import { useEffect, useRef, useState } from 'react';
import { localizedDashboardAdminError } from '../lib/dashboard-errors';
import { adminFetch } from './dashboard-api';
import { clearAdminSessionToken } from './dashboard-session';

const text = {
  en: {
    eyebrow: 'ADMIN SETTINGS', title: 'Security & device setup', subtitle: 'Manage dashboard access and the one-time tablet binding policy.', passwordTitle: 'Admin password', passwordBody: 'Use 12 to 128 characters. Changing it signs out every administrator.', current: 'Current password', next: 'New password', confirm: 'Confirm new password', change: 'Change password', changing: 'Changing…', mismatch: 'New passwords do not match.', policyTitle: 'Vehicle setup policy', policyBody: 'A new tablet asks for a vehicle number once. After it is connected, that vehicle can only be changed from the Fleet page in this dashboard.', policyStep1: 'Install the Android app on the in-vehicle tablet.', policyStep2: 'Enter the vehicle number on first launch.', policyStep3: 'Use Fleet to reassign or unbind that Android device ID later.', policyNote: 'There is no technician password and no username-based login.',
  },
  th: {
    eyebrow: 'การตั้งค่าผู้ดูแล', title: 'ความปลอดภัยและการตั้งค่าอุปกรณ์', subtitle: 'จัดการการเข้าถึงแดชบอร์ดและนโยบายเชื่อมต่อแท็บเล็ตครั้งแรก', passwordTitle: 'รหัสผ่านผู้ดูแล', passwordBody: 'ใช้ 12 ถึง 128 ตัวอักษร การเปลี่ยนรหัสจะออกจากระบบผู้ดูแลทุกคน', current: 'รหัสผ่านปัจจุบัน', next: 'รหัสผ่านใหม่', confirm: 'ยืนยันรหัสผ่านใหม่', change: 'เปลี่ยนรหัสผ่าน', changing: 'กำลังเปลี่ยน…', mismatch: 'รหัสผ่านใหม่ไม่ตรงกัน', policyTitle: 'นโยบายตั้งค่ารถ', policyBody: 'แท็บเล็ตใหม่จะขอหมายเลขรถเพียงครั้งเดียว หลังเชื่อมต่อแล้ว หมายเลขรถจะเปลี่ยนได้จากหน้า Fleet ในแดชบอร์ดนี้เท่านั้น', policyStep1: 'ติดตั้งแอป Android บนแท็บเล็ตประจำรถ', policyStep2: 'กรอกหมายเลขรถเมื่อเปิดแอปครั้งแรก', policyStep3: 'ใช้หน้า Fleet เพื่อย้ายหรือยกเลิกการเชื่อมต่อรหัสอุปกรณ์ Android ภายหลัง', policyNote: 'ไม่มีรหัสผ่านช่างและไม่ต้องใช้ชื่อผู้ใช้ในการเข้าสู่ระบบ',
  },
};

export default function SettingsDashboard({ lang }) {
  const t = text[lang];
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [errorField, setErrorField] = useState('');
  const [busy, setBusy] = useState(false);
  const currentRef = useRef(null);
  const newRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => { setMessage(''); setErrorField(''); }, [lang]);
  useEffect(() => {
    if (!message) return;
    const target = errorField === 'current' ? currentRef.current : errorField === 'new' ? newRef.current : confirmRef.current;
    target?.focus();
    target?.select();
  }, [errorField, message]);

  async function changePassword(event) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmPassword) {
      setErrorField('confirm');
      setMessage(t.mismatch);
      return;
    }
    setBusy(true);
    setMessage('');
    setErrorField('');
    try {
      await adminFetch('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      clearAdminSessionToken();
      window.dispatchEvent(new Event('songdee-auth-expired'));
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : '';
      setErrorField(rawMessage.includes('Current admin password') ? 'current' : 'new');
      setMessage(localizedDashboardAdminError(rawMessage, lang));
    } finally { setBusy(false); }
  }

  return (
    <main className="main settings-workspace" id="main-content" tabIndex={-1}>
      <div className="page-header"><div><div className="eyebrow">{t.eyebrow}</div><h1>{t.title}</h1><p>{t.subtitle}</p></div></div>
      <div className="settings-grid">
        <section className="panel settings-card password-panel">
          <h2>{t.passwordTitle}</h2>
          <p id="password-hint">{t.passwordBody}</p>
          <form onSubmit={changePassword}>
            <label>{t.current}<input ref={currentRef} type="password" aria-describedby={message ? 'password-error' : undefined} aria-invalid={errorField === 'current'} autoComplete="current-password" disabled={busy} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
            <label>{t.next}<input ref={newRef} type="password" aria-describedby={message ? 'password-hint password-error' : 'password-hint'} aria-invalid={errorField === 'new'} autoComplete="new-password" minLength={12} maxLength={128} disabled={busy} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label>
            <label>{t.confirm}<input ref={confirmRef} type="password" aria-describedby={message ? 'password-hint password-error' : 'password-hint'} aria-invalid={errorField === 'confirm'} autoComplete="new-password" minLength={12} maxLength={128} disabled={busy} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label>
            <button className="primary" type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>{busy ? t.changing : t.change}</button>
          </form>
          {message ? <p className="error" id="password-error" role="alert">{message}</p> : null}
        </section>
        <section className="panel settings-card policy-card">
          <h2>{t.policyTitle}</h2>
          <p>{t.policyBody}</p>
          <ol><li>{t.policyStep1}</li><li>{t.policyStep2}</li><li>{t.policyStep3}</li></ol>
          <div className="policy-note">{t.policyNote}</div>
        </section>
      </div>
    </main>
  );
}
