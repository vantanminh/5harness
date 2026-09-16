export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function publicErrorResponse(
  error: unknown,
): { status: number; code: string; message: string } {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  return {
    status: 500,
    code: "internal_error",
    message: "Internal cloud service error.",
  };
}
