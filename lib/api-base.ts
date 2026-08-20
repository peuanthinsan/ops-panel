const ANDROID_EMULATOR_API_BASE = 'http://10.0.2.2:4000';

function normalizeConfiguredUrl(value?: string, development = true) {
  const configured = value?.trim();
  if (!configured) return null;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute http:// or https:// URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute http:// or https:// URL.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('EXPO_PUBLIC_API_URL cannot contain credentials, a query string, or a fragment.');
  }
  if (!development && parsed.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must use https:// for production Android builds.');
  }

  return configured.replace(/\/+$/, '');
}

function hostFromExpoUri(hostUri?: string | null) {
  if (!hostUri?.trim()) return null;
  try {
    const parsed = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`);
    return parsed.hostname.replace(/^\[|\]$/g, '') || null;
  } catch {
    return null;
  }
}

export function resolveApiBase(configuredUrl?: string, expoHostUri?: string | null, development = true) {
  const configured = normalizeConfiguredUrl(configuredUrl, development);
  if (configured) return configured;
  if (!development) {
    throw new Error('EXPO_PUBLIC_API_URL is required for production Android builds.');
  }

  const expoHost = hostFromExpoUri(expoHostUri);
  if (!expoHost) return ANDROID_EMULATOR_API_BASE;

  const androidHost = expoHost === 'localhost' || expoHost === '127.0.0.1' || expoHost === '::1' ? '10.0.2.2' : expoHost;
  const formattedHost = androidHost.includes(':') ? `[${androidHost}]` : androidHost;
  return `http://${formattedHost}:4000`;
}
