/** Raised when an input source cannot be read or has an unusable structure. */
export class ImportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}
