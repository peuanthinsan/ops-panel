import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from '@expo/env';
import {
  isCompatibleSongdeeApiHealth,
  SONGDEE_API_CONTRACT_VERSION,
} from '../lib/api-contract.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadProjectEnv(projectRoot, { silent: true });

const expoGoPackage = 'host.exp.exponent';

export function normalizePort(value, fallback, label) {
  const raw = value == null || String(value).trim() === '' ? String(fallback) : String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} port must be a whole number between 1 and 65535.`);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} port must be a whole number between 1 and 65535.`);
  }
  return port;
}

export function parseConnectedEmulators(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .filter(parts => /^emulator-\d+$/.test(parts[0] || '') && parts[1] === 'device')
    .map(parts => parts[0]);
}

function commandWorks(command) {
  const result = spawnSync(command, ['version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function findAdb() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const pathCandidates = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(directory => path.join(directory, executable));
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  const candidates = [
    ...pathCandidates,
    ...sdkRoots.map(root => path.join(root, 'platform-tools', executable)),
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', executable),
    executable,
  ];
  for (const candidate of [...new Set(candidates)]) {
    if ((candidate === executable || fs.existsSync(candidate)) && commandWorks(candidate)) return candidate;
  }
  throw new Error('Android Debug Bridge (adb) was not found. Install Android platform-tools or set ANDROID_HOME.');
}

function runAdb(adb, serial, args, capture = false) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture ? String(result.stderr || '').trim() : '';
    throw new Error(`adb ${args.join(' ')} failed${details ? `: ${details}` : '.'}`);
  }
  return capture ? String(result.stdout || '') : '';
}

function connectedEmulator(adb) {
  const result = spawnSync(adb, ['devices', '-l'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || 'adb devices failed').trim());
  const emulators = parseConnectedEmulators(result.stdout);
  if (!emulators.length) {
    throw new Error('No running Android emulator was found. Start one in Android Studio, or use `npm run start` for a physical tablet.');
  }
  if (emulators.length > 1) console.warn(`Multiple emulators are connected; using ${emulators[0]}.`);
  return emulators[0];
}

function portIsAvailable(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port }, () => probe.close(() => resolve(true)));
  });
}

async function availableMetroPort(preferred) {
  for (let port = preferred; port <= Math.min(65535, preferred + 20); port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No free Metro port was found from ${preferred} through ${Math.min(65535, preferred + 20)}.`);
}

function normalizeHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute http:// or https:// URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${label} must be an absolute http:// or https:// URL.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} cannot contain credentials, a query string, or a fragment.`);
  }
  return parsed;
}

function apiConnection(apiPort) {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  const parsed = normalizeHttpUrl(configured || `http://127.0.0.1:${apiPort}`, 'EXPO_PUBLIC_API_URL');
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2']);
  const isLocalHttp = parsed.protocol === 'http:' && localHosts.has(parsed.hostname);
  if (!isLocalHttp) {
    return { deviceUrl: parsed.toString().replace(/\/+$/, ''), healthUrl: parsed.toString().replace(/\/+$/, ''), reversePort: null };
  }

  const resolvedPort = normalizePort(parsed.port || '80', apiPort, 'API');
  parsed.hostname = '127.0.0.1';
  parsed.port = String(resolvedPort);
  const localUrl = parsed.toString().replace(/\/+$/, '');
  return { deviceUrl: localUrl, healthUrl: localUrl, reversePort: resolvedPort };
}

async function assertCurrentApi(apiBaseUrl) {
  const healthUrl = `${apiBaseUrl.replace(/\/+$/, '')}/api/health`;
  let response;
  let body;
  try {
    response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    body = await response.json();
  } catch {
    throw new Error(`The Songdee Ops API is not reachable at ${healthUrl}. Run \`bun run dev\` first.`);
  }
  if (response.ok && isCompatibleSongdeeApiHealth(body)) return;
  if (body?.service === 'songdee-fleet-ops') {
    throw new Error(
      `A stale Songdee Ops API is running at ${apiBaseUrl}. It reports contract ${body.apiContractVersion || 'none'}; `
      + `this workspace requires ${SONGDEE_API_CONTRACT_VERSION}. Restart \`bun run dev\` before launching Android.`,
    );
  }
  throw new Error(`The service at ${healthUrl} is not the current Songdee Ops API.`);
}

async function main() {
  const preferredMetroPort = normalizePort(process.env.SONGDEE_METRO_PORT, 8081, 'Metro');
  const defaultApiPort = normalizePort(process.env.SONGDEE_API_PORT, 4000, 'API');
  const adb = findAdb();
  const serial = connectedEmulator(adb);
  const metroPort = await availableMetroPort(preferredMetroPort);
  const api = apiConnection(defaultApiPort);

  await assertCurrentApi(api.healthUrl);
  runAdb(adb, serial, ['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`], true);
  if (api.reversePort) runAdb(adb, serial, ['reverse', `tcp:${api.reversePort}`, `tcp:${api.reversePort}`], true);

  // Stop only Expo Go. This drops stale tasks and bundles without clearing the
  // device's persisted Songdee binding, active job, or durable outboxes.
  runAdb(adb, serial, ['shell', 'am', 'force-stop', expoGoPackage]);

  console.log(`Launching Songdee Ops on ${serial}`);
  console.log(`Metro: http://127.0.0.1:${metroPort}`);
  console.log(`API inside Android: ${api.deviceUrl}`);

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npx, ['expo', 'start', '--android', '--localhost', '--clear', '--port', String(metroPort)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ANDROID_SERIAL: serial,
      EXPO_PUBLIC_API_URL: api.deviceUrl,
      PATH: `${path.dirname(adb)}${path.delimiter}${process.env.PATH || ''}`,
    },
  });

  const forward = signal => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
      resolve();
    });
  });
}

const launchedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (launchedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
