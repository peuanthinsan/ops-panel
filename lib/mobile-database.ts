import * as SQLite from 'expo-sqlite';
import { missingRetryColumns } from './mobile-database-schema';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

const outboxTables = ['pending_gps_samples', 'pending_job_reports', 'pending_job_starts'] as const;

async function ensureRetryColumns(database: SQLite.SQLiteDatabase) {
  for (const table of outboxTables) {
    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    for (const [name, definition] of missingRetryColumns(columns.map(column => column.name))) {
      await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
    }
  }
  await database.execAsync('PRAGMA user_version = 1;');
}

export async function getMobileDatabase() {
  if (!databasePromise) {
    const opening = SQLite.openDatabaseAsync('songdee-ops.db').then(async database => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS pending_gps_samples (
          id TEXT PRIMARY KEY NOT NULL,
          captured_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          retry_disabled INTEGER NOT NULL DEFAULT 0,
          failed_at INTEGER,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_gps_samples_captured_at_idx
          ON pending_gps_samples (captured_at ASC);
        CREATE TABLE IF NOT EXISTS pending_job_reports (
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          retry_disabled INTEGER NOT NULL DEFAULT 0,
          failed_at INTEGER,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_job_reports_created_at_idx
          ON pending_job_reports (created_at ASC);
        CREATE TABLE IF NOT EXISTS pending_job_starts (
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          retry_disabled INTEGER NOT NULL DEFAULT 0,
          failed_at INTEGER,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_job_starts_created_at_idx
          ON pending_job_starts (created_at ASC);
      `);
      await database.withTransactionAsync(() => ensureRetryColumns(database));
      return database;
    });
    databasePromise = opening.catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}
