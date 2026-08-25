import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AccessibilityInfo, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, findNodeHandle } from 'react-native';
import { operationActions } from '../lib/actions';
import type { DeviceBinding } from '../lib/device';
import type { DeviceJobHistorySummary } from '../lib/device-job-history';
import { filterAndSortMobileJobs, type MobileJobQuery, type MobileJobSort, type MobileJobStatusFilter } from '../lib/mobile-job-query';
import {
  formatMobileReportDateTime,
  formatMobileReportDay,
  formatMobileReportMonth,
  formatMobileReportTime,
  formatReportDuration,
  durationSeconds,
  savedJobDayKeys,
} from '../lib/mobile-report';
import type { SavedJob } from '../lib/saved-jobs';
import { RedGpsPin } from './RedGpsPin';

type MobileJobReportProps = {
  binding: DeviceBinding;
  error: string;
  jobs: SavedJob[];
  language: 'en' | 'th';
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  monthKeys: string[];
  portrait: boolean;
  reportDay: string | null;
  summary: DeviceJobHistorySummary;
  totalJobs: number;
  onClose(): void;
  onLoadMore(): void;
  onQueryChange(query: MobileJobQuery): void;
  onRefresh(): void;
  onSelectDay(dayKey: string | null): void;
};

const reportCopy = {
  en: {
    daily: 'Daily report', all: 'All saved jobs', refresh: 'Refresh', close: 'Close report', jobs: 'Jobs', completed: 'Completed', cancelled: 'Cancelled', recorded: 'Recorded time', saved: 'Saved jobs',
    emptyTitle: 'No saved jobs yet', emptyBody: 'Finished and cancelled jobs for this tablet will appear here.', noMatches: 'No jobs match these filters', noMatchesBody: 'Change or clear a filter to see more saved jobs.',
    search: 'Search jobs', searchPlaceholder: 'Vehicle, driver, activity, report ID, time…', date: 'Date', allMonths: 'All months', activity: 'Activity', allActivities: 'All activities',
    status: 'Status', allStatuses: 'All statuses', waiting: 'Waiting to sync', failed: 'Dashboard sync failed', sort: 'Sort', newest: 'Newest', oldest: 'Oldest', longest: 'Longest', activityAZ: 'Activity A–Z', clear: 'Clear filters', showing: 'Showing', of: 'of',
    filters: 'Search, sort & filter', filtersCollapsed: 'Show search and filters', filtersExpanded: 'Hide search and filters', activeFilters: 'active', loadMore: 'Load more jobs', loadingMore: 'Loading more…', start: 'Start', end: 'End', dateTimeRange: 'Date & time range', anyStart: 'Any start', anyEnd: 'Any end', clearRange: 'Clear date & time',
  },
  th: {
    daily: 'รายงานประจำวัน', all: 'งานที่บันทึกทั้งหมด', refresh: 'รีเฟรช', close: 'ปิดรายงาน', jobs: 'งาน', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิก', recorded: 'เวลารวม', saved: 'งานที่บันทึก',
    emptyTitle: 'ยังไม่มีงานที่บันทึก', emptyBody: 'งานที่จบหรือยกเลิกจากแท็บเล็ตเครื่องนี้จะแสดงที่นี่', noMatches: 'ไม่พบงานที่ตรงกับตัวกรอง', noMatchesBody: 'เปลี่ยนหรือล้างตัวกรองเพื่อดูงานที่บันทึกเพิ่มเติม',
    search: 'ค้นหางาน', searchPlaceholder: 'รถ คนขับ กิจกรรม รหัสรายงาน เวลา…', date: 'วันที่', allMonths: 'ทุกเดือน', activity: 'กิจกรรม', allActivities: 'ทุกกิจกรรม',
    status: 'สถานะ', allStatuses: 'ทุกสถานะ', waiting: 'รอซิงค์', failed: 'ส่งไปแดชบอร์ดไม่สำเร็จ', sort: 'เรียงลำดับ', newest: 'ใหม่ที่สุด', oldest: 'เก่าที่สุด', longest: 'นานที่สุด', activityAZ: 'กิจกรรม ก–ฮ', clear: 'ล้างตัวกรอง', showing: 'แสดง', of: 'จาก',
    filters: 'ค้นหา เรียง และกรอง', filtersCollapsed: 'แสดงการค้นหาและตัวกรอง', filtersExpanded: 'ซ่อนการค้นหาและตัวกรอง', activeFilters: 'ใช้งาน', loadMore: 'โหลดงานเพิ่มเติม', loadingMore: 'กำลังโหลด…', start: 'เริ่ม', end: 'จบ', dateTimeRange: 'ช่วงวันที่และเวลา', anyStart: 'ไม่กำหนดเวลาเริ่ม', anyEnd: 'ไม่กำหนดเวลาจบ', clearRange: 'ล้างวันที่และเวลา',
  },
} as const;

