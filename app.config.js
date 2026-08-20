function validatePublicApiUrl(value, productionBuild = false) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute http:// or https:// URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute http:// or https:// URL.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('EXPO_PUBLIC_API_URL cannot contain credentials, a query string, or a fragment.');
  }
  if (productionBuild && parsed.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must use https:// for Android release builds.');
  }
}

export default ({ config }) => {
  const publicApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (publicApiUrl) validatePublicApiUrl(publicApiUrl, process.env.EAS_BUILD === 'true');
  if (process.env.EAS_BUILD === 'true' && !publicApiUrl) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is required for Android release builds. Configure it in the EAS preview and production environments.',
    );
  }

  return config;
};
