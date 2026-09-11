import { formatReportDuration } from './report-view.ts';
import { printReportLocation } from './report-print-view.ts';

export const CLASSIC_REPORT_ROWS_PER_PAGE = 7;

const DAY_MILLISECONDS = 86_400_000;
const HOUR_MILLISECONDS = 3_600_000;
const CLASSIC_TABLE_LINE_BUDGET = 24;
const CLASSIC_ROW_MINIMUM_LINES = 2;
const CLASSIC_DESCRIPTION_CHARACTERS_PER_LINE = 32;

type ClassicReportRow = Parameters<typeof printReportLocation>[0] & {
  startTime?: string | null;
  endTime?: string | null;
  duration?: string | null;
  mode?: string | null;
  status?: string | null;
};

export type ClassicReportPage<T> = {
  rows: T[];
  rowOffset: number;
  windowStart: string;
  windowEnd: string;
};

/** Clip recorded activity intervals to the report's full daily window. */
export function classicActivityPosition(row: ClassicReportRow, window: { windowStart: string; windowEnd: string }) {
  if (row.status === 'Cancelled') return null;
  const start = timestamp(window.windowStart);
  const end = timestamp(window.windowEnd);
  const reportStart = timestamp(row.startTime);
  const reportEnd = timestamp(row.endTime);
  if (start == null || end == null || end <= start || reportStart == null || reportEnd == null || reportEnd <= reportStart) return null;
  if (reportStart >= end || reportEnd <= start) return null;
  const clippedStart = Math.max(start, reportStart);
  const clippedEnd = Math.min(end, reportEnd);
  return { start: clippedStart, end: clippedEnd, left: (clippedStart - start) / (end - start) * 100, width: (clippedEnd - clippedStart) / (end - start) * 100 };
}

export function normalizeReportStyle(value: unknown): 'classic' | 'modern' {
  return value === 'modern' ? 'modern' : 'classic';
}

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// Bangkok 06:00 is 23:00 UTC on the preceding calendar day.
function reportWindowStart(milliseconds: number) {
  return Math.floor((milliseconds + HOUR_MILLISECONDS) / DAY_MILLISECONDS) * DAY_MILLISECONDS - HOUR_MILLISECONDS;
}

function fallbackWindowStart(date: string) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date || '')
    ? timestamp(`${date}T06:00:00+07:00`)
    : null;
  return parsed ?? reportWindowStart(0);
}

function wrappedRowLines(row: ClassicReportRow) {
  const location = printReportLocation(row, 'th');
  const descriptionLines = Math.ceil(Array.from(location.name).length / CLASSIC_DESCRIPTION_CHARACTERS_PER_LINE);
  return Math.max(CLASSIC_ROW_MINIMUM_LINES, descriptionLines + (location.coordinates ? 1 : 0));
}

function paginateWindowRows<T extends ClassicReportRow>(rows: T[]) {
  const pages: T[][] = [];
  let pageRows: T[] = [];
  // The form pads each page's table to seven rows, so reserve its blank rows too.
  const minimumTableLines = CLASSIC_REPORT_ROWS_PER_PAGE * CLASSIC_ROW_MINIMUM_LINES;
  let tableLines = minimumTableLines;
  for (const row of rows) {
    const extraLines = wrappedRowLines(row) - CLASSIC_ROW_MINIMUM_LINES;
    if (pageRows.length && (pageRows.length === CLASSIC_REPORT_ROWS_PER_PAGE || tableLines + extraLines > CLASSIC_TABLE_LINE_BUDGET)) {
      pages.push(pageRows);
      pageRows = [];
      tableLines = minimumTableLines;
    }
    // An individually oversized row gets its own page and retains its full text.
    // Arbitrarily long fields still require rendering-level continuation.
    pageRows.push(row);
    tableLines += extraLines;
  }
  if (pageRows.length || !pages.length) pages.push(pageRows);
  return pages;
}

/** Each job prints once; additional 06:00–06:00 pages retain the full chart range. */
export function classicReportPages<T extends ClassicReportRow>(rows: T[], fallbackDate: string): ClassicReportPage<T>[] {
  const jobs = Array.isArray(rows) ? rows : [];
  const starts = jobs.map(row => timestamp(row.startTime)).filter((value): value is number => value != null);
  const firstWindow = starts.length
    ? reportWindowStart(starts.reduce((earliest, value) => Math.min(earliest, value), starts[0]))
    : fallbackWindowStart(fallbackDate);
  let lastWindow = firstWindow;
  let currentWindow = firstWindow;
  const rowsByWindow = new Map<number, T[]>();

  for (const row of jobs) {
    const start = timestamp(row.startTime);
    const end = timestamp(row.endTime);
    // Missing timestamps stay beside their preceding job. Never reorder input rows.
    if (start != null) currentWindow = Math.max(currentWindow, reportWindowStart(start));
    const windowRows = rowsByWindow.get(currentWindow) || [];
    windowRows.push(row);
    rowsByWindow.set(currentWindow, windowRows);
    lastWindow = Math.max(lastWindow, currentWindow);
    // An end exactly at 06:00 belongs to the preceding window; a start at 06:00
    // still creates the next window through currentWindow above.
    if (end != null) lastWindow = Math.max(lastWindow, reportWindowStart(end - 1));
  }

  const pages: ClassicReportPage<T>[] = [];
  let rowOffset = 0;
  for (let window = firstWindow; window <= lastWindow; window += DAY_MILLISECONDS) {
    const windowRows = rowsByWindow.get(window) || [];
    for (const pageRows of paginateWindowRows(windowRows)) {
      pages.push({
        rows: pageRows,
        rowOffset,
        windowStart: new Date(window).toISOString(),
        windowEnd: new Date(window + DAY_MILLISECONDS).toISOString(),
      });
      rowOffset += pageRows.length;
    }
  }
  return pages;
}

export type ClassicActivityDurations = {
  load: number | null;
  unload: number | null;
  wait: null;
  break: number | null;
  sleep: number | null;
  refuel: number | null;
  park: number | null;
  drive: null;
};

const ACTIVITY_MODES: Record<Exclude<keyof ClassicActivityDurations, 'drive' | 'wait'>, string[]> = {
  load: ['Load'],
  unload: ['Unload'],
  break: ['Break'],
  sleep: ['Park overnight'],
  refuel: ['Refuel'],
  // The printed parking total includes both stops and overnight parking.
  park: ['Stop vehicle', 'Park overnight'],
};

export function classicActivityDurations(rows: ClassicReportRow[]): ClassicActivityDurations {
  // Wait and driving are not recorded operation modes; gaps cannot establish them.
  const result: ClassicActivityDurations = { load: 0, unload: 0, wait: null, break: 0, sleep: 0, refuel: 0, park: 0, drive: null };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.status === 'Cancelled') continue;
    const formatted = formatReportDuration(row.startTime, row.endTime, row.duration);
    const parts = /^\d+:\d{2}:\d{2}$/.test(formatted) ? formatted.split(':').map(Number) : null;
    const seconds = parts ? parts[0] * 3600 + parts[1] * 60 + parts[2] : null;
    for (const key of Object.keys(ACTIVITY_MODES) as Array<keyof typeof ACTIVITY_MODES>) {
      if (!ACTIVITY_MODES[key].includes(row.mode || '')) continue;
      result[key] = result[key] == null || seconds == null ? null : result[key] + seconds;
    }
  }
  return result;
}
