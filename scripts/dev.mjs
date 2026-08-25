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
loadProjectEnv(projectRoot, { silent: true });

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apiPort = process.env.PORT || '4000';
const dashboardPort = process.env.SONGDEE_DASHBOARD_PORT || '5173';
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const apiBaseUrl = configuredApiBaseUrl || `http://localhost:${apiPort}`;
const processes = [];

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

async function readSongdeeApiHealth() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return response.ok ? body : null;
  } catch { return null; }
}

try {
  await assertPortAvailable(dashboardPort, 'Dashboard');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const apiHealth = await readSongdeeApiHealth();
if (isCompatibleSongdeeApiHealth(apiHealth)) {
  console.log(`Using the Songdee Fleet Ops API already running at ${apiBaseUrl}`);
} else if (apiHealth?.service === 'songdee-fleet-ops') {
  console.error(`A stale Songdee Ops API is running at ${apiBaseUrl}.`);
  console.error(`It reports contract ${apiHealth.apiContractVersion || 'none'}; this workspace requires ${SONGDEE_API_CONTRACT_VERSION}.`);
  console.error('Stop that API process, then run this command again so the current server can start.');
  process.exit(1);
} else if (configuredApiBaseUrl) {
  console.error(`The configured Songdee Ops API is unavailable or incompatible: ${apiBaseUrl}/api/health`);
  console.error('Check NEXT_PUBLIC_API_BASE_URL, the API deployment, and its network access before starting the dashboard.');
  process.exit(1);
} else {
  try {
    await assertPortAvailable(apiPort, 'API');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  processes.push(spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort } }));
}
processes.push(spawn(npmCommand, ['--prefix', 'web', 'run', 'dev', '--', '-p', dashboardPort], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: apiBaseUrl },
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
