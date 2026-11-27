import type { Anomaly, AnomalyType, RiskLevel } from "../../domain/Anomaly.js";
import { RISK_ORDER } from "../../domain/Anomaly.js";
import { DomainError } from "../../domain/DomainError.js";
import type { Invoice } from "../../domain/entities/Invoice.js";
import type { Transaction } from "../../domain/entities/Transaction.js";
import type { ReconciliationRun } from "../../domain/ReconciliationRun.js";
import type { MatchDecision } from "../../domain/ReconciliationResult.js";
import { daysBetween, formatMoney } from "../../domain/services/DomainUtils.js";

/** A short invoice shortfall up to this share of the invoice total is treated as an amount mismatch. */
export const AMOUNT_MISMATCH_TOLERANCE_PERCENT = 5;
/** Payments to unmatched accounts at or above this major-unit value are always HIGH risk. */
export const HIGH_VALUE_THRESHOLD_MAJOR_UNITS = 5000;
/** Unpaid invoices overdue by more than this many days are MEDIUM instead of LOW. */
export const OVERDUE_ESCALATION_DAYS = 30;

type AnomalyDraft = Omit<Anomaly, "id">;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic risk & anomaly rules over a ReconciliationRun. Every finding is
 * traceable to an invoice or transaction ID and carries an explanation, the
 * relevant values, a risk level and a recommended (human) action.
 */
export class DetectAnomalies {
  public execute(run: ReconciliationRun): readonly Anomaly[] {
    const drafts: AnomalyDraft[] = [
      ...this.fromDuplicateInvoices(run),
      ...this.fromDecisions(run),
      ...this.fromSettlements(run),
    ];

    return drafts
      .sort(
        (a, b) =>
          RISK_ORDER[b.risk] - RISK_ORDER[a.risk] ||
          compareText(a.recordId, b.recordId) ||
          compareText(a.type, b.type),
      )
      .map((draft, index) => ({
        id: `ANM-${String(index + 1).padStart(3, "0")}`,
        ...draft,
      }));
  }

  // ------------------------------------------------------------ invoices

  private fromDuplicateInvoices(run: ReconciliationRun): AnomalyDraft[] {
    const drafts: AnomalyDraft[] = [];

    for (const group of run.duplicateInvoices) {
      const primary = this.invoice(run, group.primaryInvoiceId);

      for (const duplicateId of group.duplicateInvoiceIds) {
        const copy = this.invoice(run, duplicateId);
        drafts.push({
          type: "DUPLICATE_INVOICE",
          risk: group.detailsConflict ? "HIGH" : "MEDIUM",
          recordType: "INVOICE",
          recordId: copy.id,
          relatedRecordIds: [primary.id],
          values: {
            invoiceNumber: copy.invoiceNumber,
            supplier: copy.supplierName,
            duplicateAmount: formatMoney(copy.expectedAmount),
            originalAmount: formatMoney(primary.expectedAmount),
            duplicateIban: copy.expectedIban.value,
            originalIban: primary.expectedIban.value,
          },
          explanation: group.detailsConflict
            ? `Invoice ${copy.id} repeats invoice number ${copy.invoiceNumber} from ${copy.supplierName} (already recorded as ${primary.id}) but with different amount or IBAN details.`
            : `Invoice ${copy.id} repeats invoice number ${copy.invoiceNumber} from ${copy.supplierName}, already recorded as ${primary.id} with identical amount and IBAN.`,
          recommendedAction:
            "Confirm with the supplier which invoice is valid, void the other, and make sure only one is scheduled for payment.",
        });
      }
    }

    return drafts;
  }