function localizedMode(mode: string, language: 'en' | 'th') {
  const action = operationActions.find(item => item[2] === mode);
  return language === 'th' && action ? action[1] : mode;
}

function reportStatus(job: SavedJob, language: 'en' | 'th') {
  if (job.status === 'Cancelled') return language === 'en' ? 'Cancelled' : 'ยกเลิก';
  return language === 'en' ? 'Completed' : 'เสร็จแล้ว';
}

function syncStatus(job: SavedJob, language: 'en' | 'th') {
  if (job.uploadFailed) return language === 'en' ? 'Dashboard sync failed' : 'ส่งไปแดชบอร์ดไม่สำเร็จ';
  if (job.pendingUpload) return language === 'en' ? 'Waiting to sync' : 'รอซิงค์';
  return null;
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}>
    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
  </Pressable>;
}

function FilterRow({ children, label }: { children: ReactNode; label: string }) {
  return <View style={styles.filterRow}>
    <Text style={styles.filterLabel}>{label}</Text>
    <ScrollView contentContainerStyle={styles.filterRail} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>{children}</ScrollView>
  </View>;
}

function JobCard({ job, language, landscape }: { job: SavedJob; language: 'en' | 'th'; landscape: boolean }) {
  const deliveryStatus = syncStatus(job, language);
  const deliverySummary = deliveryStatus ? ` ${language === 'en' ? 'Dashboard delivery' : 'การส่งไปแดชบอร์ด'} ${deliveryStatus}.` : '';
  const accessibleSummary = language === 'en'
    ? `${localizedMode(job.mode, language)}. ${reportStatus(job, language)}.${deliverySummary} Start ${formatMobileReportDateTime(job.startTime, language)}. End ${formatMobileReportDateTime(job.endTime, language)}. Duration ${formatReportDuration(durationSeconds(job.duration))}. Driver ${job.driverName || 'not identified'}. Report ${job.id}.`
    : `${localizedMode(job.mode, language)} สถานะ ${reportStatus(job, language)}.${deliverySummary} เริ่ม ${formatMobileReportDateTime(job.startTime, language)} จบ ${formatMobileReportDateTime(job.endTime, language)} ระยะเวลา ${formatReportDuration(durationSeconds(job.duration))} พนักงานขับรถ ${job.driverName || 'ไม่พบข้อมูล'} รหัสรายงาน ${job.id}`;
  return <View accessible accessibilityLabel={accessibleSummary} style={[styles.jobCard, landscape && styles.jobCardLandscape]}>
    <View style={styles.jobTopRow}>
      <Text style={styles.jobMode}>{localizedMode(job.mode, language)}</Text>
    </View>
    <View style={styles.jobStatuses}>
      <Text style={[styles.jobStatus, job.status === 'Cancelled' && styles.cancelledStatus]}>{reportStatus(job, language)}</Text>
      {deliveryStatus ? <Text style={[styles.jobStatus, job.pendingUpload && styles.pendingStatus, job.uploadFailed && styles.failedStatus]}>{deliveryStatus}</Text> : null}
    </View>
    <Text style={styles.jobTime}>{language === 'en' ? 'Start' : 'เริ่ม'} {formatMobileReportDateTime(job.startTime, language)}</Text>
    <Text style={styles.jobTimeSecondary}>{language === 'en' ? 'End' : 'จบ'} {formatMobileReportDateTime(job.endTime, language)}</Text>
    <Text style={styles.jobMeta}>{language === 'en' ? 'Duration' : 'ระยะเวลา'} {formatReportDuration(durationSeconds(job.duration))} · {job.driverName || (language === 'en' ? 'No driver identified' : 'ไม่พบข้อมูลพนักงานขับรถ')}</Text>
    <Text numberOfLines={1} style={styles.jobId}>{job.id}</Text>
  </View>;
}

