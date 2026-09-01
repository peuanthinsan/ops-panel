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

function hasDeclaration(source, selector, property, value) {
  const normalizedValue = value.replace(/\s+/g, '');
  return rulesForSelector(source, selector).some(rule => rule[property] === normalizedValue);
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

test('the dashboard route assignment selector searches a bounded server result', async () => {
  const selector = await readFile(fileURLToPath(new NodeUrl('../web/app/route-selector.jsx', import.meta.url)), 'utf8');
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  assert.match(selector, /\/api\/admin\/job-route-options\?\$\{params\}/);
  assert.match(selector, /limit: '50'/);
  assert.match(selector, /role="combobox"/);
  assert.match(selector, /role="listbox"/);
  assert.match(drawer, /<RouteSelector/);
  assert.doesNotMatch(drawer, /<select id="gps-route-assignment"/);
});

test('the GPS drawer and route map retain balanced proportions across responsive widths', async () => {
  const styles = await readFile(fileURLToPath(new NodeUrl('../web/app/styles.css', import.meta.url)), 'utf8');

  assertDeclaration(styles, '.gps-drawer', 'width', 'clamp(640px,48vw,760px)');
  assertDeclaration(styles, '.gps-drawer', 'height', '100dvh');
  assertDeclaration(styles, '.gps-route-assignment', 'margin', '14px 22px 0');
  assertDeclaration(styles, '.gps-route-section', 'margin', '0');
  assertDeclaration(styles, '.gps-route-section', 'padding', '16px 22px 18px');
  assertDeclaration(styles, '.gps-route-missing', 'margin', '0');
  assertDeclaration(styles, '.gps-route-missing', 'padding', '16px 22px 18px');
  for (const selector of ['.route-map-canvas', '.route-map-fallback>svg']) {
    assertDeclaration(styles, selector, 'height', 'clamp(230px,28dvh,280px)');
  }

  const mobileStyles = mediaContents(styles, 'max-width:600px');
  assertDeclaration(mobileStyles, '.gps-route-assignment', 'margin', '12px 14px 0');
  for (const selector of ['.gps-route-section', '.gps-route-missing']) {
    assert.ok(
      hasDeclaration(mobileStyles, selector, 'padding-inline', '14px')
        || hasDeclaration(mobileStyles, selector, 'padding', '14px 14px 16px'),
      `${selector} should retain 14px mobile inline gutters`,
    );
  }
  for (const selector of ['.route-map-canvas', '.route-map-fallback>svg']) {
    assertDeclaration(mobileStyles, selector, 'height', 'clamp(210px,36dvh,250px)');
  }

  const narrowStyles = mediaContents(styles, 'max-width:900px');
  assertDeclaration(narrowStyles, '.gps-drawer', 'width', '100%');
  const drawerWidths = rulesForSelector(styles, '.gps-drawer').filter(rule => rule.width);
  assert.equal(drawerWidths.at(-1)?.width, '100%', 'the final drawer width rule should keep <=900px layouts full-width');
});
