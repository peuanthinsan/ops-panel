'use client';

import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { useEffect, useId, useRef, useState } from 'react';
import { adminFetch } from './dashboard-api';

const copy = {
  en: {
    route: 'Route', noRoute: 'No route', choose: 'Search saved routes', search: 'Search routes by name',
    loading: 'Searching routes…', failed: 'Could not load routes.', empty: 'No matching routes.',
    showing: 'Routes {start}–{end}', more: 'More routes available', previous: 'Previous', next: 'Next', retry: 'Try again',
    selected: 'Selected route', page: 'Route pages', hint: 'Search by name to find a route across all pages.',
  },
  th: {
    route: 'เส้นทาง', noRoute: 'ไม่มีเส้นทาง', choose: 'ค้นหาเส้นทางที่บันทึกไว้', search: 'ค้นหาเส้นทางตามชื่อ',
    loading: 'กำลังค้นหาเส้นทาง…', failed: 'ไม่สามารถโหลดเส้นทางได้', empty: 'ไม่พบเส้นทางที่ตรงกัน',
    showing: 'เส้นทาง {start}–{end}', more: 'ยังมีเส้นทางเพิ่มเติม', previous: 'ก่อนหน้า', next: 'ถัดไป', retry: 'ลองอีกครั้ง',
    selected: 'เส้นทางที่เลือก', page: 'หน้าเส้นทาง', hint: 'ค้นหาตามชื่อเพื่อหาเส้นทางจากทุกหน้า',
  },
};

const routePageSize = 50;

export default function RouteSelector({ value = '', busy = false, lang = 'en', onSelect }) {
  const t = copy[lang] || copy.en;
  const id = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const optionsRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState({ query: '', offset: 0 });
  const [result, setResult] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Identity, rather than query text, also rejects old responses after A → B → A searches.
  const loading = result?.request !== request;
  const routes = !loading && !result?.error ? result.routes : [];
  const hasMore = !loading && result?.hasMore === true;
  const searchError = !loading && result?.error;
  const listId = `${id}-options`;

  useEffect(() => {
    if (!open || busy) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: request.query.trim(), limit: String(routePageSize), offset: String(request.offset) });
      try {
        const data = await adminFetch(`/api/admin/job-route-options?${params}`, { signal: controller.signal, cacheOffline: false });
        if (!controller.signal.aborted) setResult({ request, routes: Array.isArray(data.routes) ? data.routes.slice(0, routePageSize) : [], hasMore: data.hasMore === true });
      } catch {
        if (!controller.signal.aborted) setResult({ request, routes: [], hasMore: false, error: true });
      }
    }, request.query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, busy, request]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const closeOutside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    optionsRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    // A shorter result page can move the drawer's scroll position while typing.
    if (open && document.activeElement === inputRef.current) inputRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, result]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(routeName) {
    if (busy) return;
    close();
    onSelect?.(routeName);
  }

  function search(query, offset = 0) {
    setActiveIndex(-1);
    setRequest({ query, offset });
    if (optionsRef.current) optionsRef.current.scrollTop = 0;
  }

  function navigateOptions(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(current => event.key === 'ArrowDown' ? Math.min(current + 1, routes.length) : current < 0 ? routes.length : Math.max(0, current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      if (activeIndex === 0) choose('');
      else if (routes[activeIndex - 1]) choose(routes[activeIndex - 1].routeName);
    }
  }

  return <div className="route-selector" ref={rootRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label id={`${id}-label`}>{t.route}</label>
    <button
      aria-expanded={open && !busy}
      aria-haspopup="listbox"
      aria-labelledby={`${id}-label ${id}-value`}
      className="route-selector-trigger"
      disabled={busy}
      id="gps-route-assignment"
      ref={triggerRef}
      onClick={() => { if (open) close(); else { search(''); setOpen(true); } }}
      type="button"
    >
      <span><strong id={`${id}-value`}>{value || t.noRoute}</strong><small>{t.choose}</small></span>
      <CaretDownIcon className="route-selector-caret" size={16} weight="bold" aria-hidden="true" />
    </button>
    {open && !busy ? <div className="route-selector-popover" onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!event.nativeEvent.isComposing) { event.preventDefault(); close(); }
    }}>
      <div className="route-selector-search">
        <MagnifyingGlassIcon size={17} weight="bold" aria-hidden="true" />
        <input
          aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={`${id}-hint`}
          aria-expanded="true"
          aria-label={t.search}
          autoComplete="off"
          maxLength={120}
          onChange={event => search(event.target.value)}
          onKeyDown={navigateOptions}
          placeholder={t.search}
          ref={inputRef}
          role="combobox"
          type="search"
          value={request.query}
        />
      </div>
      <small className="route-selector-status" id={`${id}-hint`}>{t.hint}</small>
      {value ? <div className="route-selector-current"><span>{t.selected}</span><strong>{value}</strong></div> : null}
      <div aria-busy={loading} aria-label={t.route} className="route-selector-options" id={listId} ref={optionsRef} role="listbox">
        <button aria-selected={!value} className={`${!value ? 'selected ' : ''}${activeIndex === 0 ? 'active' : ''}`} data-option-index="0" id={`${id}-option-0`} onMouseDown={event => event.preventDefault()} onClick={() => choose('')} role="option" tabIndex={-1} type="button"><span>{t.noRoute}</span>{!value ? <CheckIcon size={16} weight="bold" aria-hidden="true" /> : null}</button>
        {routes.map((route, index) => <button aria-selected={value === route.routeName} className={`${value === route.routeName ? 'selected ' : ''}${activeIndex === index + 1 ? 'active' : ''}`} data-option-index={index + 1} id={`${id}-option-${index + 1}`} key={route.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(route.routeName)} role="option" tabIndex={-1} type="button"><span className="route-selector-option-copy"><strong>{route.routeName}</strong>{route.companyName ? <small>{route.companyName}</small> : null}</span>{value === route.routeName ? <CheckIcon size={16} weight="bold" aria-hidden="true" /> : null}</button>)}
      </div>
      <div className="route-selector-results">
        <span role="status" aria-live="polite">{loading ? t.loading : searchError ? <span className="error">{t.failed}</span> : routes.length ? <><strong>{t.showing.replace('{start}', (request.offset + 1).toLocaleString(lang)).replace('{end}', (request.offset + routes.length).toLocaleString(lang))}</strong>{hasMore ? <small>{t.more}</small> : null}</> : t.empty}</span>
        {searchError ? <button onClick={() => { inputRef.current?.focus(); search(request.query, request.offset); }} type="button">{t.retry}</button> : null}
      </div>
      <nav aria-label={t.page} className="route-selector-pagination">
        <button disabled={loading || request.offset === 0} onClick={() => search(request.query, Math.max(0, request.offset - routePageSize))} type="button">{t.previous}</button>
        <button disabled={loading || !hasMore} onClick={() => search(request.query, request.offset + routePageSize)} type="button">{t.next}</button>
      </nav>
    </div> : null}
  </div>;
}
