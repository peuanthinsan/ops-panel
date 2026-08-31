'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import FullReportDashboard from './report-dashboard';
import FleetDashboard from './fleet-dashboard';
import SettingsDashboard from './settings-dashboard';
import RoutesDashboard from './routes-dashboard';
import { adminFetch } from './dashboard-api';
import { clearAdminSessionToken, getAdminSessionToken, setAdminSessionToken } from './dashboard-session';
import { localizedDashboardAdminError } from '../lib/dashboard-errors';
import { clearOfflineResponses } from './offline-store';

const copy = {
  en: {
    reports: 'Reports', reportsSub: 'Jobs & timeline', fleet: 'Fleet', fleetSub: 'จัดการรถและแท็บเล็ต', routes: 'Routes', routesSub: 'Job route links', settings: 'Settings', settingsSub: 'การตั้งค่าผู้ดูแล', title: 'Songdee GPS Ops Panel', adminLabel: 'Ops Panel · Admin', password: 'Admin password', continue: 'Continue', signingIn: 'Signing in…', signOut: 'Sign out', loginTitle: 'Admin access', loginBody: 'Enter the fleet administrator password. No username is required.', invalid: 'Incorrect password', skip: 'Skip to content', loading: 'Loading dashboard…', language: 'Switch language', navigation: 'Primary navigation',
  },
  th: {
    reports: 'รายงาน', reportsSub: 'งานและไทม์ไลน์', fleet: 'จัดการรถ', fleetSub: 'Fleet', routes: 'เส้นทาง', routesSub: 'ลิงก์เส้นทางงาน', settings: 'ตั้งค่า', settingsSub: 'Settings', title: 'Songdee GPS Ops Panel', adminLabel: 'Ops Panel · ผู้ดูแล', password: 'รหัสผ่านผู้ดูแล', continue: 'เข้าสู่ระบบ', signingIn: 'กำลังเข้าสู่ระบบ…', signOut: 'ออกจากระบบ', loginTitle: 'เข้าสู่ระบบผู้ดูแล', loginBody: 'กรอกรหัสผ่านผู้ดูแลฝูงรถ ไม่ต้องใช้ชื่อผู้ใช้', invalid: 'รหัสผ่านไม่ถูกต้อง', skip: 'ข้ามไปยังเนื้อหา', loading: 'กำลังโหลดแดชบอร์ด…', language: 'เปลี่ยนภาษา', navigation: 'เมนูหลัก',
  },
};

const navigation = [
  { href: '/', key: 'reports' },
  { href: '/admin', key: 'fleet' },
  { href: '/routes', key: 'routes' },
  { href: '/settings', key: 'settings' },
];

