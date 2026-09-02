import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';

function normalizedCss(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
}

function rulesForSelector(source, expectedSelector) {
  const rules = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of normalizedCss(source).matchAll(rulePattern)) {
    const selectors = match[1].split(',');
    if (!selectors.includes(expectedSelector)) continue;
    const declarations = {};
    for (const declaration of match[2].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      declarations[declaration.slice(0, separator)] = declaration.slice(separator + 1);
    }
    rules.push(declarations);
  }
  return rules;
}

function mediaContents(source, condition) {
  const css = normalizedCss(source);
  const marker = `@media(${condition}){`;
  const contents = [];
  let searchFrom = 0;
  while (searchFrom < css.length) {
    const start = css.indexOf(marker, searchFrom);
    if (start < 0) break;
    const bodyStart = start + marker.length;
    let depth = 1;
    let end = bodyStart;
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      end += 1;
    }
    contents.push(css.slice(bodyStart, end - 1));
    searchFrom = end;
  }
  return contents.join('');
}

function assertDeclaration(source, selector, property, value) {
  const normalizedValue = value.replace(/\s+/g, '');
  assert.ok(
    rulesForSelector(source, selector).some(rule => rule[property] === normalizedValue),
    `${selector} should declare ${property}: ${value}`,
  );
}

test('route deviation thresholds accept ordinary hundredth-kilometre values and reset stale feedback', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/routes-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /min="0\.01" max="50" step="0\.01"/);
  assert.doesNotMatch(source, /min="0\.01" max="50" step="0\.1"/);
  assert.match(source, /async function saveSettings\(event\) \{[^}]*setError\(''\); setMessage\(''\);/);
});

test('route management computes and saves Google road geometry', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/routes-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /normalizeRoutePath\(\(await computeGoogleDrivingRoute\(parsedAnchors, lang\)\)\.path, 700\)/);
  assert.match(source, /JSON\.stringify\(\{ \.\.\.form, routePath \}\)/);
});

test('route maps prefer the current Routes API and retain a directions fallback for the existing key', async () => {
  const loader = await readFile(fileURLToPath(new NodeUrl('../web/lib/google-maps-loader.js', import.meta.url)), 'utf8');
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  assert.match(loader, /Route\.computeRoutes/);
  assert.match(loader, /new google\.maps\.DirectionsService\(\)/);
  assert.match(map, /new google\.maps\.Data\(\{ map \}\)/);
  assert.doesNotMatch(map, /new google\.maps\.Marker/);
});

test('route maps replace Google default UI with proportional dashboard controls', async () => {
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  assert.match(map, /disableDefaultUI: true/);
  for (const control of ['mapTypeControl', 'zoomControl', 'fullscreenControl', 'streetViewControl']) {
    assert.match(map, new RegExp(`${control}: false`));
  }
  assert.match(map, /className="route-map-controls"/);
  assert.match(map, /aria-pressed=\{mapType === 'roadmap'\}/);
  assert.match(map, /onClick=\{\(\) => changeZoom\(1\)\}/);
  assert.match(map, /onClick=\{fitRoute\}/);
});

test('Google Maps follows the selected dashboard language', async () => {
  const loader = await readFile(fileURLToPath(new NodeUrl('../web/lib/google-maps-loader.js', import.meta.url)), 'utf8');
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  const page = await readFile(fileURLToPath(new NodeUrl('../web/app/page.jsx', import.meta.url)), 'utf8');
  assert.match(loader, /setOptions\(\{ key, v: 'weekly', language: requestedLanguage, region: 'TH' \}\)/);
  assert.match(loader, /language,\n\s+region: 'TH'/);
  assert.match(map, /loadGoogleMaps\(lang\)/);
  assert.match(map, /computeGoogleDrivingRoute\(routePoints, lang\)/);
  assert.match(page, /localStorage\.setItem\('songdee-language', next\)/);
  assert.match(page, /window\.location\.reload\(\)/);
});