function TimelineJobCard({ job, language, landscape }: { job: SavedJob; language: 'en' | 'th'; landscape: boolean }) {
  return <View style={[styles.timelineJobRow, job.status === 'Cancelled' && styles.cancelledTimeline]}>
    <View style={styles.timelineRail}>
      <View style={styles.timelineLine} />
      <View style={[styles.timelineDot, job.status === 'Cancelled' && styles.cancelledDot]} />
    </View>
    <View style={styles.timelineJobContent}>
      <Text accessible={false} style={styles.timelineTime}>{formatMobileReportTime(job.startTime)}–{formatMobileReportTime(job.endTime)}</Text>
      <JobCard job={job} language={language} landscape={landscape} />
    </View>
  </View>;
}

function bangkokBoundary(kind: 'start' | 'end') {
  const parts = new Intl.DateTimeFormat('en-CA-u-nu-latn', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return new Date(`${part('year')}-${part('month')}-${part('day')}T${kind === 'start' ? '00:00:00' : '23:59:59'}+07:00`);
}

export function MobileJobReport({ binding, error, hasMore, jobs, language, loading, loadingMore, monthKeys, portrait, reportDay, summary, totalJobs, onClose, onLoadMore, onQueryChange, onRefresh, onSelectDay }: MobileJobReportProps) {
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [status, setStatus] = useState<MobileJobStatusFilter>('all');
  const [sort, setSort] = useState<MobileJobSort>('newest');
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const reportTitleRef = useRef<Text | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;
  const deferredSearch = useDeferredValue(search);
  const dayKeys = useMemo(() => savedJobDayKeys(jobs), [jobs]);
  const query = useMemo<MobileJobQuery>(() => ({
    dayKey: reportDay,
    endAt: reportDay ? null : rangeEnd?.toISOString() || null,
    startAt: reportDay ? null : rangeStart?.toISOString() || null,
    monthKey: reportDay ? null : month,
    mode,
    search: deferredSearch,
    sort,
    status,
  }), [deferredSearch, mode, month, rangeEnd, rangeStart, reportDay, sort, status]);
  const visibleJobs = useMemo(() => filterAndSortMobileJobs(jobs, query), [jobs, query]);
  useEffect(() => { onQueryChangeRef.current(query); }, [query]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const node = findNodeHandle(reportTitleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 100);
    return () => clearTimeout(timer);
  }, []);
  const latestDay = dayKeys[0] || null;
  const daily = Boolean(reportDay);
  const copy = reportCopy[language];
  const hasDateTimeRange = Boolean(!daily && (rangeStart || rangeEnd));
  const filtersActive = Boolean(search || mode || status !== 'all' || sort !== 'newest' || (!daily && month) || hasDateTimeRange);
  const activeFilterCount = Number(Boolean(search.trim())) + Number(Boolean(mode)) + Number(status !== 'all') + Number(sort !== 'newest') + Number(Boolean(!daily && month)) + Number(hasDateTimeRange);
  const statusOptions: Array<[MobileJobStatusFilter, string]> = [
    ['all', copy.allStatuses],
    ['completed', copy.completed],
    ['cancelled', copy.cancelled],
    ['pending', copy.waiting],
    ['failed', copy.failed],
  ];
  const sortOptions: Array<[MobileJobSort, string]> = [
    ['newest', copy.newest],
    ['oldest', copy.oldest],
    ['duration_desc', copy.longest],
    ['mode_asc', copy.activityAZ],
  ];
  const selectedSortLabel = sortOptions.find(([value]) => value === sort)?.[1] || copy.newest;
  const collapsedFilterSummary = [
    daily
      ? (reportDay ? formatMobileReportDay(reportDay, language) : copy.daily)
      : hasDateTimeRange
        ? `${rangeStart ? formatMobileReportDateTime(rangeStart.toISOString(), language) : copy.anyStart} – ${rangeEnd ? formatMobileReportDateTime(rangeEnd.toISOString(), language) : copy.anyEnd}`
        : (month ? formatMobileReportMonth(month, language) : copy.allMonths),
    mode ? localizedMode(mode, language) : copy.allActivities,
    statusOptions.find(([value]) => value === status)?.[1] || copy.allStatuses,
    selectedSortLabel,
  ].join(' · ');

  function clearFilters() {
    setSearch('');
    setMonth(null);
    setRangeStart(null);
    setRangeEnd(null);
    setMode(null);
    setStatus('all');
    setSort('newest');
  }

  function chooseRangeBoundary(kind: 'start' | 'end') {
    const current = (kind === 'start' ? rangeStart : rangeEnd) || bangkokBoundary(kind);
    DateTimePickerAndroid.open({
      mode: 'date',
      value: current,
      timeZoneName: 'Asia/Bangkok',
      onValueChange: (_event, selectedDate) => {
        DateTimePickerAndroid.open({
          is24Hour: true,
          mode: 'time',
          value: selectedDate,
          timeZoneName: 'Asia/Bangkok',
          onValueChange: (_timeEvent, selectedDateTime) => {
            const normalized = new Date(selectedDateTime);
            normalized.setUTCSeconds(kind === 'start' ? 0 : 59, 0);
            setMonth(null);
            if (kind === 'start') {
              setRangeStart(normalized);
              if (rangeEnd && normalized > rangeEnd) setRangeEnd(normalized);
            } else {
              setRangeEnd(normalized);
              if (rangeStart && normalized < rangeStart) setRangeStart(normalized);
            }
          },
        });
      },
    });
  }

  const header = <View>
    <View style={styles.viewSwitch}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: daily, disabled: !latestDay }} disabled={!latestDay} onPress={() => onSelectDay(reportDay || latestDay)} style={[styles.switchButton, daily && styles.switchButtonActive, !latestDay && styles.disabled]}><Text style={[styles.switchText, daily && styles.switchTextActive]}>{copy.daily}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !daily }} onPress={() => onSelectDay(null)} style={[styles.switchButton, !daily && styles.switchButtonActive]}><Text style={[styles.switchText, !daily && styles.switchTextActive]}>{copy.all}</Text></Pressable>
    </View>
    {daily ? <ScrollView contentContainerStyle={styles.dayPicker} horizontal showsHorizontalScrollIndicator={false}>
      {dayKeys.map(day => <Pressable accessibilityRole="button" accessibilityState={{ selected: reportDay === day }} key={day} onPress={() => onSelectDay(day)} style={[styles.dayButton, reportDay === day && styles.dayButtonActive]}><Text style={[styles.dayButtonText, reportDay === day && styles.dayButtonTextActive]}>{formatMobileReportDay(day, language)}</Text></Pressable>)}
    </ScrollView> : null}
    <View style={styles.filtersPanel}>
      <Pressable
        accessibilityLabel={filtersExpanded ? copy.filtersExpanded : copy.filtersCollapsed}
        accessibilityRole="button"
        accessibilityState={{ expanded: filtersExpanded }}
        onPress={() => setFiltersExpanded(value => !value)}
        style={styles.filterToggle}
      >
        <View style={styles.filterToggleCopy}>
          <View style={styles.filterToggleTitleRow}>
            <Text style={styles.filterToggleTitle}>{copy.filters}</Text>
            {activeFilterCount ? <Text style={styles.filterCountBadge}>{activeFilterCount} {copy.activeFilters}</Text> : null}
          </View>
          <Text numberOfLines={1} style={styles.filterSummary}>{collapsedFilterSummary}</Text>
        </View>
        <View style={[styles.filterChevron, filtersExpanded && styles.filterChevronExpanded]} />
      </Pressable>
      {filtersExpanded ? <View style={styles.filterBody}><TextInput
        accessibilityLabel={copy.search}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSearch}
        placeholder={copy.searchPlaceholder}
        placeholderTextColor="#68727D"
        returnKeyType="search"
        style={styles.searchInput}
        value={search}
      />
      {!daily ? <FilterRow label={copy.date}>
        <FilterChip active={!month && !hasDateTimeRange} label={copy.allMonths} onPress={() => { setMonth(null); setRangeStart(null); setRangeEnd(null); }} />
        {monthKeys.map(monthKey => <FilterChip active={month === monthKey && !hasDateTimeRange} key={monthKey} label={formatMobileReportMonth(monthKey, language)} onPress={() => { setMonth(monthKey); setRangeStart(null); setRangeEnd(null); }} />)}
      </FilterRow> : null}
      {!daily ? <View style={styles.dateTimeSection}>
        <Text style={styles.filterLabel}>{copy.dateTimeRange}</Text>
        <View style={styles.dateTimeRow}>
          <Pressable accessibilityRole="button" onPress={() => chooseRangeBoundary('start')} style={styles.dateTimeButton}><Text style={styles.dateTimeButtonLabel}>{copy.start}</Text><Text style={styles.dateTimeButtonValue}>{rangeStart ? formatMobileReportDateTime(rangeStart.toISOString(), language) : copy.anyStart}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => chooseRangeBoundary('end')} style={styles.dateTimeButton}><Text style={styles.dateTimeButtonLabel}>{copy.end}</Text><Text style={styles.dateTimeButtonValue}>{rangeEnd ? formatMobileReportDateTime(rangeEnd.toISOString(), language) : copy.anyEnd}</Text></Pressable>
        </View>
        {hasDateTimeRange ? <Pressable accessibilityRole="button" onPress={() => { setRangeStart(null); setRangeEnd(null); }} style={styles.clearRangeButton}><Text style={styles.clearButtonText}>{copy.clearRange}</Text></Pressable> : null}
      </View> : null}
      <FilterRow label={copy.activity}>
        <FilterChip active={!mode} label={copy.allActivities} onPress={() => setMode(null)} />
        {operationActions.map(([, thai, english]) => <FilterChip active={mode === english} key={english} label={language === 'en' ? english : thai} onPress={() => setMode(english)} />)}
      </FilterRow>
      <FilterRow label={copy.status}>
        {statusOptions.map(([value, label]) => <FilterChip active={status === value} key={value} label={label} onPress={() => setStatus(value)} />)}
      </FilterRow>
      <FilterRow label={copy.sort}>
        {sortOptions.map(([value, label]) => <FilterChip active={sort === value} key={value} label={label} onPress={() => setSort(value)} />)}
      </FilterRow>
      <View style={styles.filterFooter}>
        <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{copy.showing} {visibleJobs.length} {copy.of} {totalJobs}</Text>
        {filtersActive ? <Pressable accessibilityRole="button" onPress={clearFilters} style={styles.clearButton}><Text style={styles.clearButtonText}>{copy.clear}</Text></Pressable> : null}
      </View>
      </View> : <Text accessibilityLiveRegion="polite" style={styles.collapsedResultCount}>{copy.showing} {visibleJobs.length} {copy.of} {totalJobs}</Text>}
    </View>
    <View style={styles.summaryGrid}>
      {[
        [copy.jobs, String(summary.total)],
        [copy.completed, String(summary.completed)],
        [copy.cancelled, String(summary.cancelled)],
        [copy.recorded, formatReportDuration(summary.durationSeconds)],
      ].map(([label, value]) => <View accessible accessibilityLabel={`${label}: ${value}`} key={label} style={[styles.summaryCard, portrait && styles.summaryCardPortrait]}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>)}
    </View>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{daily ? (language === 'en' ? 'Timeline & saved jobs' : 'ไทม์ไลน์และงานที่บันทึก') : copy.saved}</Text>
  </View>;

  return <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.page}>
    <View style={styles.header}>
      <RedGpsPin size={34} />
      <View style={styles.headerInfo}>
        <Text ref={reportTitleRef} accessible accessibilityRole="header" style={styles.title}>{daily ? copy.daily : copy.all}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{binding.vehicleNumber} · {binding.deviceId}{reportDay ? ` · ${formatMobileReportDay(reportDay, language)}` : ''}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.refresh} accessibilityState={{ busy: loading, disabled: loading }} disabled={loading} onPress={onRefresh} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{loading ? '…' : copy.refresh}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.close} onPress={onClose} style={styles.closeButton}><Text style={styles.closeButtonText}>×</Text></Pressable>
    </View>
    {error ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <FlatList
      accessibilityLabel={daily ? (language === 'en' ? 'Daily job timeline' : 'ไทม์ไลน์งานประจำวัน') : copy.saved}
      ListHeaderComponent={header}
      ListFooterComponent={hasMore ? <Pressable accessibilityRole="button" accessibilityState={{ busy: loadingMore, disabled: loadingMore }} disabled={loadingMore} onPress={onLoadMore} style={[styles.loadMoreButton, loadingMore && styles.disabled]}><Text style={styles.loadMoreText}>{loadingMore ? copy.loadingMore : copy.loadMore}</Text></Pressable> : null}
      ListEmptyComponent={<View accessibilityLiveRegion="polite" style={styles.empty}><Text accessibilityRole="header" style={styles.emptyTitle}>{loading ? (language === 'en' ? 'Loading jobs…' : 'กำลังโหลดงาน…') : jobs.length ? copy.noMatches : copy.emptyTitle}</Text><Text style={styles.emptyBody}>{jobs.length ? copy.noMatchesBody : copy.emptyBody}</Text></View>}
      contentContainerStyle={[styles.list, !visibleJobs.length && styles.emptyList]}
      data={visibleJobs}
      initialNumToRender={12}
      key={`${portrait ? 'portrait' : 'landscape'}-${daily ? 'daily' : 'all'}`}
      keyExtractor={item => item.id}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maxToRenderPerBatch={12}
      numColumns={portrait ? 1 : 2}
      onRefresh={onRefresh}
      removeClippedSubviews
      refreshing={loading}
      renderItem={({ item }) => daily
        ? <TimelineJobCard job={item} language={language} landscape={!portrait} />
        : <JobCard job={item} language={language} landscape={!portrait} />}
      updateCellsBatchingPeriod={40}
      windowSize={9}
    />
  </View>;
}

