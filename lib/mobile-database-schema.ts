export const retryColumns = [
  ['retry_disabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['failed_at', 'INTEGER'],
  ['last_error', 'TEXT'],
] as const;

export function missingRetryColumns(existingColumns: Iterable<string>) {
  const existing = new Set(existingColumns);
  return retryColumns.filter(([name]) => !existing.has(name));
}
