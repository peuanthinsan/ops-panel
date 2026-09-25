const unavailableTelemetry = () => ({ status: 'unavailable', samples: [], source: 'data-fm', fuelUnit: null });

// One queue serves every mounted consumer, including the jobs list and timeline.
export function createReportTelemetryLoader(fetchTelemetry, {
  concurrency = 2,
  cacheLifetimeMs = 60_000,
  maxCacheEntries = 100,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let running = 0;

  function peek(key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const entry = queue.shift();
      if (!entry.consumers || entry.controller.signal.aborted) {
        if (pending.get(entry.request.key) === entry) pending.delete(entry.request.key);
        entry.resolve(unavailableTelemetry());
        continue;
      }
      entry.started = true;
      running++;
      void Promise.resolve().then(() => fetchTelemetry(entry.request.id, { signal: entry.controller.signal }))
        .then(data => {
          if (!Array.isArray(data?.samples)) return unavailableTelemetry();
          if (!entry.controller.signal.aborted && data.status === 'received') {
            cache.delete(entry.request.key);
            cache.set(entry.request.key, { data, expiresAt: now() + cacheLifetimeMs });
            while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
          }
          return data;
        })
        .catch(() => unavailableTelemetry())
        .then(data => {
          running--;
          if (pending.get(entry.request.key) === entry) pending.delete(entry.request.key);
          entry.resolve(data);
          pump();
        });
    }
  }

  function subscribe(request) {
    const cached = peek(request.key);
    if (cached) return { promise: Promise.resolve(cached), release() {} };
    let entry = pending.get(request.key);
    if (!entry) {
      entry = { request, controller: new AbortController(), consumers: 0, started: false };
      entry.promise = new Promise(resolve => { entry.resolve = resolve; });
      pending.set(request.key, entry);
      queue.push(entry);
      queueMicrotask(pump);
    }
    entry.consumers++;
    let released = false;
    return {
      promise: entry.promise,
      release() {
        if (released) return;
        released = true;
        entry.consumers--;
        if (entry.consumers) return;
        // An immediate remount can reclaim the same request before cancellation.
        queueMicrotask(() => {
          if (entry.consumers || pending.get(request.key) !== entry) return;
          pending.delete(request.key);
          entry.controller.abort();
          if (!entry.started) {
            const index = queue.indexOf(entry);
            if (index !== -1) queue.splice(index, 1);
            entry.resolve(unavailableTelemetry());
          }
        });
      },
    };
  }

  return { peek, subscribe };
}