  private fromSettlements(run: ReconciliationRun): AnomalyDraft[] {
    const drafts: AnomalyDraft[] = [];

    for (const settlement of run.settlements) {
      const invoice = this.invoice(run, settlement.invoiceId);

      if (settlement.status === "PARTIALLY_PAID") {
        const expected = settlement.expectedAmount;
        const shortfall = settlement.outstandingAmount;
        const withinTolerance =
          BigInt(shortfall.amountMinorUnits) * 100n <=
          BigInt(expected.amountMinorUnits) * BigInt(AMOUNT_MISMATCH_TOLERANCE_PERCENT);
        const percent = (shortfall.amountMinorUnits / expected.amountMinorUnits) * 100;
        const values = {
          invoiceNumber: invoice.invoiceNumber,
          supplier: invoice.supplierName,
          expectedAmount: formatMoney(expected),
          paidAmount: formatMoney(settlement.paidAmount),
          shortfall: `${formatMoney(shortfall)} (${percent.toFixed(2)}%)`,
          paymentTransactions: settlement.paymentTransactionIds.join(", "),
        };

        if (withinTolerance) {
          drafts.push({
            type: "AMOUNT_MISMATCH",
            risk: "MEDIUM",
            recordType: "INVOICE",
            recordId: invoice.id,
            relatedRecordIds: [...settlement.paymentTransactionIds],
            values,
            explanation: `Invoice ${invoice.invoiceNumber} expects ${formatMoney(expected)} but only ${formatMoney(settlement.paidAmount)} was paid; the shortfall of ${formatMoney(shortfall)} is small (${percent.toFixed(2)}%), which suggests a bank fee, rounding, a typo or an unrecorded credit note rather than an intentional instalment.`,
            recommendedAction:
              "Check for a credit note or agreed discount; otherwise ask the supplier whether the remaining amount is still due.",
          });
        } else {
          drafts.push({
            type: "PARTIAL_PAYMENT",
            risk: settlement.isOverdue ? "MEDIUM" : "LOW",
            recordType: "INVOICE",
            recordId: invoice.id,
            relatedRecordIds: [...settlement.paymentTransactionIds],
            values,
            explanation: `Invoice ${invoice.invoiceNumber} is only partially paid: ${formatMoney(settlement.paidAmount)} of ${formatMoney(expected)}, leaving ${formatMoney(shortfall)} outstanding${settlement.isOverdue ? ` and overdue since ${invoice.dueDate.value}` : ""}.`,
            recommendedAction: settlement.isOverdue
              ? "Verify whether an instalment plan exists; if not, schedule the remaining payment or contact the supplier."
              : "Verify whether an instalment plan exists and when the remainder is due.",
          });
        }
      }

      if (settlement.status === "UNPAID" && settlement.isOverdue) {
        const days = daysBetween(invoice.dueDate, run.asOf);
        drafts.push({
          type: "OVERDUE_INVOICE",
          risk: days > OVERDUE_ESCALATION_DAYS ? "MEDIUM" : "LOW",
          recordType: "INVOICE",
          recordId: invoice.id,
          relatedRecordIds: [],
          values: {
            invoiceNumber: invoice.invoiceNumber,
            supplier: invoice.supplierName,
            outstanding: formatMoney(settlement.outstandingAmount),
            dueDate: invoice.dueDate.value,
            daysOverdue: String(days),
          },
          explanation: `Invoice ${invoice.invoiceNumber} (${formatMoney(settlement.outstandingAmount)}) has no matching payment and is ${days} day(s) past its due date ${invoice.dueDate.value}.`,
          recommendedAction:
            "Confirm the invoice is approved for payment and schedule it, or record the reason for the delay.",
        });
      }
    }

    return drafts;
  }

  // ------------------------------------------------------- transactions

  private fromDecisions(run: ReconciliationRun): AnomalyDraft[] {
    const drafts: AnomalyDraft[] = [];
    const knownIbans = new Set(run.invoices.map((invoice) => invoice.expectedIban.value));

    for (const decision of run.decisions) {
      const tx = this.transaction(run, decision.transactionId);
      const linked =
        decision.invoiceId !== null ? this.invoice(run, decision.invoiceId) : undefined;

      const base = {
        recordType: "TRANSACTION" as const,
        recordId: tx.id.value,
      };

      switch (decision.reason) {
        case "DUPLICATE_TRANSACTION": {
          const group = run.duplicateTransactions.find((g) =>
            g.duplicateTransactionIds.includes(tx.id.value),
          );
          drafts.push({
            ...base,
            type: "DUPLICATE_TRANSACTION",
            risk: "HIGH",
            relatedRecordIds: group ? [group.primaryTransactionId] : [],
            values: {
              amount: formatMoney(tx.amount),
              beneficiaryIban: tx.beneficiaryIban.value,
              bookingDate: tx.bookingDate.value,
              reference: tx.reference,
            },
            explanation: decision.explanation,
            recommendedAction:
              "Check the bank statement and payment batch for a double debit; if confirmed, request a refund or credit from the beneficiary.",
          });
          break;
        }

        case "NO_CANDIDATE_INVOICE": {
          const unknownIban = !knownIbans.has(tx.beneficiaryIban.value);
          const threshold =
            HIGH_VALUE_THRESHOLD_MAJOR_UNITS * 10 ** tx.amount.currency.minorUnits;
          const highValue = tx.amount.amountMinorUnits >= threshold;
          drafts.push({
            ...base,
            type: "UNKNOWN_PAYMENT",
            risk: unknownIban || highValue ? "HIGH" : "MEDIUM",
            relatedRecordIds: [...decision.candidateInvoiceIds],
            values: {
              amount: formatMoney(tx.amount),
              beneficiary: tx.beneficiaryName,
              beneficiaryIban: tx.beneficiaryIban.value,
              reference: tx.reference,
              ibanKnownFromInvoices: unknownIban ? "no" : "yes",
            },
            explanation:
              `${decision.explanation} ` +
              (unknownIban
                ? "The beneficiary account does not appear on any invoice. "
                : "") +
              (highValue ? "The amount is above the high-value threshold." : ""),
            recommendedAction:
              "Find the approval or purchase order behind this payment; if none exists, treat it as unauthorised and contact the bank.",
          });
          break;
        }

        case "IBAN_MISMATCH": {
          if (linked) {
            drafts.push({
              ...base,
              type: "IBAN_MISMATCH",
              risk: "HIGH",
              relatedRecordIds: [linked.id],
              values: {
                amount: formatMoney(tx.amount),
                expectedIban: linked.expectedIban.value,
                actualIban: tx.beneficiaryIban.value,
                supplier: linked.supplierName,
                beneficiary: tx.beneficiaryName,
              },
              explanation: decision.explanation,
              recommendedAction:
                "Do not release or accept this as settlement. Call the supplier on a known phone number to verify the account change before any further payment.",
            });
          }
          break;
        }

        case "CURRENCY_MISMATCH": {
          if (linked) {
            drafts.push({
              ...base,
              type: "CURRENCY_MISMATCH",
              risk: "MEDIUM",
              relatedRecordIds: [linked.id],
              values: {
                transactionAmount: formatMoney(tx.amount),
                invoiceAmount: formatMoney(linked.expectedAmount),
              },
              explanation: decision.explanation,
              recommendedAction:
                "Confirm the intended currency with the supplier and apply the correct conversion manually.",
            });
          }
          break;
        }

        case "AMBIGUOUS_CANDIDATES": {
          drafts.push({
            ...base,
            type: "AMBIGUOUS_MATCH",
            risk: "MEDIUM",
            relatedRecordIds: [...decision.candidateInvoiceIds],
            values: {
              amount: formatMoney(tx.amount),
              reference: tx.reference,
              candidates: decision.candidateInvoiceIds.join(", "),
            },
            explanation: decision.explanation,
            recommendedAction:
              "Decide manually how the payment is split across the candidate invoices.",
          });
          break;
        }

        case "OVERPAYMENT": {
          if (linked) {
            const wholeInvoicePaidAgain =
              decision.unallocatedAmount.compareTo(linked.expectedAmount) >= 0;
            drafts.push({
              ...base,
              type: "OVERPAYMENT",
              risk: wholeInvoicePaidAgain ? "HIGH" : "MEDIUM",
              relatedRecordIds: [linked.id],
              values: {
                transactionAmount: formatMoney(tx.amount),
                invoiceAmount: formatMoney(linked.expectedAmount),
                appliedAmount: formatMoney(decision.allocatedAmount),
                excess: formatMoney(decision.unallocatedAmount),
              },
              explanation: decision.explanation,
              recommendedAction: wholeInvoicePaidAgain
                ? "Treat as a possible duplicate payment: request a refund or credit from the supplier."
                : "Request a refund or agree a credit against the next invoice from the supplier.",
            });
          }
          break;
        }

        default:
          break;
      }

      drafts.push(...this.fromEvidence(decision, tx, linked));
    }

    return drafts;
  }

