import { DomainError } from "../DomainError.js";

const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,64}$/;

export class TransactionId {
  private constructor(
    public readonly value: string,
  ) {
    Object.freeze(this);
  }

  public static create(input: string): TransactionId {
    if (typeof input !== "string") {
      throw new DomainError(
        "INVALID_TRANSACTION",
        "Transaction ID must be a string.",
      );
    }

    const normalized = input.trim();

    if (!normalized) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        "Transaction ID cannot be empty.",
      );
    }

    if (!TRANSACTION_ID_PATTERN.test(normalized)) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        "Transaction ID may only contain letters, digits and . _ : / - (max 64 characters).",
      );
    }

    return new TransactionId(normalized);
  }

  public equals(other: TransactionId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}
