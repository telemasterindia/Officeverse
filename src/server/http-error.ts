/**
 * Officeverse — transport-agnostic HTTP error.
 *
 * Kept in its own dependency-free module so pure authorization predicates can
 * throw it without pulling in the request/session runtime (keeps unit tests
 * fast and isolated).
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