test('the dashboard route assignment selector searches and pages a bounded server result', async () => {
  const selector = await readFile(fileURLToPath(new NodeUrl('../web/app/route-selector.jsx', import.meta.url)), 'utf8');
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  assert.match(selector, /\/api\/admin\/job-route-options\?\$\{params\}/);
  assert.match(selector, /const routePageSize = 50/);
  assert.match(selector, /offset: String\(offset\)/);
  assert.match(selector, /async function loadMoreRoutes\(\)/);
  assert.match(selector, /t\.loadMore/);
  assert.match(selector, /role="combobox"/);
  assert.match(selector, /role="listbox"/);
  assert.match(drawer, /<RouteSelector/);
  assert.doesNotMatch(drawer, /<select id="gps-route-assignment"/);
});

test('the GPS drawer hides route editing by default and propagates scoped assignments across the dashboard', async () => {
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(drawer, /useState\('job'\)/);
  assert.match(drawer, /useState\(false\);\n\s+const \[draftRouteName/);
  assert.match(drawer, /aria-expanded=\{routeEditorOpen\} aria-controls="route-assignment-editor"/);
  assert.match(drawer, /routeEditorOpen \? <div className="route-assignment-editor"/);
  assert.match(drawer, /onSelect=\{setDraftRouteName\}/);
  assert.match(drawer, /const scope = routeScope;/);
  assert.match(drawer, /t\.workPeriodHint/);
  assert.match(drawer, /t\.thisJob/);
  assert.match(drawer, /onClick=\{assignRoute\}/);
  const mutationIndex = drawer.indexOf('assignment = await adminFetch');
  const propagationIndex = drawer.indexOf('onRouteAssigned?.(assignment);', mutationIndex);
  const detailRefreshIndex = drawer.indexOf('const refreshed = await adminFetch', propagationIndex);
  assert.ok(mutationIndex >= 0 && propagationIndex > mutationIndex && detailRefreshIndex > propagationIndex,
    'a successful route mutation should propagate before the optional drawer detail refresh');
  const handlerStart = dashboard.indexOf('function handleRouteAssigned(assignment) {');
  const handlerEnd = dashboard.indexOf('\n  const hasFilters', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the report dashboard should define an assignment-aware route handler');
  const routeAssignmentHandler = dashboard.slice(handlerStart, handlerEnd);
  assert.match(routeAssignmentHandler, /assignment\?\.reportIds/);
  assert.match(routeAssignmentHandler, /setReports\(items => items\.map\(/);
  assert.match(routeAssignmentHandler, /setSelectedReport\(current =>/);
  assert.match(routeAssignmentHandler, /optimisticRouteAssignments\.current\.set\(String\(reportId\), routeName\)/);
  assert.match(routeAssignmentHandler, /setTimelineRouteAssignment\(assignment \|\| null\)/);
  assert.match(routeAssignmentHandler, /setTimelineRefreshKey\(value => value \+ 1\)/);
  assert.match(routeAssignmentHandler, /void loadReports\(\{ silent: true, networkOnly: true \}\)/);
  assert.match(dashboard, /const optimisticRouteAssignments = useRef\(new Map\(\)\)/);
  assert.match(dashboard, /applyOptimisticRouteAssignments\([\s\S]*optimisticRouteAssignments\.current/);
  assert.match(dashboard, /networkOnly \? \{ cacheOffline: false, cache: 'no-store' \} : \{\}/);
  assert.match(dashboard, /routeAssignment=\{timelineRouteAssignment\}/);
  assert.match(timeline, /routeAssignment = null/);
  assert.match(timeline, /const optimisticRouteAssignments = useRef\(new Map\(\)\)/);
  assert.match(timeline, /adminFetchAllReportsNetworkOnly\(requestFilters\)/);
  assert.match(timeline, /\{ cacheOffline: false, cache: 'no-store' \}/);
  assert.match(timeline, /setReports\(items => applyOptimisticRouteAssignments\(items, optimisticRouteAssignments\.current\)\)/);
  assert.match(timeline, /void loadReports\(\{ silent: true, networkOnly: affectedReportIds\.size > 0 \}\)/);
  assert.match(dashboard, /onRouteAssigned=\{handleRouteAssigned\}/);
  assert.doesNotMatch(dashboard, /onRouteAssigned=\{\(\) => void loadReports\(\{ silent: true \}\)\}/);
  const reportResetStart = drawer.indexOf('useEffect(() => {\n    setPage(1);');
  const reportResetEnd = drawer.indexOf('\n\n  useEffect', reportResetStart);
  const reportResetEffect = drawer.slice(reportResetStart, reportResetEnd);
  assert.match(reportResetEffect, /\}, \[report\.id\]\);/);
  assert.doesNotMatch(reportResetEffect, /setDraftRouteName|report\.routeName/,
    'propagating the assigned route should not clear the success notice for the current report');
  assert.match(drawer, /setDraftRouteName\(report\.routeName \|\| ''\);\n  \}, \[report\.routeName\]\);/);
});

test('timeline rows use the complete work-period grouping key', async () => {
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(timeline, /grouped\.set\(key, \{ groupKey: key,/);
  assert.match(timeline, /key=\{row\.groupKey\}/);
  assert.doesNotMatch(timeline, /key=\{`\$\{row\.date\}-\$\{row\.actualDate\}-\$\{row\.vehicle\}`\}/);
});

test('in-drawer job navigation remounts the drawer and rejects stale action responses', async () => {
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');

  assert.match(dashboard, /<JobGpsDrawer key=\{selectedReport\.id\} report=\{selectedReport\}/);
  assert.match(dashboard, /const closeSelectedReport = useCallback\(\(\) => setSelectedReport\(null\), \[\]\);/);
  assert.match(dashboard, /onClose=\{closeSelectedReport\}/);
  assert.match(drawer, /const activeReportIdRef = useRef\(String\(report\.id \|\| ''\)\);/);
  assert.match(drawer, /activeReportIdRef\.current = String\(report\.id \|\| ''\);/);
  assert.match(drawer, /if \(activeReportIdRef\.current === mountedReportId\) activeReportIdRef\.current = '';/);
  assert.match(drawer, /function isActiveReport\(reportId\)/);

  const assignStart = drawer.indexOf('async function assignRoute() {');
  const retryStart = drawer.indexOf('async function retryLookup() {');
  const assignSource = drawer.slice(assignStart, retryStart);
  const retryEnd = drawer.indexOf('\n\n  const activeDetail', retryStart);
  const retrySource = drawer.slice(retryStart, retryEnd);
  assert.match(assignSource, /const actionReportId = String\(report\.id \|\| ''\);/);
  assert.match(assignSource, /onRouteAssigned\?\.\(assignment\);\n\s+if \(!isActiveReport\(actionReportId\)\) return;/);
  assert.match(assignSource, /setWorkPeriodGpsRefreshKey\(value => value \+ 1\);/);
  assert.match(assignSource, /const refreshed = await adminFetch\(`\/api\/admin\/reports\/\$\{encodeURIComponent\(actionReportId\)\}\/gps/);
  assert.match(assignSource, /if \(!isActiveReport\(actionReportId\)\) return;\n\s+setDetail\(refreshed\);/);
  assert.match(assignSource, /if \(isActiveReport\(actionReportId\)\) setRouteBusy\(false\);/);
  assert.match(retrySource, /const actionReportId = String\(report\.id \|\| ''\);/);
  assert.match(retrySource, /onReportUpdated\?\.\(mutatedReport\);\n\s+if \(!isActiveReport\(actionReportId\)\) return;/);
  assert.match(retrySource, /if \(!isActiveReport\(actionReportId\)\) return;\n\s+setDetail\(refreshed\);/);
  assert.match(retrySource, /if \(isActiveReport\(actionReportId\)\) setRetrying\(false\);/);
});

test('the GPS drawer keeps counts and retry feedback semantic when detail refreshes fail', async () => {
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  assert.match(drawer, /const reportPointCount = pointCountValue\(report\.deviceGpsSamples\);/);
  assert.match(drawer, /const pointCount = loading \|\| error \|\| retrying \|\| !activeDetail \? reportPointCount : detailPointCount;/);
  assert.match(drawer, /const lookupNotApplicable = displayedReport\.status === 'Cancelled' \|\| displayedReport\.gpsLookupStatus === 'not_applicable';/);
  assert.match(drawer, /lookupNotApplicable && !pointCount\s+\? 'is-neutral'/);
  assert.match(drawer, /disabled=\{lookupBusy\}/);
  assert.match(drawer, /status === 'no_data'\) return \{ tone: 'neutral'/);
  assert.match(drawer, /status === 'lookup_unavailable'\) return \{ tone: 'error'/);
  assert.match(drawer, /status === 'lookup_failed'\) return \{ tone: 'error'/);
  assert.match(drawer, /data\.gpsReconciliation\?\.gpsSync \? 1 : pointCountValue\(data\.report\?\.deviceGpsSamples\)/);
  assert.match(drawer, /routeDeviation\?\.status === 'within_route' && pointCount > 0/);

  const mutationIndex = drawer.indexOf('const mutatedReport =');
  const propagationIndex = drawer.indexOf('onReportUpdated?.(mutatedReport);', mutationIndex);
  const refreshIndex = drawer.indexOf('const refreshed = await adminFetch', propagationIndex);
  assert.ok(mutationIndex >= 0 && propagationIndex > mutationIndex && refreshIndex > propagationIndex,
    'the successful retry mutation should propagate before the optional detail refresh');
});

test('confirmed route deviations expose an exact GPS event in the map, drawer, and timeline', async () => {
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(drawer, /deviationEvents=\{routeDeviation\?\.events \|\| \[\]\}/);
  assert.match(drawer, /t\.deviationBegan/);
  assert.match(drawer, /t\.deviationLocation/);
  assert.match(map, /const deviationPoints = useMemo/);
  assert.match(map, /color: '#B92B3A', scale: 9/);
  assert.match(timeline, /routeDeviation: speedSeries\.routeDeviationByReportId\[report\.id\] \|\| null/);
});

test('the GPS drawer maps the complete work period and refreshes it after a lookup retry', async () => {
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(drawer, /adminFetchWorkPeriodGpsData/);
  assert.match(drawer, /adminFetchWorkPeriodGpsData\(report\.id, \{ signal: controller\.signal \}\)/);
  assert.match(drawer, /setWorkPeriodGpsRefreshKey\(value => value \+ 1\)/);
  assert.match(drawer, /workPeriodGps \? workPeriodSamples : samples/);
  assert.match(drawer, /workPeriodGpsLoading \? t\.periodMapLoading : workPeriodGpsError \|\| periodMapSummary/);
  assert.match(drawer, /anchors=\{activeDetail\?\.route\?\.anchors \|\| \[\]\}/);
  assert.match(drawer, /selectedJobId=\{selectedJobId\}/);
  assert.match(drawer, /workPeriodJobCount=\{mapJobCount\}/);
  assert.match(drawer, /groupGpsSamplesByJob\(mapSamples, selectedJobId\)/);
  assert.match(drawer, /mapGpsData\.locationClusters\.length/);
  assert.match(drawer, /mapGpsData\.pointCount/);
  assert.match(drawer, /mappedMapJobCount/);
  assert.match(drawer, /periodMapLoaded: '\{jobs\} jobs · \{points\} GPS fixes · \{locations\} map locations · \{mapped\} jobs mapped · \{selected\} from this job'/);
  assert.match(drawer, /const mapReports = workPeriodGps \? workPeriodReports : \[displayedReport\];/);
  assert.match(drawer, /reports=\{mapReports\}/);
  assert.match(drawer, /onOpenJob=\{onOpenReport\}/);
  assert.match(dashboard, /onOpenReport=\{setSelectedReport\}/);
  assert.doesNotMatch(drawer, /activeDetail\?\.route \? <section className="gps-route-section"/);
});

test('the work-period map draws the raw trail and truthful clickable location stacks without losing job-fix detail', async () => {
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  assert.match(map, /groupGpsSamplesByJob\(samples, selectedJobId\)/);
  assert.match(map, /if \(!routePoints\.length && !recordedPoints\.length && !deviationPoints\.length\)/);
  assert.doesNotMatch(map, /if \(routePoints\.length < 2\)/);
  assert.match(map, /for \(const group of gpsData\.groups\)/);
  assert.match(map, /const workPeriodPath = gpsData\.trailPoints\.map/);
  assert.match(map, /if \(workPeriodPath\.length > 1\)/);
  assert.match(map, /path: 'M 0,-1 0,1'/);
  assert.match(map, /repeat: '16px'/);
  assert.match(map, /icons: dashedLineIcons\('#FFFFFF', 8\),[\s\S]*zIndex: 31/);
  assert.match(map, /icons: dashedLineIcons\('#0B6F70', 4\),[\s\S]*zIndex: 32/);
  assert.match(map, /strokeDasharray="10 8"/);
  assert.match(map, /const gpsPath = group\.points\.map/);
  assert.match(map, /if \(group\.selected && gpsPath\.length > 1\)/);
  assert.match(map, /const locationClusters = gpsData\.locationClusters \|\| \[\];/);
  assert.match(map, /const clusterMembershipByFixKey = useMemo/);
  assert.match(map, /for \(const point of cluster\.points\) membership\.set\(fixKey\(point\), \{ clusterKey: cluster\.key, clusterIndex: index \+ 1 \}\);/);
  assert.match(map, /const membership = clusterMembershipByFixKey\.get\(pointFixKey\);/);
  assert.doesNotMatch(map, /const clusterKey = coordinateKey\(point\);/);
  assert.match(map, /function clusterMarkerIcon\(google, count, selected, active\)/);
  assert.match(map, /feature\.setProperty\('active'/);
  assert.match(map, /clusterMarkerIcon\(google, Number\(feature\.getProperty\('count'\)\), Boolean\(feature\.getProperty\('selected'\)\), Boolean\(feature\.getProperty\('active'\)\)\)/);
  assert.match(map, /for \(const cluster of visualClusters\)/);
  assert.match(map, /clusterKey: cluster\.key/);
  assert.match(map, /count: cluster\.count/);
  assert.match(map, /clickable: true/);
  assert.match(map, /title: feature\.getProperty\('title'\)/);
  assert.match(map, /clusterLayer\.addListener\('click'/);
  assert.match(map, /for \(const listener of listeners\) listener\.remove\?\.\(\);/);
  assert.match(map, /trailPoints=\{gpsData\.trailPoints\}/);
  assert.match(map, /locationClusters=\{visualClusters\}/);
  assert.match(map, /role="group" aria-label=\{label\}/);
  assert.match(map, /className=\{`route-map-cluster-marker/);
  assert.match(map, /role="button"/);
  assert.match(map, /tabIndex=\{0\}/);
  assert.match(map, /onKeyDown=\{activate\}/);
  assert.doesNotMatch(map, /preserveAspectRatio="none" aria-hidden="true"/);
  assert.match(map, /recordedPoints\.map\(point => \(\{ lat: point\.latitude, lng: point\.longitude \}\)\)/);
  assert.match(map, /className="gps-fix-tray"/);
  assert.match(map, /className="gps-fix-tray-list"/);
  assert.match(map, /fixSummary: '\{fixes\} GPS fixes · \{locations\} map locations · \{mapped\} of \{jobs\} jobs mapped'/);
  assert.match(map, /jobsWithoutFixCount/);
  assert.match(map, /unlinkedFixCount/);
  assert.match(map, /className="gps-location-detail"/);
  assert.match(map, /className="gps-fix-detail-card"/);
  for (const field of ['activity', 'reportId', 'jobTime', 'fixTime', 'coordinates', 'route', 'status']) {
    assert.match(map, new RegExp(`t\\.${field}`));
  }
  assert.match(map, /className="gps-open-job-button"/);
  assert.match(map, /onOpenJob\?\.\(activeReport\)/);
  assert.match(map, /activeIsSelectedJob \? t\.currentJob : t\.openJob/);
  assert.match(map, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(map, /reportableOperations\.map/);
  assert.match(map, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(map, /t\.savedRoute/);
  assert.match(map, /t\.workPeriod/);
  assert.match(map, /t\.selectedJob/);
  assert.match(map, /t\.deviation/);
});

test('the GPS drawer and route map retain balanced proportions across responsive widths', async () => {
  const styles = await readFile(fileURLToPath(new NodeUrl('../web/app/styles.css', import.meta.url)), 'utf8');

  assertDeclaration(styles, '.gps-drawer', 'width', 'clamp(680px,50vw,820px)');
  assertDeclaration(styles, '.gps-drawer', 'height', '100dvh');
  assertDeclaration(styles, '.gps-drawer', 'grid-template-rows', '60px minmax(0,1fr) 58px');
  assertDeclaration(styles, '.gps-drawer-scroll', 'display', 'flex');
  assertDeclaration(styles, '.gps-route-assignment', 'margin', '10px 18px 0');
  assertDeclaration(styles, '.gps-route-section', 'margin', '0');
  assertDeclaration(styles, '.gps-route-section', 'padding', '10px 18px 12px');
  assertDeclaration(styles, '.gps-route-section', 'flex', 'none');
  assertDeclaration(styles, '.gps-route-missing', 'margin', '0');
  assertDeclaration(styles, '.gps-route-missing', 'padding', '18px');
  assertDeclaration(styles, '.route-map', 'flex', 'none');
  assertDeclaration(styles, '.route-map', 'display', 'block');
  assertDeclaration(styles, '.route-map-body', 'height', 'clamp(220px,28dvh,280px)');
  assertDeclaration(styles, '.route-map-legend', 'flex-wrap', 'wrap');
  assertDeclaration(styles, '.gps-work-period-summary', 'display', 'flex');
  assertDeclaration(styles, '.route-map-control-button', 'height', '34px');
  assertDeclaration(styles, '.route-map-icon-button', 'width', '34px');
  assertDeclaration(styles, '.gps-fix-tray-list', 'grid-template-columns', 'repeat(4,minmax(0,1fr))');
  assertDeclaration(styles, '.gps-fix-tray', 'flex', 'none');
  assertDeclaration(styles, '.gps-fix-tray-button', 'min-height', '44px');
  assertDeclaration(styles, '.gps-fix-detail-card>dl', 'grid-template-columns', 'repeat(4,minmax(0,1fr))');
  assertDeclaration(styles, '.gps-samples-disclosure', 'min-height', '46px');

  const mobileStyles = mediaContents(styles, 'max-width:600px');
  assertDeclaration(mobileStyles, '.gps-route-assignment', 'margin', '9px 14px 0');
  assertDeclaration(mobileStyles, '.gps-route-section', 'padding', '9px 14px 10px');
  assertDeclaration(mobileStyles, '.gps-route-missing', 'padding', '14px');
  assertDeclaration(mobileStyles, '.route-map', 'min-height', '0');
  assertDeclaration(mobileStyles, '.route-map-body', 'height', 'clamp(190px,30dvh,230px)');
  assertDeclaration(mobileStyles, '.route-map-control-label', 'display', 'none');
  assertDeclaration(mobileStyles, '.gps-fix-tray-list', 'grid-template-columns', 'repeat(2,minmax(0,1fr))');
  assertDeclaration(mobileStyles, '.gps-location-stack>li>button', 'min-height', '44px');
  assertDeclaration(mobileStyles, '.gps-fix-detail-card>dl', 'grid-template-columns', 'repeat(2,minmax(0,1fr))');

  const narrowStyles = mediaContents(styles, 'max-width:900px');
  assertDeclaration(narrowStyles, '.gps-drawer', 'width', '100%');
  const drawerWidths = rulesForSelector(styles, '.gps-drawer').filter(rule => rule.width);
  assert.equal(drawerWidths.at(-1)?.width, '100%', 'the final drawer width rule should keep <=900px layouts full-width');
});

test('the route list shows localized loading copy instead of the failure message', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/routes-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /loading \? <p role="status">\{t\.loading\}<\/p>/);
  assert.doesNotMatch(source, /loading \? <p>\{t\.failed\}<\/p>/);
  assert.match(source, /loading: 'Loading routes…'/);
  assert.match(source, /loading: 'กำลังโหลดเส้นทาง…'/);
});
