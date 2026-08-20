export class SongdeeApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'SongdeeApiError';
    this.status = status;
    this.code = code;
    this.retryable = code === 'DEVICE_CLOCK_SKEW' || status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export function isDeviceAccessError(error: unknown) {
  return error instanceof SongdeeApiError && error.status === 401
    && ['DEVICE_AUTH_REQUIRED', 'DEVICE_CREDENTIAL_INVALID', 'DEVICE_ACCESS_RESET_REQUIRED'].includes(error.code || '');
}

export function isRetryableApiError(error: unknown) {
  return !(error instanceof SongdeeApiError) || error.retryable;
}