const colors = { red: '#E31B23', maroon: '#7A1424', black: '#111111', grey: '#5E6872', lightGrey: '#EEF0F2', white: '#FFFFFF' };
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.lightGrey },
  header: { minHeight: 76, backgroundColor: colors.black, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  headerInfo: { flex: 1, minWidth: 0 },
  title: { color: colors.white, fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#C8CDD2', fontSize: 11, marginTop: 3 },
  secondaryButton: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: '#5C6268', borderRadius: 7, paddingHorizontal: 12 },
  secondaryButtonText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  closeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: colors.white, fontSize: 30, lineHeight: 32 },
  error: { color: colors.maroon, backgroundColor: '#FFE8E9', paddingHorizontal: 16, paddingVertical: 10, fontWeight: '700' },
  list: { padding: 12, gap: 10 },
  emptyList: { flexGrow: 1 },
  viewSwitch: { flexDirection: 'row', backgroundColor: '#DDE1E4', borderRadius: 9, padding: 3, marginBottom: 10 },
  switchButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 7, paddingHorizontal: 12 },
  switchButtonActive: { backgroundColor: colors.black },
  switchText: { color: colors.grey, fontSize: 13, fontWeight: '800' },
  switchTextActive: { color: colors.white },
  disabled: { opacity: 0.45 },
  dayPicker: { gap: 7, paddingBottom: 10 },
  dayButton: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.white, borderColor: '#D7DBDF', borderWidth: 1, borderRadius: 7, paddingHorizontal: 12 },
  dayButtonActive: { backgroundColor: colors.red, borderColor: colors.red },
  dayButtonText: { color: colors.black, fontSize: 12, fontWeight: '700' },
  dayButtonTextActive: { color: colors.white },
  filtersPanel: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 10, padding: 12, marginBottom: 10 },
  filterToggle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  filterToggleCopy: { flex: 1, minWidth: 0 },
  filterToggleTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  filterToggleTitle: { color: colors.black, fontSize: 15, fontWeight: '900' },
  filterCountBadge: { color: colors.white, backgroundColor: colors.red, borderRadius: 11, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900' },
  filterSummary: { color: colors.grey, fontSize: 11, fontWeight: '600', marginTop: 4 },
  filterChevron: { width: 10, height: 10, borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.black, transform: [{ rotate: '45deg' }, { translateY: -2 }] },
  filterChevronExpanded: { transform: [{ rotate: '225deg' }, { translateY: -2 }] },
  filterBody: { borderTopWidth: 1, borderTopColor: '#E2E5E7', marginTop: 8, paddingTop: 12 },
  collapsedResultCount: { color: colors.grey, fontSize: 12, fontWeight: '700', borderTopWidth: 1, borderTopColor: '#E2E5E7', marginTop: 8, paddingTop: 10 },
  searchInput: { minHeight: 48, borderWidth: 1, borderColor: '#BFC5CA', borderRadius: 8, paddingHorizontal: 14, color: colors.black, backgroundColor: colors.white, fontSize: 15, fontWeight: '600' },
  filterRow: { marginTop: 12 },
  dateTimeSection: { marginTop: 12 },
  dateTimeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateTimeButton: { flex: 1, minWidth: 210, minHeight: 58, justifyContent: 'center', borderWidth: 1, borderColor: '#C8CDD2', borderRadius: 8, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 8 },
  dateTimeButtonLabel: { color: colors.grey, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  dateTimeButtonValue: { color: colors.black, fontSize: 12, fontWeight: '800', marginTop: 4 },
  clearRangeButton: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', marginTop: 3, paddingHorizontal: 8 },
  filterLabel: { color: colors.black, fontSize: 12, fontWeight: '900', marginBottom: 7 },
  filterRail: { gap: 7, paddingRight: 8 },
  filterChip: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: '#C8CDD2', borderRadius: 24, backgroundColor: colors.white, paddingHorizontal: 13 },
  filterChipActive: { backgroundColor: colors.black, borderColor: colors.black },
  filterChipText: { color: '#535C64', fontSize: 12, fontWeight: '800' },
  filterChipTextActive: { color: colors.white },
  filterFooter: { minHeight: 32, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  resultCount: { color: colors.grey, fontSize: 12, fontWeight: '700' },
  clearButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10 },
  clearButtonText: { color: colors.red, fontSize: 12, fontWeight: '900' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  summaryCard: { flex: 1, minWidth: 130, backgroundColor: colors.white, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 9, padding: 14 },
  summaryCardPortrait: { flexBasis: '47%' },
  summaryLabel: { color: colors.grey, fontSize: 11, fontWeight: '700' },
  summaryValue: { color: colors.black, fontSize: 24, fontWeight: '900', marginTop: 4 },
  sectionTitle: { color: colors.black, fontSize: 18, fontWeight: '900', marginTop: 4, marginBottom: 10 },
  timelineJobRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'stretch' },
  cancelledTimeline: { backgroundColor: '#FFF7F7', borderRadius: 10 },
  timelineRail: { width: 24, alignItems: 'center', alignSelf: 'stretch' },
  timelineLine: { position: 'absolute', width: 2, top: 10, bottom: -10, backgroundColor: '#C8CDD2' },
  timelineDot: { width: 11, height: 11, marginTop: 5, borderRadius: 6, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.white },
  cancelledDot: { backgroundColor: colors.grey },
  timelineJobContent: { flex: 1, minWidth: 0, paddingBottom: 10 },
  timelineTime: { color: colors.black, fontSize: 12, fontWeight: '900', marginBottom: 6 },
  jobCard: { flex: 1, minWidth: 0, backgroundColor: colors.white, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 10, padding: 16 },
  jobCardLandscape: { marginHorizontal: 5 },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jobMode: { flex: 1, color: colors.black, fontSize: 18, fontWeight: '800' },
  jobStatuses: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 8 },
  jobStatus: { color: '#176B3A', backgroundColor: '#E7F7ED', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden', fontSize: 11, fontWeight: '800' },
  cancelledStatus: { color: colors.grey, backgroundColor: '#E4E7E9' },
  pendingStatus: { color: '#7A4C00', backgroundColor: '#FFF0CC' },
  failedStatus: { color: colors.maroon, backgroundColor: '#FFE0E2' },
  jobTime: { color: colors.black, fontSize: 14, fontWeight: '700', marginTop: 12 },
  jobTimeSecondary: { color: colors.black, fontSize: 14, fontWeight: '700', marginTop: 4 },
  jobMeta: { color: colors.grey, fontSize: 12, marginTop: 6 },
  jobId: { color: colors.grey, fontSize: 10, marginTop: 10 },
  empty: { alignItems: 'center', padding: 30 },
  emptyTitle: { color: colors.black, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: colors.grey, fontSize: 13, textAlign: 'center', marginTop: 7 },
  loadMoreButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.red, backgroundColor: colors.white, marginTop: 4, marginBottom: 8 },
  loadMoreText: { color: colors.red, fontSize: 13, fontWeight: '900' },
});
