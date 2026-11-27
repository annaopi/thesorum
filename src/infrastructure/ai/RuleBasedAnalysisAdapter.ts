import type { Anomaly, AnomalyType } from "../../domain/Anomaly.js";
import type { DataQualityFacts } from "../../application/dto/DataQualityFacts.js";
import type {
  AIAnalysisPort,
  DataObservation,
  DataQualityAnalysis,
  ExceptionAnalysis,
  ExceptionAnalysisInput,
  ExceptionInsight,
} from "../../application/ports/AIAnalysisPort.js";

type ObservationDraft = Omit<DataObservation, "id">;

interface CauseTemplate {
  readonly causes: readonly string[];
  readonly recommendation: string;
}

const TEMPLATES: Readonly<Record<AnomalyType, CauseTemplate>> = {
  DUPLICATE_INVOICE: {
    causes: [
      "The supplier re-sent the invoice (e.g. a reminder or a second delivery channel).",
      "The invoice was entered twice in the ledger or ERP.",
      "If amount or IBAN differ, the copy may be a corrected invoice or a fraudulent resubmission.",
    ],
    recommendation:
      "Keep a single valid invoice, void the duplicate in the ledger and block it from payment runs.",
  },
  DUPLICATE_TRANSACTION: {
    causes: [
      "The same payment instruction was submitted twice (batch re-run or manual re-entry).",
      "The bank statement export contains the line twice.",
    ],
    recommendation:
      "Compare with the bank's own statement; if the debit really happened twice, claim a refund from the beneficiary.",
  },
  UNKNOWN_PAYMENT: {
    causes: [
      "The invoice has not been imported yet or the reference was mistyped.",
      "The payment was initiated outside the normal purchase-to-pay process.",
      "Possible fraudulent or unauthorised payment, particularly if the beneficiary account is new.",
    ],
    recommendation:
      "Ask the payment initiator for the supporting invoice or approval; escalate to the bank if none exists.",
  },
  IBAN_MISMATCH: {
    causes: [
      "The supplier changed bank account and the payment used the new details.",
      "The invoice master data is outdated.",
      "Business-email-compromise style fraud: a forged request to change bank details.",
    ],
    recommendation:
      "Verify the new IBAN by calling the supplier on a previously known number before any further payment; do not rely on the email that announced the change.",
  },
  AMOUNT_MISMATCH: {
    causes: [
      "Bank charges or currency rounding were deducted from the payment.",
      "A credit note or early-payment discount was applied but not recorded.",
      "A typing error in the payment amount.",
    ],
    recommendation:
      "Look for a credit note or discount agreement; otherwise settle or write off the small difference with approval.",
  },
  PARTIAL_PAYMENT: {
    causes: [
      "An agreed instalment plan.",
      "Part of the invoice is disputed (e.g. goods not fully delivered).",
      "Further payments for this invoice are still pending.",
    ],
    recommendation:
      "Confirm whether the remainder is disputed or scheduled and set a follow-up date.",
  },
  OVERPAYMENT: {
    causes: [
      "The invoice was paid twice (e.g. once manually, once in a batch).",
      "A typing error in the amount.",
      "An advance payment for a future invoice.",
    ],
    recommendation:
      "Request a refund or agree a written credit against the next invoice.",
  },
  CURRENCY_MISMATCH: {
    causes: [
      "The payment was made in the wrong currency.",
      "The invoice currency was recorded incorrectly.",
    ],
    recommendation:
      "Confirm the contractual currency, then correct either record manually; no automatic conversion is applied.",
  },
  AMBIGUOUS_MATCH: {
    causes: [
      "A combined payment covering several invoices.",
      "A reference that mentions more than one invoice number.",
    ],
    recommendation:
      "Obtain the remittance advice or ask the payer how the amount should be split, then allocate manually.",
  },
  BENEFICIARY_NAME_MISMATCH: {
    causes: [
      "The bank truncated or abbreviated the name.",
      "The supplier operates under a trading name.",
    ],
    recommendation: "Record the alternative name against the supplier if it is legitimate.",
  },
  PAYMENT_BEFORE_ISSUE: {
    causes: [
      "An advance payment or pro-forma invoice.",
      "A wrong invoice date or reference on the record.",
    ],
    recommendation: "Check the purchase order and the invoice date for correctness.",
  },
  OVERDUE_INVOICE: {
    causes: [
      "The invoice is still in the approval workflow.",
      "The invoice is disputed or was never received by accounts payable.",
      "The payment run missed it.",
    ],
    recommendation: "Confirm approval status and schedule payment or document the dispute.",
  },
};

function ids(anomaly: Anomaly): Set<string> {
  return new Set([anomaly.recordId, ...anomaly.relatedRecordIds]);
}

/**
 * Deterministic stand-in for the two AI agents ("demo mode"): runs without an
 * API key, produces the same structured output as an LLM would, and is used as
 * the fallback when an LLM call fails.
 */