  /** Soft findings on transactions that WERE applied to an invoice. */
  private fromEvidence(
    decision: MatchDecision,
    tx: Transaction,
    linked: Invoice | undefined,
  ): AnomalyDraft[] {
    if (!linked || !decision.allocatedAmount.isPositive()) {
      return [];
    }

    const drafts: AnomalyDraft[] = [];
    const evidenceFor = (rule: string) => decision.evidence.find((e) => e.rule === rule);

    const beneficiary = evidenceFor("BENEFICIARY");
    if (beneficiary && !beneficiary.satisfied) {
      drafts.push({
        type: "BENEFICIARY_NAME_MISMATCH",
        risk: "LOW",
        recordType: "TRANSACTION",
        recordId: tx.id.value,
        relatedRecordIds: [linked.id],
        values: {
          beneficiary: tx.beneficiaryName,
          supplier: linked.supplierName,
          iban: tx.beneficiaryIban.value,
        },
        explanation: `Transaction ${tx.id.value} was applied to invoice ${linked.invoiceNumber} because reference and IBAN agree, but the beneficiary name "${tx.beneficiaryName}" differs from supplier "${linked.supplierName}".`,
        recommendedAction:
          "Confirm the name difference is only a trading name or bank truncation.",
      });
    }

    const date = evidenceFor("DATE");
    if (date && !date.satisfied) {
      drafts.push({
        type: "PAYMENT_BEFORE_ISSUE",
        risk: "MEDIUM",
        recordType: "TRANSACTION",
        recordId: tx.id.value,
        relatedRecordIds: [linked.id],
        values: {
          bookingDate: tx.bookingDate.value,
          issueDate: linked.issueDate.value,
          amount: formatMoney(tx.amount),
        },
        explanation: `Transaction ${tx.id.value} was booked on ${tx.bookingDate.value}, before invoice ${linked.invoiceNumber} was issued on ${linked.issueDate.value}.`,
        recommendedAction:
          "Check whether this was an advance payment or whether the invoice date or reference is wrong.",
      });
    }

    return drafts;
  }

  // ------------------------------------------------------------- lookup

  private invoice(run: ReconciliationRun, id: string): Invoice {
    const invoice = run.invoiceById(id);

    if (!invoice) {
      throw new DomainError("INVALID_RECONCILIATION", `Unknown invoice ${id} in run ${run.id}.`);
    }

    return invoice;
  }

  private transaction(run: ReconciliationRun, id: string): Transaction {
    const tx = run.transactionById(id);

    if (!tx) {
      throw new DomainError("INVALID_RECONCILIATION", `Unknown transaction ${id} in run ${run.id}.`);
    }

    return tx;
  }
}

export type { AnomalyType, RiskLevel };
