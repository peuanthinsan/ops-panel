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

test('the GPS drawer hides route editing by default and stages a job-scoped change before applying it', async () => {
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(drawer, /useState\('job'\)/);
  assert.match(drawer, /useState\(false\);\n\s+const \[draftRouteName/);
  assert.match(drawer, /aria-expanded=\{routeEditorOpen\} aria-controls="route-assignment-editor"/);
  assert.match(drawer, /routeEditorOpen \? <div className="route-assignment-editor"/);
  assert.match(drawer, /onSelect=\{setDraftRouteName\}/);
  assert.match(drawer, /const scope = routeScope;/);
  assert.match(drawer, /t\.workPeriodHint/);
  assert.match(drawer, /t\.thisJob/);
  assert.match(drawer, /onClick=\{assignRoute\}/);
  assert.match(dashboard, /onRouteAssigned=\{\(\) => void loadReports\(\{ silent: true \}\)\}/);
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

test('the GPS drawer and route map retain balanced proportions across responsive widths', async () => {
  const styles = await readFile(fileURLToPath(new NodeUrl('../web/app/styles.css', import.meta.url)), 'utf8');

  assertDeclaration(styles, '.gps-drawer', 'width', 'clamp(680px,50vw,820px)');
  assertDeclaration(styles, '.gps-drawer', 'height', '100dvh');
  assertDeclaration(styles, '.gps-drawer', 'grid-template-rows', '60px minmax(0,1fr) 58px');
  assertDeclaration(styles, '.gps-drawer-scroll', 'display', 'flex');
  assertDeclaration(styles, '.gps-route-assignment', 'margin', '10px 18px 0');
  assertDeclaration(styles, '.gps-route-section', 'margin', '0');
  assertDeclaration(styles, '.gps-route-section', 'padding', '10px 18px 12px');
  assertDeclaration(styles, '.gps-route-section', 'flex', '1 1 360px');
  assertDeclaration(styles, '.gps-route-missing', 'margin', '0');
  assertDeclaration(styles, '.gps-route-missing', 'padding', '18px');
  assertDeclaration(styles, '.route-map', 'flex', '1');
  assertDeclaration(styles, '.route-map-control-button', 'height', '34px');
  assertDeclaration(styles, '.route-map-icon-button', 'width', '34px');
  assertDeclaration(styles, '.gps-samples-disclosure', 'min-height', '46px');

  const mobileStyles = mediaContents(styles, 'max-width:600px');
  assertDeclaration(mobileStyles, '.gps-route-assignment', 'margin', '9px 14px 0');
  assertDeclaration(mobileStyles, '.gps-route-section', 'padding', '9px 14px 10px');
  assertDeclaration(mobileStyles, '.gps-route-missing', 'padding', '14px');
  assertDeclaration(mobileStyles, '.route-map', 'min-height', '210px');
  assertDeclaration(mobileStyles, '.route-map-control-label', 'display', 'none');

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
