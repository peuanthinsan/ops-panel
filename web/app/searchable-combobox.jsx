'use client';

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';

export const MAX_VISIBLE_COMBOBOX_OPTIONS = 100;

function normalizeOption(option, getOptionLabel) {
  if (typeof option === 'object' && option !== null) {
    return { value: String(option.value ?? ''), label: String(option.label ?? option.value ?? '') };
  }
  return { value: String(option), label: String(getOptionLabel(option)) };
}

function defaultOptionLabel(option) { return option; }

export default function SearchableCombobox({
  label,
  value,
  onChange,
  options,
  allLabel,
  lang,
  getOptionLabel = defaultOptionLabel,
  maxResults = MAX_VISIBLE_COMBOBOX_OPTIONS,
}) {
  const reactId = useId();
  const id = `combobox-${reactId.replaceAll(':', '')}`;
  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const normalizedOptions = useMemo(
    () => options.map(option => normalizeOption(option, getOptionLabel)).filter(option => option.value),
    [options, getOptionLabel],
  );
  const selectedOption = useMemo(
    () => normalizedOptions.find(option => option.value === value),
    [normalizedOptions, value],
  );
  const selectedLabel = selectedOption?.label || allLabel;

  const matches = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase(lang === 'th' ? 'th' : 'en');
    if (!needle) return normalizedOptions;
    return normalizedOptions.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase(lang === 'th' ? 'th' : 'en').includes(needle));
  }, [deferredQuery, lang, normalizedOptions]);
  const visibleOptions = useMemo(() => {
    const firstMatches = matches.slice(0, maxResults);
    if (!selectedOption || firstMatches.some(option => option.value === selectedOption.value)) return firstMatches;
    return [selectedOption, ...firstMatches.slice(0, Math.max(0, maxResults - 1))];
  }, [matches, maxResults, selectedOption]);
  const menuOptions = useMemo(() => [{ value: '', label: allLabel }, ...visibleOptions], [allLabel, visibleOptions]);

  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [open, selectedLabel]);

  useEffect(() => {
    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, []);

  useEffect(() => {
    setActiveIndex(current => Math.min(current, Math.max(0, menuOptions.length - 1)));
  }, [menuOptions.length]);

  function revealActiveOption(index) {
    requestAnimationFrame(() => document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' }));
  }

  function choose(option) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    inputRef.current?.focus({ preventScroll: true });
  }

  function moveActive(amount) {
    if (!open) setQuery('');
    setOpen(true);
    setActiveIndex(current => {
      const next = Math.max(0, Math.min(menuOptions.length - 1, current + amount));
      revealActiveOption(next);
      return next;
    });
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
    else if (event.key === 'Enter' && open) { event.preventDefault(); choose(menuOptions[activeIndex]); }
    else if (event.key === 'Escape') { event.preventDefault(); setQuery(selectedLabel); setOpen(false); }
    else if (event.key === 'Tab') setOpen(false);
  }

  const resultMessage = matches.length > maxResults
    ? (lang === 'th' ? `แสดง ${maxResults} รายการแรกจาก ${matches.length} รายการ พิมพ์เพิ่มเพื่อค้นหาให้แคบลง` : `Showing the first ${maxResults} of ${matches.length} matches. Keep typing to narrow the list.`)
    : (lang === 'th' ? `${matches.length} รายการ` : `${matches.length} matches`);

  return (
    <div className="filter-field" ref={rootRef}>
      <span id={labelId}>{label}</span>
      <div className="searchable-combobox">
        <input
          ref={inputRef}
          className="combobox-input"
          role="combobox"
          type="search"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-labelledby={labelId}
          aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
          placeholder={lang === 'th' ? `ค้นหา${label}` : `Search ${label.toLowerCase()}`}
          value={query}
          onFocus={event => { setOpen(true); setQuery(''); setActiveIndex(0); event.currentTarget.select(); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(''); setActiveIndex(0); } }}
          onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
        />
        <svg className="combobox-chevron" aria-hidden="true" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg>
        {open ? <div className="combobox-popover">
          <div className="combobox-results" id={listboxId} role="listbox" aria-labelledby={labelId}>
            {menuOptions.map((option, index) => <div
              id={`${id}-option-${index}`}
              className={`combobox-option ${index === activeIndex ? 'active' : ''}`}
              key={`${option.value}-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(option)}
            ><span>{option.label}</span>{option.value === value ? <strong aria-hidden="true">✓</strong> : null}</div>)}
            {!matches.length ? <p className="combobox-empty" role="status">{lang === 'th' ? 'ไม่พบรายการที่ตรงกัน' : 'No matching options'}</p> : null}
          </div>
          <p className="combobox-summary" aria-live="polite">{resultMessage}</p>
        </div> : null}
      </div>
    </div>
  );
}
