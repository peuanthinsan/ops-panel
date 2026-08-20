export type ParsedOutboxPayload<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseOutboxPayload<T>(raw: string): ParsedOutboxPayload<T> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Stored payload is not a JSON object.' };
    }
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, error: 'Stored payload contains invalid JSON.' };
  }
}
