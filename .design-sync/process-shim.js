// Browser shim for the design-sync bundle: Next.js client modules (pulled in via
// next/navigation) read process.env.* at module scope. The bundle runs as a plain
// IIFE with no Node globals, so give it an empty env before anything evaluates.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} };
} else if (!globalThis.process.env) {
  globalThis.process.env = {};
}
