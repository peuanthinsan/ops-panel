import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeDurableActiveJob } from '../lib/active-job-finalization.ts';

test('finalization removes the active job when secure storage is healthy', async () => {
  let removed = 0;
  let marked = 0;
  const finalized = await finalizeDurableActiveJob(
    async () => { removed += 1; },
    async () => { marked += 1; },
  );
  assert.equal(finalized, true);
  assert.equal(removed, 1);
  assert.equal(marked, 0);
});

test('a closed marker prevents restoration when deletion fails', async () => {
  let marked = 0;
  const finalized = await finalizeDurableActiveJob(
    async () => { throw new Error('delete failed'); },
    async () => { marked += 1; },
  );
  assert.equal(finalized, true);
  assert.equal(marked, 1);
});

test('finalization reports a storage failure only when both strategies fail', async () => {
  const finalized = await finalizeDurableActiveJob(
    async () => { throw new Error('delete failed'); },
    async () => { throw new Error('marker failed'); },
  );
  assert.equal(finalized, false);
});
