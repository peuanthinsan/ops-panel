'use client';

import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from './dashboard-api';

const copy = {
  en: {
    route: 'Route', noRoute: 'No route', choose: 'Search saved routes', search: 'Search routes by name',
    loading: 'Searching routes…', loadingMore: 'Loading more routes…', failed: 'Could not search routes.', empty: 'No matching routes.',
    showing: 'Showing {count} routes', more: 'More routes match. Search to narrow the list or browse the next page.', loadMore: 'Show 50 more',
  },
  th: {
    route: 'เส้นทาง', noRoute: 'ไม่มีเส้นทาง', choose: 'ค้นหาเส้นทางที่บันทึกไว้', search: 'ค้นหาเส้นทางตามชื่อ',
    loading: 'กำลังค้นหาเส้นทาง…', loadingMore: 'กำลังโหลดเส้นทางเพิ่ม…', failed: 'ไม่สามารถค้นหาเส้นทางได้', empty: 'ไม่พบเส้นทางที่ตรงกัน',
    showing: 'กำลังแสดง {count} เส้นทาง', more: 'ยังมีเส้นทางที่ตรงกันอีก ค้นหาเพื่อจำกัดรายการหรือดูหน้าถัดไป', loadMore: 'แสดงเพิ่มอีก 50 เส้นทาง',
  },
};

const routePageSize = 50;

export default function RouteSelector({ value = '', busy = false, lang = 'en', onSelect }) {
  const t = copy[lang] || copy.en;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState('');
  const queryRef = useRef('');

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const controller = new AbortController();
    const normalizedQuery = query.trim();
    queryRef.current = normalizedQuery;
    setRoutes([]);
    setHasMore(false);
    setLoadingMore(false);
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchError('');
      const params = new URLSearchParams({ q: normalizedQuery, limit: String(routePageSize), offset: '0' });
      adminFetch(`/api/admin/job-route-options?${params}`, { signal: controller.signal, cacheOffline: false })
        .then(data => {
          if (queryRef.current !== normalizedQuery) return;
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
    onSelect?.(routeName);
  }

  async function loadMoreRoutes() {
    if (loading || loadingMore || !hasMore) return;
    const normalizedQuery = query.trim();
    const offset = routes.length;
    setLoadingMore(true);
    setSearchError('');
    try {
      const params = new URLSearchParams({ q: normalizedQuery, limit: String(routePageSize), offset: String(offset) });
      const data = await adminFetch(`/api/admin/job-route-options?${params}`, { cacheOffline: false });
      if (queryRef.current !== normalizedQuery) return;
      const nextRoutes = Array.isArray(data.routes) ? data.routes : [];
      setRoutes(current => {
        const existingIds = new Set(current.map(route => route.id));
        return [...current, ...nextRoutes.filter(route => !existingIds.has(route.id))];
      });
      setHasMore(data.hasMore === true);
    } catch {
      if (queryRef.current === normalizedQuery) setSearchError(t.failed);
    } finally {
      if (queryRef.current === normalizedQuery) setLoadingMore(false);
    }
  }

  return <div className="route-selector" ref={rootRef}>
    <label id="gps-route-selector-label">{t.route}</label>
    <button
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-labelledby="gps-route-selector-label gps-route-selector-value"
      className="route-selector-trigger"
      disabled={busy}
      id="gps-route-assignment"
      onClick={() => setOpen(current => !current)}
      type="button"
    >
      <span><strong id="gps-route-selector-value">{value || t.noRoute}</strong><small>{t.choose}</small></span>
      <CaretDownIcon className="route-selector-caret" size={16} weight="bold" aria-hidden="true" />
    </button>
    {open ? <div className="route-selector-popover" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
      <div className="route-selector-search">
        <MagnifyingGlassIcon size={17} weight="bold" aria-hidden="true" />
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
      </div>
      <div aria-busy={loading || loadingMore} className="route-selector-options" id="gps-route-options" role="listbox">
        <button aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => choose('')} role="option" type="button"><span>{t.noRoute}</span>{!value ? <CheckIcon size={16} weight="bold" aria-hidden="true" /> : null}</button>
        {routes.map(route => <button aria-selected={value === route.routeName} className={value === route.routeName ? 'selected' : ''} key={route.id} onClick={() => choose(route.routeName)} role="option" type="button"><span className="route-selector-option-copy"><strong>{route.routeName}</strong>{route.companyName ? <small>{route.companyName}</small> : null}</span>{value === route.routeName ? <CheckIcon size={16} weight="bold" aria-hidden="true" /> : null}</button>)}
      </div>
      {loading ? <small className="route-selector-status" role="status">{t.loading}</small> : null}
      {!loading && searchError ? <small className="route-selector-status error" role="alert">{searchError}</small> : null}
      {!loading && !searchError && !routes.length ? <small className="route-selector-status">{t.empty}</small> : null}
      {!loading && !searchError && routes.length ? <div className="route-selector-results" aria-live="polite">
        <span><strong>{t.showing.replace('{count}', String(routes.length))}</strong>{hasMore ? <small>{t.more}</small> : null}</span>
        {hasMore ? <button disabled={loadingMore} onClick={loadMoreRoutes} type="button">{loadingMore ? t.loadingMore : t.loadMore}</button> : null}
      </div> : null}
    </div> : null}
  </div>;
}
