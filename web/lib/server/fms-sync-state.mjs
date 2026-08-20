export function fmsSyncNeedsRetry(status) {
  return status !== 'received' && status !== 'not_configured';
}
