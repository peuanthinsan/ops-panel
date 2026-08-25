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
  multiple = false,
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
  const selectedValues = useMemo(() => new Set((multiple
    ? (Array.isArray(value) ? value : value ? [value] : [])
    : value ? [value] : []).map(item => String(item))), [multiple, value]);
  const selectedOptions = useMemo(() => [...selectedValues].map(selectedValue => (
    normalizedOptions.find(option => option.value === selectedValue)
      || { value: selectedValue, label: String(getOptionLabel(selectedValue)) }
  )), [getOptionLabel, normalizedOptions, selectedValues]);
  const selectedLabel = multiple
    ? selectedValues.size
      ? (lang === 'th' ? `เลือกแล้ว ${selectedValues.size} รายการ` : `${selectedValues.size} selected`)
      : allLabel
    : selectedOptions[0]?.label || allLabel;

  const matches = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase(lang === 'th' ? 'th' : 'en');
    if (!needle) return normalizedOptions;
    return normalizedOptions.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase(lang === 'th' ? 'th' : 'en').includes(needle));
  }, [deferredQuery, lang, normalizedOptions]);
  const visibleOptions = useMemo(() => {
    const firstMatches = matches.slice(0, maxResults);
    const pinnedSelections = selectedOptions.filter(option => !firstMatches.some(match => match.value === option.value));
    return [...pinnedSelections, ...firstMatches].slice(0, maxResults);
  }, [matches, maxResults, selectedOptions]);
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
    if (multiple) {
      if (!option.value) onChange([]);
      else {
        const next = new Set(selectedValues);
        if (next.has(option.value)) next.delete(option.value); else next.add(option.value);
        onChange([...next]);
      }
      setQuery('');
      setOpen(true);
    } else {
      onChange(option.value);
      setQuery(option.label);
      setOpen(false);
    }
    inputRef.current?.focus({ preventScroll: true });
  }

  function removeSelection(selectedValue) {
    onChange([...selectedValues].filter(valueItem => valueItem !== selectedValue));
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
    else if (event.key === 'Home' && open) { event.preventDefault(); setActiveIndex(0); revealActiveOption(0); }
    else if (event.key === 'End' && open) { const last = menuOptions.length - 1; event.preventDefault(); setActiveIndex(last); revealActiveOption(last); }
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
          <div className="combobox-results" id={listboxId} role="listbox" aria-labelledby={labelId} aria-multiselectable={multiple || undefined}>
            {menuOptions.map((option, index) => <div
              id={`${id}-option-${index}`}
              className={`combobox-option ${index === activeIndex ? 'active' : ''}`}
              key={`${option.value}-${index}`}
              role="option"
              aria-selected={option.value ? selectedValues.has(option.value) : selectedValues.size === 0}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(option)}
            ><span>{option.label}</span>{(option.value ? selectedValues.has(option.value) : selectedValues.size === 0) ? <strong aria-hidden="true">✓</strong> : null}</div>)}
            {!matches.length ? <p className="combobox-empty" role="status">{lang === 'th' ? 'ไม่พบรายการที่ตรงกัน' : 'No matching options'}</p> : null}
          </div>
          <p className="combobox-summary" aria-live="polite">{resultMessage}</p>
        </div> : null}
      </div>
      {multiple && selectedOptions.length ? <div className="multi-combobox-chips" aria-label={lang === 'th' ? `${label} ที่เลือก` : `Selected ${label.toLowerCase()}`}>
        {selectedOptions.slice(0, 3).map(option => <button key={option.value} type="button" title={lang === 'th' ? `นำ ${option.label} ออก` : `Remove ${option.label}`} onClick={() => removeSelection(option.value)}><span>{option.label}</span><b aria-hidden="true">×</b></button>)}
        {selectedOptions.length > 3 ? <span>+{selectedOptions.length - 3}</span> : null}
      </div> : null}
    </div>
  );
}