export class RuleBasedAnalysisAdapter implements AIAnalysisPort {
  public async analyzeDataQuality(facts: DataQualityFacts): Promise<DataQualityAnalysis> {
    const drafts: ObservationDraft[] = [];

    for (const issue of facts.validationIssues) {
      drafts.push({
        kind: "VALIDATION_FAILURE",
        severity: "WARNING",
        recordIds: issue.recordId ? [issue.recordId] : [],
        message: `Row ${issue.rowNumber} of the ${issue.recordType.toLowerCase()} file (${issue.recordId ?? "no ID"}) was rejected: ${issue.message}`,
        suggestedCheck: "Correct the source record and re-import it; it is excluded from reconciliation until then.",
      });
    }

    for (const group of facts.duplicateInvoiceGroups) {
      drafts.push({
        kind: "DUPLICATE_INVOICE",
        severity: group.detailsConflict ? "CRITICAL" : "WARNING",
        recordIds: [group.primaryInvoiceId, ...group.duplicateInvoiceIds],
        message: `Invoice ${group.primaryInvoiceId} appears more than once (${group.duplicateInvoiceIds.join(", ")})${group.detailsConflict ? " with conflicting amount or IBAN details" : " with identical details"}.`,
        suggestedCheck: "Confirm with the supplier which copy is valid.",
      });
    }

    for (const group of facts.duplicateTransactionGroups) {
      drafts.push({
        kind: "DUPLICATE_TRANSACTION",
        severity: "WARNING",
        recordIds: [group.primaryTransactionId, ...group.duplicateTransactionIds],
        message: `Transaction ${group.primaryTransactionId} has identical copies (${group.duplicateTransactionIds.join(", ")}): same IBAN, amount, date and reference.`,
        suggestedCheck: "Check the bank statement to see whether money left the account twice.",
      });
    }

    if (facts.transactionsWithoutReference.length > 0) {
      drafts.push({
        kind: "MISSING_REFERENCE",
        severity: "INFO",
        recordIds: [...facts.transactionsWithoutReference],
        message: `${facts.transactionsWithoutReference.length} transaction(s) carry no payment reference, so they can only be matched on IBAN, name and exact amount.`,
        suggestedCheck: "Ask the payment initiators to always include the invoice number.",
      });
    }

    for (const entry of facts.suppliersWithMultipleIbans) {
      drafts.push({
        kind: "SUPPLIER_MULTIPLE_IBANS",
        severity: "WARNING",
        recordIds: [...entry.invoiceIds],
        message: `Supplier "${entry.supplierName}" uses ${entry.ibans.length} different IBANs across its invoices (${entry.ibans.join(", ")}).`,
        suggestedCheck: "Verify any bank-account change with the supplier through a known contact.",
      });
    }

    for (const entry of facts.ibansSharedBySuppliers) {
      drafts.push({
        kind: "IBAN_SHARED_BY_SUPPLIERS",
        severity: "WARNING",
        recordIds: [...entry.invoiceIds],
        message: `IBAN ${entry.iban} is used by several supplier names (${entry.supplierNames.join(", ")}).`,
        suggestedCheck: "Check whether these are related companies or a master-data error.",
      });
    }

    const observations = drafts.map((draft, index) => ({
      id: `OBS-${String(index + 1).padStart(3, "0")}`,
      ...draft,
    }));

    return {
      source: "RULE_BASED",
      summary:
        `Analysed ${facts.invoiceCount} invoice(s) and ${facts.transactionCount} transaction(s) that passed validation; ` +
        `${facts.validationIssues.length} row(s) were rejected. ${observations.length} observation(s) recorded.`,
      observations,
    };
  }

  public async analyzeExceptions(input: ExceptionAnalysisInput): Promise<ExceptionAnalysis> {
    const insights: ExceptionInsight[] = input.anomalies.map((anomaly) => {
      const template = TEMPLATES[anomaly.type];
      const anomalyIds = ids(anomaly);
      const related = input.dataQuality.observations.filter((observation) =>
        observation.recordIds.some((id) => anomalyIds.has(id)),
      );
      const causes = [...template.causes];
      const notes: string[] = [];

      for (const observation of related) {
        if (anomaly.type === "IBAN_MISMATCH" && observation.kind === "SUPPLIER_MULTIPLE_IBANS") {
          causes.unshift(
            `Data-quality analysis (${observation.id}) found that the same supplier already appears with several IBANs in the invoice data, so the new account may be a genuine change, but it must be verified out-of-band.`,
          );
          notes.push(observation.id);
        } else if (
          (anomaly.type === "DUPLICATE_INVOICE" && observation.kind === "DUPLICATE_INVOICE") ||
          (anomaly.type === "DUPLICATE_TRANSACTION" && observation.kind === "DUPLICATE_TRANSACTION") ||
          (anomaly.type === "UNKNOWN_PAYMENT" && observation.kind === "MISSING_REFERENCE")
        ) {
          causes.unshift(`Confirmed by the data-quality analysis (${observation.id}): ${observation.message}`);
          notes.push(observation.id);
        }
      }

      return {
        anomalyId: anomaly.id,
        likelyCauses: causes,
        recommendation: template.recommendation,
        suggestedPriority: anomaly.risk,
        relatedObservationIds: [...new Set([...notes, ...related.map((o) => o.id)])],
      };
    });

    const high = input.anomalies.filter((a) => a.risk === "HIGH").length;
    const medium = input.anomalies.filter((a) => a.risk === "MEDIUM").length;
    const low = input.anomalies.filter((a) => a.risk === "LOW").length;

    return {
      source: "RULE_BASED",
      summary:
        input.anomalies.length === 0
          ? "No anomalies were detected; nothing requires exception analysis."
          : `${input.anomalies.length} anomaly/anomalies analysed (${high} high, ${medium} medium, ${low} low), using ` +
            `${input.dataQuality.observations.length} data-quality observation(s) from the Transaction Analyst. ` +
            "Likely causes and next steps are suggestions for the reviewer, not decisions.",
      insights,
    };
  }
}
