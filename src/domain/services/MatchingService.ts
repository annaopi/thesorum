import { DomainError } from "../DomainError.js";
import type { Invoice } from "../entities/Invoice.js";
import { Payment } from "../entities/Payment.js";
import type { Transaction } from "../entities/Transaction.js";
import type {
  DuplicateInvoiceGroup,
  DuplicateTransactionGroup,
  InvoiceSettlement,
  MatchDecision,
  MatchEvidence,
  SettlementStatus,
} from "../ReconciliationResult.js";
import type { LocalDate } from "../value-objects/LocalDate.js";
import { Money } from "../value-objects/Money.js";
import { DuplicateDetector } from "./DuplicateDetector.js";
import { formatMoney, referenceMentions, sameParty } from "./DomainUtils.js";

export interface MatchingInput {
  readonly invoices: readonly Invoice[];
  readonly transactions: readonly Transaction[];
  readonly asOf: LocalDate;
}

export interface MatchingOutcome {
  readonly decisions: readonly MatchDecision[];
  readonly settlements: readonly InvoiceSettlement[];
  readonly payments: readonly Payment[];
  readonly duplicateInvoices: readonly DuplicateInvoiceGroup[];
  readonly duplicateTransactions: readonly DuplicateTransactionGroup[];
}

interface LedgerEntry {
  allocated: Money;
  overpaid: Money;
  paymentTransactionIds: string[];
  heldTransactionIds: string[];
}

type Ledger = Map<string, LedgerEntry>;
type MatchMode = "REFERENCE" | "FIELDS";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTransactions(a: Transaction, b: Transaction): number {
  return (
    compareText(a.bookingDate.value, b.bookingDate.value) ||
    compareText(a.id.value, b.id.value)
  );
}

function ledgerEntry(ledger: Ledger, invoice: Invoice): LedgerEntry {
  const entry = ledger.get(invoice.id);

  if (!entry) {
    throw new DomainError(
      "INVALID_RECONCILIATION",
      `Invoice ${invoice.id} is not part of the active reconciliation ledger.`,
    );
  }

  return entry;
}

/**
 * Deterministic, auditable matching of outgoing bank transactions to invoices.
 *
 * Rules (applied per transaction, in booking-date / ID order):
 *  1. Duplicate transactions are never applied; only the primary copy is matched.
 *  2. Candidate invoices are those whose number appears as a token in the payment
 *     reference. If several, the beneficiary IBAN may disambiguate; otherwise the
 *     transaction is AMBIGUOUS and goes to human review.
 *  3. Without a reference hit, a match is made only if IBAN, supplier name,
 *     currency, booking date (not before issue date) and the exact outstanding
 *     amount all agree and exactly one invoice qualifies.
 *  4. A linked transaction paid to a different IBAN, or in a different currency,
 *     is held for review and NOT applied to the invoice.
 *  5. Otherwise the amount is applied: partial, full, or full with excess flagged
 *     as overpayment.
 * No AI is involved at any point in this class.
 */
export class MatchingService {
  public static match(input: MatchingInput): MatchingOutcome {
    if (new Set(input.transactions.map((tx) => tx.id.value)).size !== input.transactions.length) {
      throw new DomainError(
        "INVALID_RECONCILIATION",
        "Transaction IDs must be unique before matching.",
      );
    }

    if (new Set(input.invoices.map((invoice) => invoice.id)).size !== input.invoices.length) {
      throw new DomainError(
        "INVALID_RECONCILIATION",
        "Invoice IDs must be unique before matching.",
      );
    }

    const duplicateInvoices = DuplicateDetector.findDuplicateInvoices(input.invoices);
    const duplicateTransactions = DuplicateDetector.findDuplicateTransactions(
      input.transactions,
    );

    const duplicateInvoicePrimary = new Map<string, string>();
    for (const group of duplicateInvoices) {
      for (const id of group.duplicateInvoiceIds) {
        duplicateInvoicePrimary.set(id, group.primaryInvoiceId);
      }
    }

    const duplicateTransactionPrimary = new Map<string, string>();
    for (const group of duplicateTransactions) {
      for (const id of group.duplicateTransactionIds) {
        duplicateTransactionPrimary.set(id, group.primaryTransactionId);
      }
    }

    const activeInvoices = input.invoices.filter(
      (invoice) => !duplicateInvoicePrimary.has(invoice.id),
    );

    const ledger: Ledger = new Map();
    for (const invoice of activeInvoices) {
      const currency = invoice.expectedAmount.currency;
      ledger.set(invoice.id, {
        allocated: Money.zero(currency),
        overpaid: Money.zero(currency),
        paymentTransactionIds: [],
        heldTransactionIds: [],
      });
    }

    const decisionsById = new Map<string, MatchDecision>();
    const payments: Payment[] = [];

    for (const tx of [...input.transactions].sort(compareTransactions)) {
      const primaryId = duplicateTransactionPrimary.get(tx.id.value);

      const decision =
        primaryId !== undefined
          ? MatchingService.duplicateDecision(tx, primaryId)
          : MatchingService.decide(tx, activeInvoices, ledger);

      decisionsById.set(tx.id.value, decision);
      MatchingService.applyToLedger(tx, decision, ledger, payments);
    }

    return {
      decisions: input.transactions.map((tx) => {
        const decision = decisionsById.get(tx.id.value);

        if (!decision) {
          throw new DomainError(
            "INVALID_RECONCILIATION",
            `No decision produced for transaction ${tx.id.value}. Transaction IDs must be unique.`,
          );
        }

        return decision;
      }),
      settlements: MatchingService.buildSettlements(
        input.invoices,
        duplicateInvoicePrimary,
        ledger,
        input.asOf,
      ),
      payments,
      duplicateInvoices,
      duplicateTransactions,
    };
  }

