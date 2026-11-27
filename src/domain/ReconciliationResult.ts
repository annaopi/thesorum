import type { Money } from "./value-objects/Money.js";

/**
 * Per-transaction outcome. MATCHED / PARTIALLY_MATCHED / UNMATCHED / REQUIRES_REVIEW
 * are the core statuses; OVERPAYMENT is a specialised review case.
 */
export type MatchStatus =
  | "MATCHED"
  | "PARTIALLY_MATCHED"
  | "OVERPAYMENT"
  | "UNMATCHED"
  | "REQUIRES_REVIEW";

export type MatchReason =
  | "REFERENCE_AND_IBAN_MATCH"
  | "FIELD_MATCH_WITHOUT_REFERENCE"
  | "PARTIAL_PAYMENT"
  | "OVERPAYMENT"
  | "NO_CANDIDATE_INVOICE"
  | "AMBIGUOUS_CANDIDATES"
  | "IBAN_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "DUPLICATE_TRANSACTION";

export type EvidenceRule =
  | "REFERENCE"
  | "CURRENCY"
  | "IBAN"
  | "BENEFICIARY"
  | "AMOUNT"
  | "DATE";

export interface MatchEvidence {
  readonly rule: EvidenceRule;
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface MatchDecision {
  readonly transactionId: string;
  readonly status: MatchStatus;
  readonly reason: MatchReason;
  /** Invoice the transaction was linked to, if exactly one could be identified. */
  readonly invoiceId: string | null;
  /** Portion of the transaction applied to the invoice (zero when nothing was applied). */
  readonly allocatedAmount: Money;
  /** Portion of the transaction that was NOT applied to any invoice. */
  readonly unallocatedAmount: Money;
  /** Invoices considered plausible when no single link could be made. */
  readonly candidateInvoiceIds: readonly string[];
  readonly evidence: readonly MatchEvidence[];
  readonly explanation: string;
}

export type SettlementStatus =
  | "PAID"
  | "PARTIALLY_PAID"
  | "UNPAID"
  | "OVERPAID"
  | "REQUIRES_REVIEW"
  | "DUPLICATE";

export interface InvoiceSettlement {
  readonly invoiceId: string;
  readonly status: SettlementStatus;
  readonly expectedAmount: Money;
  readonly paidAmount: Money;
  readonly outstandingAmount: Money;
  readonly overpaidAmount: Money;
  readonly paymentTransactionIds: readonly string[];
  readonly heldTransactionIds: readonly string[];
  readonly isOverdue: boolean;
  readonly duplicateOfInvoiceId: string | null;
  readonly explanation: string;
}

export interface DuplicateInvoiceGroup {
  readonly primaryInvoiceId: string;
  readonly duplicateInvoiceIds: readonly string[];
  /** True when the copies differ in amount, currency or IBAN. */
  readonly detailsConflict: boolean;
}

export interface DuplicateTransactionGroup {
  readonly primaryTransactionId: string;
  readonly duplicateTransactionIds: readonly string[];
}
