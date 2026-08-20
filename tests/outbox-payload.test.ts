import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOutboxPayload } from '../lib/outbox-payload.ts';

test('outbox payload parsing accepts JSON objects without changing their stable data', () => {
  assert.deepEqual(parseOutboxPayload<{ id: string }>('{"id":"OPS-1"}'), {
    ok: true,
    value: { id: 'OPS-1' },
  });
});

test('outbox payload parsing quarantines malformed and non-object values', () => {
  assert.deepEqual(parseOutboxPayload('{broken'), {
    ok: false,
    error: 'Stored payload contains invalid JSON.',
  });
  assert.deepEqual(parseOutboxPayload('null'), {
    ok: false,
    error: 'Stored payload is not a JSON object.',
  });
  assert.deepEqual(parseOutboxPayload('[]'), {
    ok: false,
    error: 'Stored payload is not a JSON object.',
  });
});