  // decide

  private static decide(
    tx: Transaction,
    invoices: readonly Invoice[],
    ledger: Ledger,
  ): MatchDecision {
    let candidates = invoices.filter((invoice) =>
      referenceMentions(tx.normalizedReference, invoice.invoiceNumber),
    );

    if (candidates.length > 1) {
      const byIban = candidates.filter((invoice) =>
        invoice.expectedIban.equals(tx.beneficiaryIban),
      );

      if (byIban.length === 1) {
        candidates = byIban;
      }
    }

    if (candidates.length > 1) {
      return MatchingService.ambiguousDecision(
        tx,
        candidates,
        `The payment reference mentions ${candidates.length} invoices (${candidates
          .map((invoice) => invoice.invoiceNumber)
          .join(", ")}) and the beneficiary IBAN does not single one out.`,
      );
    }

    if (candidates.length === 1) {
      return MatchingService.evaluate(tx, candidates[0], ledger, "REFERENCE");
    }

    return MatchingService.decideWithoutReference(tx, invoices, ledger);
  }

  private static decideWithoutReference(
    tx: Transaction,
    invoices: readonly Invoice[],
    ledger: Ledger,
  ): MatchDecision {
    const fieldCandidates = invoices.filter(
      (invoice) =>
        invoice.expectedAmount.currency.equals(tx.amount.currency) &&
        invoice.expectedIban.equals(tx.beneficiaryIban) &&
        sameParty(invoice.supplierName, tx.beneficiaryName) &&
        !tx.bookingDate.isBefore(invoice.issueDate) &&
        invoice.expectedAmount
          .subtract(ledgerEntry(ledger, invoice).allocated)
          .equals(tx.amount),
    );

    if (fieldCandidates.length === 1) {
      return MatchingService.evaluate(tx, fieldCandidates[0], ledger, "FIELDS");
    }

    if (fieldCandidates.length > 1) {
      return MatchingService.ambiguousDecision(
        tx,
        fieldCandidates,
        `No invoice number in the reference, and ${fieldCandidates.length} invoices from the same supplier have exactly this outstanding amount.`,
      );
    }

    const related = invoices
      .filter(
        (invoice) =>
          invoice.expectedIban.equals(tx.beneficiaryIban) ||
          sameParty(invoice.supplierName, tx.beneficiaryName),
      )
      .map((invoice) => invoice.id);

    return {
      transactionId: tx.id.value,
      status: "UNMATCHED",
      reason: "NO_CANDIDATE_INVOICE",
      invoiceId: null,
      allocatedAmount: Money.zero(tx.amount.currency),
      unallocatedAmount: tx.amount,
      candidateInvoiceIds: related,
      evidence: [
        {
          rule: "REFERENCE",
          satisfied: false,
          detail: tx.reference
            ? `Reference "${tx.reference}" does not contain a known invoice number.`
            : "Transaction has no payment reference.",
        },
      ],
      explanation:
        `No invoice could be identified for transaction ${tx.id.value} ` +
        `(${formatMoney(tx.amount)} to ${tx.beneficiaryName}, ${tx.beneficiaryIban.value}). ` +
        (related.length > 0
          ? `Invoices sharing the IBAN or supplier name exist (${related.join(", ")}) but the evidence is insufficient to match automatically.`
          : "No invoice shares its reference, IBAN or beneficiary name."),
    };
  }

