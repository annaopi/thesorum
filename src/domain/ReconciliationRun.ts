import { DomainError } from "./DomainError.js";
import type { Invoice } from "./entities/Invoice.js";
import type { Payment } from "./entities/Payment.js";
import type { Transaction } from "./entities/Transaction.js";
import type {
  DuplicateInvoiceGroup,
  DuplicateTransactionGroup,
  InvoiceSettlement,
  MatchDecision,
} from "./ReconciliationResult.js";
import type { LocalDate } from "./value-objects/LocalDate.js";
import type { MatchingOutcome } from "./services/MatchingService.js";

interface CreateRunProps {
  id: string;
  asOf: LocalDate;
  invoices: readonly Invoice[];
  transactions: readonly Transaction[];
  outcome: MatchingOutcome;
}

/**
 * Immutable aggregate holding one complete reconciliation: the inputs and every
 * deterministic result, with invariants checked on creation so downstream code
 * (anomaly detection, reporting, AI agents) can rely on them.
 */
export class ReconciliationRun {
  private readonly decisionsByTransaction: ReadonlyMap<string, MatchDecision>;
  private readonly settlementsByInvoice: ReadonlyMap<string, InvoiceSettlement>;
  private readonly invoicesById: ReadonlyMap<string, Invoice>;
  private readonly transactionsById: ReadonlyMap<string, Transaction>;

  private constructor(
    public readonly id: string,
    public readonly asOf: LocalDate,
    public readonly invoices: readonly Invoice[],
    public readonly transactions: readonly Transaction[],
    public readonly decisions: readonly MatchDecision[],
    public readonly settlements: readonly InvoiceSettlement[],
    public readonly payments: readonly Payment[],
    public readonly duplicateInvoices: readonly DuplicateInvoiceGroup[],
    public readonly duplicateTransactions: readonly DuplicateTransactionGroup[],
  ) {
    this.decisionsByTransaction = new Map(
      decisions.map((decision) => [decision.transactionId, decision]),
    );
    this.settlementsByInvoice = new Map(
      settlements.map((settlement) => [settlement.invoiceId, settlement]),
    );
    this.invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    this.transactionsById = new Map(
      transactions.map((tx) => [tx.id.value, tx]),
    );
    Object.freeze(this);
  }

  public static create(props: CreateRunProps): ReconciliationRun {
    const id = props.id.trim();

    if (!id) {
      throw new DomainError("INVALID_RECONCILIATION", "Run ID cannot be empty.");
    }

    const { outcome } = props;

    if (new Set(props.invoices.map((invoice) => invoice.id)).size !== props.invoices.length) {
      throw new DomainError("INVALID_RECONCILIATION", "Invoice IDs must be unique.");
    }

    if (
      new Set(props.transactions.map((tx) => tx.id.value)).size !==
      props.transactions.length
    ) {
      throw new DomainError("INVALID_RECONCILIATION", "Transaction IDs must be unique.");
    }

    if (outcome.decisions.length !== props.transactions.length) {
      throw new DomainError(
        "INVALID_RECONCILIATION",
        "Every transaction must have exactly one decision.",
      );
    }

    if (outcome.settlements.length !== props.invoices.length) {
      throw new DomainError(
        "INVALID_RECONCILIATION",
        "Every invoice must have exactly one settlement.",
      );
    }

    for (const tx of props.transactions) {
      const decision = outcome.decisions.find((d) => d.transactionId === tx.id.value);

      if (!decision) {
        throw new DomainError(
          "INVALID_RECONCILIATION",
          `Missing decision for transaction ${tx.id.value}.`,
        );
      }

      const accounted = decision.allocatedAmount.add(decision.unallocatedAmount);

      if (!accounted.equals(tx.amount)) {
        throw new DomainError(
          "INVALID_RECONCILIATION",
          `Allocated + unallocated amounts do not equal the amount of transaction ${tx.id.value}.`,
        );
      }
    }

    for (const settlement of outcome.settlements) {
      const paymentsForInvoice = outcome.payments.filter(
        (payment) => payment.invoiceId === settlement.invoiceId,
      );
      const total = paymentsForInvoice.reduce(
        (sum, payment) => sum.add(payment.amount),
        settlement.paidAmount.subtract(settlement.paidAmount),
      );

      if (!total.equals(settlement.paidAmount)) {
        throw new DomainError(
          "INVALID_RECONCILIATION",
          `Payments do not add up to the paid amount of invoice ${settlement.invoiceId}.`,
        );
      }
    }

    return new ReconciliationRun(
      id,
      props.asOf,
      Object.freeze([...props.invoices]),
      Object.freeze([...props.transactions]),
      Object.freeze([...outcome.decisions]),
      Object.freeze([...outcome.settlements]),
      Object.freeze([...outcome.payments]),
      Object.freeze([...outcome.duplicateInvoices]),
      Object.freeze([...outcome.duplicateTransactions]),
    );
  }

  public decisionFor(transactionId: string): MatchDecision | undefined {
    return this.decisionsByTransaction.get(transactionId);
  }

  public settlementFor(invoiceId: string): InvoiceSettlement | undefined {
    return this.settlementsByInvoice.get(invoiceId);
  }

  public invoiceById(invoiceId: string): Invoice | undefined {
    return this.invoicesById.get(invoiceId);
  }

  public transactionById(transactionId: string): Transaction | undefined {
    return this.transactionsById.get(transactionId);
  }
}
