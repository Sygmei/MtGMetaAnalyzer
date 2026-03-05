export interface AppErrorOptions {
  userFacingError: string;
  adminFacingError: string;
  errorTypeName: string;
  httpStatusCode: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly userFacingError: string;
  readonly adminFacingError: string;
  readonly errorTypeName: string;
  readonly httpStatusCode: number;

  constructor(options: AppErrorOptions) {
    super(options.adminFacingError);
    this.name = options.errorTypeName;
    this.userFacingError = options.userFacingError;
    this.adminFacingError = options.adminFacingError;
    this.errorTypeName = options.errorTypeName;
    this.httpStatusCode = options.httpStatusCode;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }

  toTraceAttributes(): Record<string, string | number> {
    return {
      'error.type_name': this.errorTypeName,
      'error.http_status_code': this.httpStatusCode,
      'error.user_facing': this.userFacingError,
      'error.admin_facing': this.adminFacingError
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