  private static evaluate(
    tx: Transaction,
    invoice: Invoice,
    ledger: Ledger,
    mode: MatchMode,
  ): MatchDecision {
    const entry = ledgerEntry(ledger, invoice);
    const zero = Money.zero(tx.amount.currency);

    const ibanMatches = invoice.expectedIban.equals(tx.beneficiaryIban);
    const currencyMatches = invoice.expectedAmount.currency.equals(
      tx.amount.currency,
    );
    const nameMatches = sameParty(invoice.supplierName, tx.beneficiaryName);
    const notBeforeIssue = !tx.bookingDate.isBefore(invoice.issueDate);

    const evidence: MatchEvidence[] = [
      {
        rule: "REFERENCE",
        satisfied: mode === "REFERENCE",
        detail:
          mode === "REFERENCE"
            ? `Reference "${tx.reference}" contains invoice number ${invoice.invoiceNumber}.`
            : `Reference "${tx.reference}" has no invoice number; matched on IBAN, supplier, currency and exact outstanding amount.`,
      },
      {
        rule: "IBAN",
        satisfied: ibanMatches,
        detail: ibanMatches
          ? `Beneficiary IBAN ${tx.beneficiaryIban.value} equals the expected IBAN.`
          : `Beneficiary IBAN ${tx.beneficiaryIban.value} differs from expected ${invoice.expectedIban.value}.`,
      },
      {
        rule: "CURRENCY",
        satisfied: currencyMatches,
        detail: currencyMatches
          ? `Currency ${tx.amount.currency.code} equals the invoice currency.`
          : `Transaction currency ${tx.amount.currency.code} differs from invoice currency ${invoice.expectedAmount.currency.code}.`,
      },
      {
        rule: "BENEFICIARY",
        satisfied: nameMatches,
        detail: nameMatches
          ? `Beneficiary "${tx.beneficiaryName}" matches supplier "${invoice.supplierName}".`
          : `Beneficiary "${tx.beneficiaryName}" differs from supplier "${invoice.supplierName}".`,
      },
      {
        rule: "DATE",
        satisfied: notBeforeIssue,
        detail: notBeforeIssue
          ? `Booked ${tx.bookingDate.value}; invoice issued ${invoice.issueDate.value}, due ${invoice.dueDate.value}.`
          : `Booked ${tx.bookingDate.value}, BEFORE the invoice issue date ${invoice.issueDate.value}.`,
      },
    ];

    if (!ibanMatches) {
      return {
        transactionId: tx.id.value,
        status: "REQUIRES_REVIEW",
        reason: "IBAN_MISMATCH",
        invoiceId: invoice.id,
        allocatedAmount: zero,
        unallocatedAmount: tx.amount,
        candidateInvoiceIds: [invoice.id],
        evidence,
        explanation:
          `Transaction ${tx.id.value} references invoice ${invoice.invoiceNumber} but was paid to ` +
          `${tx.beneficiaryIban.value}, while the invoice expects ${invoice.expectedIban.value}. ` +
          `${formatMoney(tx.amount)} was not applied to the invoice and is held for review.`,
      };
    }

    if (!currencyMatches) {
      return {
        transactionId: tx.id.value,
        status: "REQUIRES_REVIEW",
        reason: "CURRENCY_MISMATCH",
        invoiceId: invoice.id,
        allocatedAmount: zero,
        unallocatedAmount: tx.amount,
        candidateInvoiceIds: [invoice.id],
        evidence,
        explanation:
          `Transaction ${tx.id.value} (${formatMoney(tx.amount)}) references invoice ${invoice.invoiceNumber} ` +
          `which is denominated in ${invoice.expectedAmount.currency.code}. No conversion is performed; held for review.`,
      };
    }

    const outstanding = invoice.expectedAmount.subtract(entry.allocated);
    const amountDetail = `Transaction ${formatMoney(tx.amount)} vs outstanding ${formatMoney(outstanding)} (invoice total ${formatMoney(invoice.expectedAmount)}).`;

    if (!outstanding.isPositive()) {
      return {
        transactionId: tx.id.value,
        status: "OVERPAYMENT",
        reason: "OVERPAYMENT",
        invoiceId: invoice.id,
        allocatedAmount: zero,
        unallocatedAmount: tx.amount,
        candidateInvoiceIds: [invoice.id],
        evidence: [...evidence, { rule: "AMOUNT", satisfied: false, detail: amountDetail }],
        explanation:
          `Invoice ${invoice.invoiceNumber} was already settled in full. The entire ${formatMoney(tx.amount)} ` +
          `of transaction ${tx.id.value} is an excess payment (possible duplicate payment).`,
      };
    }

    const comparison = tx.amount.compareTo(outstanding);

    if (comparison < 0) {
      return {
        transactionId: tx.id.value,
        status: "PARTIALLY_MATCHED",
        reason: "PARTIAL_PAYMENT",
        invoiceId: invoice.id,
        allocatedAmount: tx.amount,
        unallocatedAmount: zero,
        candidateInvoiceIds: [invoice.id],
        evidence: [...evidence, { rule: "AMOUNT", satisfied: false, detail: amountDetail }],
        explanation:
          `Partial payment: ${formatMoney(tx.amount)} applied to invoice ${invoice.invoiceNumber}; ` +
          `${formatMoney(outstanding.subtract(tx.amount))} remains outstanding.`,
      };
    }

    if (comparison === 0) {
      return {
        transactionId: tx.id.value,
        status: "MATCHED",
        reason:
          mode === "REFERENCE"
            ? "REFERENCE_AND_IBAN_MATCH"
            : "FIELD_MATCH_WITHOUT_REFERENCE",
        invoiceId: invoice.id,
        allocatedAmount: tx.amount,
        unallocatedAmount: zero,
        candidateInvoiceIds: [invoice.id],
        evidence: [...evidence, { rule: "AMOUNT", satisfied: true, detail: amountDetail }],
        explanation:
          mode === "REFERENCE"
            ? `Matched: ${formatMoney(tx.amount)} settles invoice ${invoice.invoiceNumber} (reference, IBAN and currency agree).`
            : `Matched without an invoice reference: IBAN, supplier, currency and the exact outstanding amount ${formatMoney(tx.amount)} agree with invoice ${invoice.invoiceNumber}.`,
      };
    }

    const excess = tx.amount.subtract(outstanding);

    return {
      transactionId: tx.id.value,
      status: "OVERPAYMENT",
      reason: "OVERPAYMENT",
      invoiceId: invoice.id,
      allocatedAmount: outstanding,
      unallocatedAmount: excess,
      candidateInvoiceIds: [invoice.id],
      evidence: [...evidence, { rule: "AMOUNT", satisfied: false, detail: amountDetail }],
      explanation:
        `Overpayment: ${formatMoney(tx.amount)} exceeds the outstanding ${formatMoney(outstanding)} ` +
        `of invoice ${invoice.invoiceNumber} by ${formatMoney(excess)}. ` +
        `${formatMoney(outstanding)} was applied; the excess is flagged for review.`,
    };
  }

