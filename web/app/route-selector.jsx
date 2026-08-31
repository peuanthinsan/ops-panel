'use client';

import { useEffect, useRef, useState } from 'react';
import { adminFetch } from './dashboard-api';

const copy = {
  en: {
    assigned: 'Assigned route', noRoute: 'No route', change: 'Search or change route', search: 'Search routes by name',
    loading: 'Searching routes…', failed: 'Could not search routes.', empty: 'No matching routes.', more: 'More routes match. Keep typing to narrow the results.',
  },
  th: {
    assigned: 'เส้นทางที่กำหนด', noRoute: 'ไม่มีเส้นทาง', change: 'ค้นหาหรือเปลี่ยนเส้นทาง', search: 'ค้นหาเส้นทางตามชื่อ',
    loading: 'กำลังค้นหาเส้นทาง…', failed: 'ไม่สามารถค้นหาเส้นทางได้', empty: 'ไม่พบเส้นทางที่ตรงกัน', more: 'ยังมีเส้นทางที่ตรงกันอีก กรุณาพิมพ์เพิ่มเพื่อจำกัดผลลัพธ์',
  },
};

export default function RouteSelector({ value = '', busy = false, error = '', lang = 'en', onSelect }) {
  const t = copy[lang] || copy.en;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchError('');
      const params = new URLSearchParams({ q: query.trim(), limit: '50' });
      adminFetch(`/api/admin/job-route-options?${params}`, { signal: controller.signal, cacheOffline: false })
        .then(data => {
          setRoutes(Array.isArray(data.routes) ? data.routes : []);
          setHasMore(data.hasMore === true);
        })
        .catch(value => { if (value?.name !== 'AbortError') setSearchError(t.failed); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, t.failed]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function choose(routeName) {
    setOpen(false);
    setQuery('');
    void onSelect(routeName);
  }

  return <div className="route-selector" ref={rootRef}>
    <label id="gps-route-assignment-label">{t.assigned}</label>
    <button
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-labelledby="gps-route-assignment-label gps-route-assignment-value"
      className="route-selector-trigger"
      disabled={busy}
      id="gps-route-assignment"
      onClick={() => setOpen(current => !current)}
      type="button"
    >
      <span id="gps-route-assignment-value">{value || t.noRoute}</span><small>{t.change}</small><b aria-hidden="true">⌄</b>
    </button>
    {open ? <div className="route-selector-popover" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
      <input
        aria-autocomplete="list"
        aria-controls="gps-route-options"
        aria-expanded="true"
        aria-label={t.search}
        autoComplete="off"
        maxLength={120}
        onChange={event => setQuery(event.target.value)}
        placeholder={t.search}
        ref={inputRef}
        role="combobox"
        type="search"
        value={query}
      />
      <div className="route-selector-options" id="gps-route-options" role="listbox">
        <button aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => choose('')} role="option" type="button"><span>{t.noRoute}</span>{!value ? <b aria-hidden="true">✓</b> : null}</button>
        {routes.map(route => <button aria-selected={value === route.routeName} className={value === route.routeName ? 'selected' : ''} key={route.id} onClick={() => choose(route.routeName)} role="option" type="button"><span>{route.routeName}</span>{value === route.routeName ? <b aria-hidden="true">✓</b> : null}</button>)}
      </div>
      {loading ? <small className="route-selector-status" role="status">{t.loading}</small> : null}
      {!loading && searchError ? <small className="route-selector-status error" role="alert">{searchError}</small> : null}
      {!loading && !searchError && !routes.length ? <small className="route-selector-status">{t.empty}</small> : null}
      {!loading && !searchError && hasMore ? <small className="route-selector-status">{t.more}</small> : null}
    </div> : null}
    {busy ? <small role="status">{lang === 'th' ? 'กำลังบันทึกเส้นทาง…' : 'Saving route…'}</small> : null}
    {error ? <small className="error" role="alert">{error}</small> : null}
  </div>;
}
