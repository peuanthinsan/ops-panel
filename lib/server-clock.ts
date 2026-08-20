let serverClockOffsetMs = 0;

function parseServerTime(value: string | null) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function observeServerTime(
  value: string | null,
  requestStartedAt = Date.now(),
  responseReceivedAt = Date.now(),
) {
  const serverTime = parseServerTime(value);
  if (serverTime === null) return false;
  const midpoint = requestStartedAt + Math.max(0, responseReceivedAt - requestStartedAt) / 2;
  serverClockOffsetMs = serverTime - midpoint;
  return true;
}

export function serverNowMs(localNow = Date.now()) {
  return localNow + serverClockOffsetMs;
}

export function resetServerClockForTests() {
  serverClockOffsetMs = 0;
}