  private static ambiguousDecision(
    tx: Transaction,
    candidates: readonly Invoice[],
    reason: string,
  ): MatchDecision {
    return {
      transactionId: tx.id.value,
      status: "REQUIRES_REVIEW",
      reason: "AMBIGUOUS_CANDIDATES",
      invoiceId: null,
      allocatedAmount: Money.zero(tx.amount.currency),
      unallocatedAmount: tx.amount,
      candidateInvoiceIds: candidates.map((invoice) => invoice.id),
      evidence: [
        {
          rule: "REFERENCE",
          satisfied: false,
          detail: `Ambiguous: ${candidates.length} candidate invoices (${candidates
            .map((invoice) => invoice.id)
            .join(", ")}).`,
        },
      ],
      explanation:
        `Transaction ${tx.id.value} (${formatMoney(tx.amount)}) cannot be matched unambiguously. ${reason} ` +
        "Nothing was applied; a human must decide the allocation.",
    };
  }

  private static duplicateDecision(
    tx: Transaction,
    primaryTransactionId: string,
  ): MatchDecision {
    return {
      transactionId: tx.id.value,
      status: "REQUIRES_REVIEW",
      reason: "DUPLICATE_TRANSACTION",
      invoiceId: null,
      allocatedAmount: Money.zero(tx.amount.currency),
      unallocatedAmount: tx.amount,
      candidateInvoiceIds: [],
      evidence: [
        {
          rule: "REFERENCE",
          satisfied: false,
          detail: `Identical IBAN, amount, currency, date and reference as transaction ${primaryTransactionId}.`,
        },
      ],
      explanation:
        `Transaction ${tx.id.value} is identical to ${primaryTransactionId} (same IBAN, amount, date and reference). ` +
        "It was excluded from matching so the invoice is not credited twice.",
    };
  }

