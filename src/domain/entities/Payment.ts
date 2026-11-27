import { DomainError } from "../DomainError.js";
import { Money } from "../value-objects/Money.js";
import { TransactionId } from "../value-objects/TransactionId.js";

interface CreatePaymentProps {
  transactionId: TransactionId;
  invoiceId: string;
  amount: Money;
}

/**
 * The part of a bank transaction that has been allocated to an invoice.
 * One transaction yields at most one payment; one invoice may have many.
 * A payment is a deterministic bookkeeping record, never a payment instruction.
 */
export class Payment {
  private constructor(
    public readonly transactionId: TransactionId,
    public readonly invoiceId: string,
    public readonly amount: Money,
  ) {
    Object.freeze(this);
  }

  public static create(props: CreatePaymentProps): Payment {
    const invoiceId = props.invoiceId.trim();

    if (!invoiceId) {
      throw new DomainError(
        "INVALID_PAYMENT",
        "Payment must reference an invoice ID.",
      );
    }

    if (!props.amount.isPositive()) {
      throw new DomainError(
        "INVALID_PAYMENT",
        "Allocated payment amount must be positive.",
      );
    }

    return new Payment(props.transactionId, invoiceId, props.amount);
  }
}