function Login({ lang, setLang, onLogin }) {
  const t = copy[lang];
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordInputRef = useRef(null);

  useEffect(() => {
    if (!error) return;
    passwordInputRef.current?.focus();
    passwordInputRef.current?.select();
  }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setAdminSessionToken(result.token);
      onLogin();
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : '';
      setError(message === 'Invalid password' ? t.invalid : localizedDashboardAdminError(message || t.invalid, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <button className="login-language" type="button" aria-label={t.language} onClick={() => setLang(lang === 'en' ? 'th' : 'en')}>
          {lang === 'en' ? 'ไทย' : 'EN'}
        </button>
        <div className="login-brand-row">
          <Image src="/songdee-ops-panel-logo.svg" alt={t.title} className="login-logo" width={390} height={116} priority />
        </div>
        <h1>{t.loginTitle}</h1>
        <p>{t.loginBody}</p>
        <label htmlFor="admin-password">
          {t.password}
          <input
            ref={passwordInputRef}
            id="admin-password"
            aria-describedby={error ? 'login-error' : undefined}
            aria-invalid={Boolean(error)}
            autoFocus
            autoComplete="current-password"
            disabled={busy}
            maxLength={128}
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        {error ? <div className="error" id="login-error" role="alert">{error}</div> : null}
        <button className="primary login-submit" type="submit" disabled={busy || !password} aria-busy={busy}>
          {busy ? t.signingIn : t.continue}
        </button>
      </form>
    </main>
  );
}

function Shell({ lang, setLang, onLogout, children }) {
  const t = copy[lang];
  const pathname = usePathname();

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">{t.skip}</a>
      <aside className="sidebar">
        <Link className="side-brand" href="/" aria-label={t.title}>
          <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} className="side-pin" />
          <span><strong>Songdee GPS</strong><small>{t.adminLabel}</small></span>
        </Link>
        <nav aria-label={t.navigation}>
          {navigation.map(item => (
            <Link key={item.key} href={item.href} aria-current={pathname === item.href || (item.key === 'reports' && pathname === '/timeline') ? 'page' : undefined}>
              <strong>{t[item.key]}</strong>
              <small>{t[`${item.key}Sub`]}</small>
            </Link>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="language" type="button" aria-label={t.language} title={t.language} onClick={() => setLang(lang === 'en' ? 'th' : 'en')}>{lang === 'en' ? 'ไทย' : 'EN'}</button>
          <button className="logout" type="button" onClick={onLogout}>{t.signOut}</button>
        </div>
      </aside>
      <div className="content-area"><OfflineStatus lang={lang} />{children}</div>
    </div>
  );
}

function OfflineStatus({ lang }) {
  const [state, setState] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online');
  useEffect(() => {
    const goOffline = () => setState('offline');
    const goOnline = () => setState('online');
    const showCached = () => setState('cached');
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    window.addEventListener('songdee-offline-data', showCached);
    window.addEventListener('songdee-online-data', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('songdee-offline-data', showCached);
      window.removeEventListener('songdee-online-data', goOnline);
    };
  }, []);
  if (state === 'online') return null;
  const thai = lang === 'th';
  return <div className="offline-banner" role="status" aria-live="polite"><strong>{thai ? 'โหมดออฟไลน์' : 'Offline mode'}</strong><span>{state === 'cached' ? (thai ? 'กำลังแสดงข้อมูลแดชบอร์ดล่าสุดที่บันทึกไว้' : 'Showing the latest dashboard data saved on this device.') : (thai ? 'การเชื่อมต่อขาดหาย งานเขียนจะรอจนกว่าจะออนไลน์' : 'The connection is unavailable. Changes will wait until you are online.')}</span></div>;
}

function usePersistentLanguage() {
  const [lang, setLangState] = useState('en');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('songdee-language');
      if (saved === 'en' || saved === 'th') setLangState(saved);
    } catch { /* Language persistence should not block the dashboard. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = next => {
    setLangState(next);
    try { localStorage.setItem('songdee-language', next); } catch { /* Ignore storage restrictions. */ }
    window.location.reload();
  };
  return [lang, setLang];
}

export default function Dashboard() {
  const [lang, setLang] = usePersistentLanguage();
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setLoggedIn(Boolean(getAdminSessionToken()));
    setReady(true);
    const expire = () => setLoggedIn(false);
    window.addEventListener('songdee-auth-expired', expire);
    return () => window.removeEventListener('songdee-auth-expired', expire);
  }, []);

  useEffect(() => {
    if (!ready || !loggedIn) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    let mainContent = null;
    const clearRouteFocus = () => { if (mainContent) delete mainContent.dataset.routeFocus; };
    const frame = window.requestAnimationFrame(() => {
      mainContent = document.getElementById('main-content');
      if (!mainContent) return;
      mainContent.dataset.routeFocus = 'true';
      mainContent.addEventListener('blur', clearRouteFocus, { once: true });
      mainContent.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      mainContent?.removeEventListener('blur', clearRouteFocus);
      clearRouteFocus();
    };
  }, [pathname, ready, loggedIn]);

  const logout = () => {
    clearAdminSessionToken();
    clearOfflineResponses().catch(() => {});
    setLoggedIn(false);
  };

  if (!ready) {
    return <main className="login-page"><div className="login-card loading-card" aria-live="polite"><Image src="/songdee-ops-panel-logo.svg" alt="Songdee Ops Panel" width={390} height={116} className="login-logo" priority /><p>{copy[lang].loading}</p></div></main>;
  }
  if (!loggedIn) return <Login lang={lang} setLang={setLang} onLogin={() => setLoggedIn(true)} />;

  let screen = <FullReportDashboard lang={lang} />;
  if (pathname === '/admin') screen = <FleetDashboard lang={lang} />;
  if (pathname === '/routes') screen = <RoutesDashboard lang={lang} />;
  if (pathname === '/settings') screen = <SettingsDashboard lang={lang} />;

  return <Shell lang={lang} setLang={setLang} onLogout={logout}>{screen}</Shell>;
}
