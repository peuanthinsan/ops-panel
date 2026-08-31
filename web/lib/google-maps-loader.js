import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

const loaderState = globalThis.__songdeeGoogleMapsLoaderState || {
  configured: false,
  language: null,
  mapsPromise: null,
  routeCache: new Map(),
};
globalThis.__songdeeGoogleMapsLoaderState = loaderState;

function normalizeLanguage(language) {
  return language === 'th' ? 'th' : 'en';
}

function pointLiteral(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { lat: latitude, lng: longitude }
    : null;
}

function routeCacheKey(points, language) {
  return `${language}:${points.map(point => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join('|')}`;
}

function computedPath(route) {
  return route.path.map(point => ({
    latitude: Number(typeof point.lat === 'function' ? point.lat() : point.lat),
    longitude: Number(typeof point.lng === 'function' ? point.lng() : point.lng),
  }));
}

async function computeRoutesPath(points, language) {
  const { Route } = await importLibrary('routes');
  const result = await Route.computeRoutes({
    origin: points[0],
    destination: points.at(-1),
    intermediates: points.slice(1, -1).map(location => ({ location, via: true })),
    travelMode: 'DRIVING',
    polylineQuality: 'HIGH_QUALITY',
    language,
    region: 'TH',
    fields: ['path', 'viewport'],
  });
  const route = result.routes?.[0];
  if (!route?.path?.length) throw new Error('Google Maps did not return a driving route.');
  return { path: computedPath(route), viewport: route.viewport || null, source: 'routes' };
}

function computeDirectionsPath(google, points) {
  const service = new google.maps.DirectionsService();
  return new Promise((resolve, reject) => {
    service.route({
      origin: points[0],
      destination: points.at(-1),
      waypoints: points.slice(1, -1).map(location => ({ location, stopover: false })),
      travelMode: google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: false,
    }, (result, status) => {
      const route = result?.routes?.[0];
      if (status !== google.maps.DirectionsStatus.OK || !route) {
        reject(new Error(`Google Maps directions failed: ${status || 'UNKNOWN'}`));
        return;
      }
      const path = route.legs.flatMap(leg => leg.steps.flatMap(step => step.path || []));
      if (!path.length) {
        reject(new Error('Google Maps directions did not return a path.'));
        return;
      }
      resolve({ path: computedPath({ path }), viewport: route.bounds || null, source: 'directions' });
    });
  });
}

/** Load the same browser-restricted Google Maps integration used by Songdee Spark. */
export function loadGoogleMaps(language = 'en') {
  const requestedLanguage = normalizeLanguage(language);
  if (loaderState.mapsPromise) return loaderState.mapsPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    loaderState.mapsPromise = Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured.'));
    loaderState.mapsPromise.catch(() => {});
    return loaderState.mapsPromise;
  }

  if (!loaderState.configured) {
    setOptions({ key, v: 'weekly', language: requestedLanguage, region: 'TH' });
    loaderState.configured = true;
    loaderState.language = requestedLanguage;
  }
  loaderState.mapsPromise = importLibrary('maps').then(() => window.google);
  loaderState.mapsPromise.catch(() => {});
  return loaderState.mapsPromise;
}

/** Compute the road-following driving path represented by the saved Google Maps waypoints. */
export async function computeGoogleDrivingRoute(anchors = [], language = 'en') {
  const points = anchors.map(pointLiteral).filter(Boolean);
  if (points.length < 2) throw new Error('At least two route points are required.');

  const requestedLanguage = normalizeLanguage(language);
  const key = routeCacheKey(points, requestedLanguage);
  if (loaderState.routeCache.has(key)) return loaderState.routeCache.get(key);

  const pending = (async () => {
    const google = await loadGoogleMaps(requestedLanguage);
    try {
      return await computeRoutesPath(points, requestedLanguage);
    } catch (routesError) {
      try {
        return await computeDirectionsPath(google, points);
      } catch (directionsError) {
        throw new AggregateError([routesError, directionsError], 'Google Maps could not calculate the driving route.');
      }
    }
  })();

  loaderState.routeCache.set(key, pending);
  pending.catch(() => loaderState.routeCache.delete(key));
  return pending;
}
