export function parseHttpAdapterUrl(value, { allowHttp = true } = {}) {
  const configured = String(value || '').trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === 'https:') return url;
    return allowHttp && url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
