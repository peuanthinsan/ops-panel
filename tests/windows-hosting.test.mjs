import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import test from 'node:test';
import vm from 'node:vm';

const requireWeb = createRequire(new URL('../web/package.json', import.meta.url));
const pg = requireWeb('pg');
const { localPostgres } = await import('../web/lib/server/local-postgres.mjs');

function fakeDatabase(t, failAt) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text === failAt) throw new Error('simulated database failure');
      return { rows: [{ text }], command: text === 'COMMIT' ? 'COMMIT' : 'SELECT' };
    },
    release() { calls.push(['release']); },
  };
  const originalPool = pg.Pool;
  t.after(() => { pg.Pool = originalPool; });
  pg.Pool = class {
    constructor(options) { calls.push(['options', options]); }
    on() {}
    query(...args) { return client.query(...args); }
    async connect() { calls.push(['connect']); return client; }
    async end() { calls.push(['end']); }
  };
  return { sql: localPostgres('postgresql://dummy:dummy@127.0.0.1:54329/build_only'), calls };
}

test('local SQL preserves parameters and executes an awaited query only once', async t => {
  const { sql, calls } = fakeDatabase(t);
  const payload = "'; DROP TABLE users; --";
  const query = sql`SELECT ${payload} AS value, ${42} AS number`;
  assert.equal(calls.length, 1);
  await query;
  await query;
  assert.deepEqual(calls[1], ['SELECT $1 AS value, $2 AS number', [payload, 42]]);
  assert.equal(calls.length, 2);
  await sql.close();
});

test('local transaction commits all queries on one connection with requested isolation', async t => {
  const { sql, calls } = fakeDatabase(t);
  const result = await sql.transaction(tx => [tx`SELECT ${1}`, tx.query('SELECT $1', [2])], {
    isolationLevel: 'RepeatableRead', readOnly: true,
  });
  assert.equal(result.length, 2);
  assert.deepEqual(calls.slice(1), [
    ['connect'], ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', undefined],
    ['SELECT $1', [1]], ['SELECT $1', [2]], ['COMMIT', undefined], ['release'],
  ]);
});

test('local transaction rolls back and releases its connection after a query failure', async t => {
  const { sql, calls } = fakeDatabase(t, 'BROKEN');
  await assert.rejects(sql.transaction([sql.query('BROKEN')]), /simulated database failure/);
  assert.deepEqual(calls.slice(-2), [['ROLLBACK', undefined], ['release']]);
  assert.equal(calls.some(([text]) => text === 'COMMIT'), false);
});

test('local adapter refuses remote hosts, executed transaction queries and unsafe isolation', async t => {
  assert.throws(() => localPostgres('postgresql://dummy:dummy@example.com/db'), /loopback/);
  const { sql } = fakeDatabase(t);
  const query = sql`SELECT ${1}`;
  await query;
  await assert.rejects(sql.transaction([query]), /unexecuted queries/);
  await assert.rejects(sql.transaction([sql`SELECT 1`], { isolationLevel: 'COMMIT; DROP TABLE users' }), /Unsupported isolation/);
});

async function loadProxy(flag) {
  const context = vm.createContext({ Headers, Response, URL, process: { env: { SONGDEE_WINDOWS_HOSTING: flag } } });
  const module = new vm.SourceTextModule(await readFile(new URL('../web/proxy.js', import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const exports = specifier === 'node:net' ? { isIP } : { NextResponse: { next: options => ({ next: true, ...options }) } };
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace.proxy;
}
const request = headers => ({ headers: new Headers(headers), nextUrl: new URL('http://127.0.0.1:18082/admin') });

test('cloud proxy is unchanged unless Windows flag equals 1', async () => {
  for (const flag of [undefined, '0', 'true']) {
    const proxy = await loadProxy(flag);
    assert.equal(proxy(request({ host: 'api2.songdeegps.com' })).next, true);
  }
});

test('Windows proxy blocks API2 host and rejects malformed authorities', async () => {
  const proxy = await loadProxy('1');
  for (const host of ['api2.songdeegps.com', 'API2.SONGDEEGPS.COM.:8082']) {
    assert.equal(proxy(request({ host })).status, 404);
  }
  for (const host of ['[invalid', 'user@ops.example.com', 'ops.example.com/path']) {
    assert.equal(proxy(request({ host })).status, 400);
  }
});

test('Windows rate limiting uses only the proxy-appended valid client IP', async () => {
  const proxy = await loadProxy('1');
  const result = proxy(request({ host: 'ops.example.com', 'x-forwarded-for': '192.0.2.99, 198.51.100.7', 'x-real-ip': '192.0.2.99' }));
  assert.equal(result.request.headers.get('x-forwarded-for'), '198.51.100.7');
  assert.equal(result.request.headers.get('x-real-ip'), '198.51.100.7');
  for (const value of ['', '192.0.2.99, garbage']) {
    const invalid = proxy(request({ host: 'ops.example.com', 'x-forwarded-for': value }));
    assert.equal(invalid.request.headers.get('x-forwarded-for'), 'unknown');
  }
});

test('standalone Next output is opt-in and cloud rewrites remain configured', async () => {
  const previous = process.env.SONGDEE_WINDOWS_HOSTING;
  const api = process.env.SONGDEE_API_URL;
  try {
    delete process.env.SONGDEE_WINDOWS_HOSTING;
    process.env.SONGDEE_API_URL = 'https://api.example.com/';
    const cloud = (await import('../web/next.config.mjs?cloud-test')).default;
    assert.equal(cloud.output, undefined);
    assert.deepEqual(await cloud.rewrites(), [{ source: '/api/:path*', destination: 'https://api.example.com/api/:path*' }]);
    process.env.SONGDEE_WINDOWS_HOSTING = '1';
    const windows = (await import('../web/next.config.mjs?windows-test')).default;
    assert.equal(windows.output, 'standalone');
  } finally {
    if (previous === undefined) delete process.env.SONGDEE_WINDOWS_HOSTING; else process.env.SONGDEE_WINDOWS_HOSTING = previous;
    if (api === undefined) delete process.env.SONGDEE_API_URL; else process.env.SONGDEE_API_URL = api;
  }
});
