import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from '@expo/env';
import {
  isCompatibleSongdeeApiHealth,
  SONGDEE_API_CONTRACT_VERSION,
} from '../lib/api-contract.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function getDevConfiguration(args = [], env = {}) {
  const apiPort = env.PORT || '4000';
  const configuredApiBaseUrl = env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const mode = configuredApiBaseUrl ? 'external' : args.includes('--json') ? 'json' : 'neon';
  return {
    mode,
    apiPort,
    dashboardPort: env.SONGDEE_DASHBOARD_PORT || '5173',
    apiBaseUrl: configuredApiBaseUrl || (mode === 'json' ? `http://localhost:${apiPort}` : null),
  };
}

async function assertPortAvailableOnHost(port, host, label) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        const recovery = label === 'Dashboard'
          ? 'Stop the existing process or run SONGDEE_DASHBOARD_PORT=<another port> bun run dev.'
          : 'Stop the incompatible process or set NEXT_PUBLIC_API_BASE_URL to a working Songdee Ops API.';
        reject(new Error(`${label} port ${port} is already in use. ${recovery}`));
        return;
      }
      if (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL') {
        resolve();
        return;
      }
      reject(error);
    });
    probe.listen({ host, port: Number(port) }, () => probe.close(resolve));
  });
}

async function assertPortAvailable(port, label) {
  await assertPortAvailableOnHost(port, '127.0.0.1', label);
  await assertPortAvailableOnHost(port, '::1', label);
}

async function readSongdeeApiHealth(apiBaseUrl) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return response.ok ? body : null;
  } catch { return null; }
}

async function main() {
  loadProjectEnv(projectRoot, { silent: true });
  const { mode, apiPort, dashboardPort, apiBaseUrl } = getDevConfiguration(process.argv.slice(2), process.env);
  const processes = [];
  await assertPortAvailable(dashboardPort, 'Dashboard');

  if (apiBaseUrl) {
    const apiHealth = await readSongdeeApiHealth(apiBaseUrl);
    if (isCompatibleSongdeeApiHealth(apiHealth)) {
      console.log(`Using the Songdee Fleet Ops API already running at ${apiBaseUrl}`);
    } else if (apiHealth?.service === 'songdee-fleet-ops') {
      throw new Error(`A stale Songdee Ops API is running at ${apiBaseUrl}.\n`
        + `It reports contract ${apiHealth.apiContractVersion || 'none'}; this workspace requires ${SONGDEE_API_CONTRACT_VERSION}.\n`
        + 'Stop that API process, then run this command again so the current server can start.');
    } else if (mode === 'external') {
      throw new Error(`The configured Songdee Ops API is unavailable or incompatible: ${apiBaseUrl}/api/health\n`
        + 'Check NEXT_PUBLIC_API_BASE_URL, the API deployment, and its network access before starting the dashboard.');
    } else {
      await assertPortAvailable(apiPort, 'API');
      processes.push(spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort } }));
    }
  } else {
    console.log('Starting the Next.js dashboard with same-origin API routes (configuration from web/.env.local).');
  }
  const dashboardEnv = { ...process.env };
  if (apiBaseUrl) dashboardEnv.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  else delete dashboardEnv.NEXT_PUBLIC_API_BASE_URL;
  processes.push(spawn(npmCommand, ['--prefix', 'web', 'run', 'dev', '--', '-p', dashboardPort], {
    stdio: 'inherit',
    env: dashboardEnv,
  }));

  let stopping = false;
  function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of processes) {
      if (!child.killed) child.kill('SIGTERM');
    }
    process.exitCode = exitCode;
  }

  for (const child of processes) {
    child.on('error', error => {
      console.error(error.message);
      stop(1);
    });
    child.on('exit', code => {
      if (!stopping) stop(code || 0);
    });
  }

  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}

const launchedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (launchedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
