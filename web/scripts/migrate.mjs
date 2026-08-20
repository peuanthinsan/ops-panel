import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { splitSqlStatements } from '../lib/server/sql-statements.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(scriptDirectory, '../../db/migrations');
const connectionString = process.env.DATABASE_URL;
const checkOnly = process.argv.includes('--check');

if (!connectionString) throw new Error('DATABASE_URL is required.');
const sql = neon(connectionString);
const [migrationTable] = await sql`SELECT to_regclass('public.schema_migrations')::text AS name`;
if (!migrationTable?.name && !checkOnly) {
  await sql`
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

const files = (await readdir(migrationsDirectory)).filter(file => file.endsWith('.sql')).sort();
const appliedRows = migrationTable?.name || !checkOnly
  ? await sql`SELECT migration_id AS "migrationId", checksum FROM schema_migrations`
  : [];
const applied = new Map(appliedRows.map(row => [row.migrationId, row.checksum]));
const pending = [];

for (const file of files) {
  const migrationId = file.replace(/\.sql$/, '');
  const migrationSql = await readFile(path.join(migrationsDirectory, file), 'utf8');
  const checksum = crypto.createHash('sha256').update(migrationSql).digest('hex');
  const existingChecksum = applied.get(migrationId);
  if (existingChecksum && existingChecksum !== checksum) {
    throw new Error(`Migration ${migrationId} was modified after it was applied.`);
  }
  if (!existingChecksum) pending.push({ migrationId, migrationSql, checksum });
}

if (checkOnly) {
  if (pending.length) {
    console.error(`Pending migrations: ${pending.map(item => item.migrationId).join(', ')}`);
    process.exitCode = 2;
  } else {
    console.info('Database migrations are current.');
  }
} else {
  for (const migration of pending) {
    const statements = splitSqlStatements(migration.migrationSql);
    await sql.transaction(transaction => [
      ...statements.map(statement => transaction.query(statement)),
      transaction`
        INSERT INTO schema_migrations (migration_id, checksum)
        VALUES (${migration.migrationId}, ${migration.checksum})
      `,
    ]);
    console.info(`Applied ${migration.migrationId}`);
  }
  if (!pending.length) console.info('Database migrations are current.');
}
