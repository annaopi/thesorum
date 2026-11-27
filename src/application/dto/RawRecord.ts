/**
 * One untrusted input row (e.g. a CSV line) before validation.
 * Field values are raw strings keyed by column name.
 */
export interface RawRecord {
  /** 1-based data row number (header excluded), used in error messages. */
  readonly rowNumber: number;
  readonly fields: Readonly<Record<string, string>>;
}
