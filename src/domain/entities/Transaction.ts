import { DomainError } from "../DomainError.js";
import { Iban } from "../value-objects/Iban.js";
import { LocalDate } from "../value-objects/LocalDate.js";
import { Money } from "../value-objects/Money.js";
import { TransactionId } from "../value-objects/TransactionId.js";

const MAX_REFERENCE_LENGTH = 140;
const MAX_NAME_LENGTH = 140;

interface CreateTransactionProps {
  id: TransactionId;
  bookingDate: LocalDate;
  /** Positive amount of an outgoing payment (debit) to a beneficiary. */
  amount: Money;
  beneficiaryName: string;
  beneficiaryIban: Iban;
  /** Free-text payment reference from the bank statement. May be empty. */
  reference: string;
}

/**
 * A bank transaction as imported from a statement.
 * Only outgoing payments are modelled: the amount is always positive.
 */
export class Transaction {
  private constructor(
    public readonly id: TransactionId,
    public readonly bookingDate: LocalDate,
    public readonly amount: Money,
    public readonly beneficiaryName: string,
    public readonly beneficiaryIban: Iban,
    public readonly reference: string,
    public readonly normalizedReference: string,
  ) {
    Object.freeze(this);
  }

  public static create(props: CreateTransactionProps): Transaction {
    if (!props.amount.isPositive()) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        "Transaction amount must be positive (only outgoing payments are supported).",
      );
    }

    const beneficiaryName = props.beneficiaryName
      .trim()
      .replace(/\s+/g, " ");

    if (!beneficiaryName) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        "Beneficiary name cannot be empty.",
      );
    }

    if (beneficiaryName.length > MAX_NAME_LENGTH) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        `Beneficiary name exceeds ${MAX_NAME_LENGTH} characters.`,
      );
    }

    const reference = props.reference
      .trim()
      .replace(/\s+/g, " ");

    if (reference.length > MAX_REFERENCE_LENGTH) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        `Payment reference exceeds ${MAX_REFERENCE_LENGTH} characters.`,
      );
    }

    return new Transaction(
      props.id,
      props.bookingDate,
      props.amount,
      beneficiaryName,
      props.beneficiaryIban,
      reference,
      reference.toUpperCase(),
    );
  }

  public equals(other: Transaction): boolean {
    return this.id.equals(other.id);
  }
}
