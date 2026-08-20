import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSqlStatements } from '../web/lib/server/sql-statements.mjs';

test('migration statements split without breaking strings, comments, or dollar blocks', () => {
  const statements = splitSqlStatements(`
    CREATE TABLE example (value text DEFAULT ';');
    -- semicolon ; inside a comment
    DO $$ BEGIN PERFORM 'still; one'; END $$;
    /* outer ; /* nested ; */ comment */
    INSERT INTO example (value) VALUES ('it''s; safe');
  `);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /DO \$\$[\s\S]*END \$\$/);
  assert.match(statements[2], /INSERT INTO example/);
});

test('unterminated migration syntax is rejected before execution', () => {
  assert.throws(() => splitSqlStatements("SELECT 'unfinished;"), /unterminated/);
});
