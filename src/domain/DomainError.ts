export type DomainErrorCode =
  | "UNKNOWN_CURRENCY"
  | "INVALID_MONEY"
  | "CURRENCY_MISMATCH"
  | "INVALID_IBAN"
  | "INVALID_DATE"
  | "INVALID_INVOICE"
  | "INVALID_TRANSACTION"
  | "INVALID_PAYMENT"
  | "INVALID_RECONCILIATION";

export class DomainError extends Error {
  public constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
