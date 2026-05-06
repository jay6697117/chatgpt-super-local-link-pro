export type ErrorCode =
  | 'CONFIG_ERROR'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'PATH_OUTSIDE_ROOTS'
  | 'PATH_BLOCKED'
  | 'PATH_NOT_FOUND'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'BINARY_FILE'
  | 'READ_LIMIT_EXCEEDED'
  | 'WRITE_DISABLED'
  | 'OVERWRITE_DISABLED'
  | 'WRITE_LIMIT_EXCEEDED'
  | 'REPLACE_TEXT_NOT_FOUND'
  | 'TOO_MANY_REPLACEMENTS'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toSafeError(error: unknown): { code: string; message: string; status: number; details?: Record<string, unknown> } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status, details: error.details };
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: error.message, status: 500 };
  }
  return { code: 'INTERNAL_ERROR', message: 'Unknown error', status: 500 };
}