  // ledger

  private static applyToLedger(
    tx: Transaction,
    decision: MatchDecision,
    ledger: Ledger,
    payments: Payment[],
  ): void {
    if (decision.invoiceId !== null && ledger.has(decision.invoiceId)) {
      const entry = ledger.get(decision.invoiceId);

      if (entry) {
        if (decision.allocatedAmount.isPositive()) {
          entry.allocated = entry.allocated.add(decision.allocatedAmount);
          entry.paymentTransactionIds.push(tx.id.value);
          payments.push(
            Payment.create({
              transactionId: tx.id,
              invoiceId: decision.invoiceId,
              amount: decision.allocatedAmount,
            }),
          );
        }

        if (decision.status === "OVERPAYMENT") {
          entry.overpaid = entry.overpaid.add(decision.unallocatedAmount);
        }
      }
    }

    if (
      decision.status === "REQUIRES_REVIEW" &&
      decision.reason !== "DUPLICATE_TRANSACTION"
    ) {
      const linked =
        decision.invoiceId !== null
          ? [decision.invoiceId]
          : decision.candidateInvoiceIds;

      for (const invoiceId of linked) {
        ledger.get(invoiceId)?.heldTransactionIds.push(tx.id.value);
      }
    }
  }

  private static buildSettlements(
    invoices: readonly Invoice[],
    duplicateInvoicePrimary: ReadonlyMap<string, string>,
    ledger: Ledger,
    asOf: LocalDate,
  ): InvoiceSettlement[] {
    return invoices.map((invoice): InvoiceSettlement => {
      const currency = invoice.expectedAmount.currency;
      const zero = Money.zero(currency);
      const primaryId = duplicateInvoicePrimary.get(invoice.id);

      if (primaryId !== undefined) {
        return {
          invoiceId: invoice.id,
          status: "DUPLICATE",
          expectedAmount: invoice.expectedAmount,
          paidAmount: zero,
          outstandingAmount: zero,
          overpaidAmount: zero,
          paymentTransactionIds: [],
          heldTransactionIds: [],
          isOverdue: false,
          duplicateOfInvoiceId: primaryId,
          explanation: `Duplicate of invoice ${primaryId} (same supplier and invoice number). Excluded from reconciliation and receivable totals.`,
        };
      }

      const entry = ledgerEntry(ledger, invoice);
      const paid = entry.allocated;
      const outstanding = invoice.expectedAmount.subtract(paid);
      const isOverdue = outstanding.isPositive() && invoice.dueDate.isBefore(asOf);
      const held = entry.heldTransactionIds;

      let status: SettlementStatus;
      let explanation: string;

      if (held.length > 0) {
        status = "REQUIRES_REVIEW";
        explanation =
          `Transaction(s) ${held.join(", ")} relate to this invoice but were held for human review. ` +
          `Applied so far: ${formatMoney(paid)} of ${formatMoney(invoice.expectedAmount)}.`;
      } else if (entry.overpaid.isPositive()) {
        status = "OVERPAID";
        explanation = `Overpaid by ${formatMoney(entry.overpaid)}; the invoice itself is settled (${formatMoney(paid)}).`;
      } else if (outstanding.isZero()) {
        status = "PAID";
        explanation = `Paid in full: ${formatMoney(paid)} received in ${entry.paymentTransactionIds.length} transaction(s).`;
      } else if (paid.isPositive()) {
        status = "PARTIALLY_PAID";
        explanation = `Partially paid: ${formatMoney(paid)} of ${formatMoney(invoice.expectedAmount)}; ${formatMoney(outstanding)} outstanding.`;
      } else {
        status = "UNPAID";
        explanation = `No payment applied; ${formatMoney(outstanding)} outstanding.`;
      }

      if (isOverdue) {
        explanation += ` Overdue since ${invoice.dueDate.value}.`;
      }

      return {
        invoiceId: invoice.id,
        status,
        expectedAmount: invoice.expectedAmount,
        paidAmount: paid,
        outstandingAmount: outstanding,
        overpaidAmount: entry.overpaid,
        paymentTransactionIds: [...entry.paymentTransactionIds],
        heldTransactionIds: [...held],
        isOverdue,
        duplicateOfInvoiceId: null,
        explanation,
      };
    });
  }
}
