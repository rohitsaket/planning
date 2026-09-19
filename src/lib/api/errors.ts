// Central error contract: { error: { code, message, requestId } }
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
export const forbidden = (message = "You do not have permission to perform this action.") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooLarge = (message: string) => new ApiError(413, "PAYLOAD_TOO_LARGE", message);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later.", { retryAfterSeconds });
