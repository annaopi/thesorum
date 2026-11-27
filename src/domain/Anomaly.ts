export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type AnomalyType =
  | "DUPLICATE_INVOICE"
  | "DUPLICATE_TRANSACTION"
  | "UNKNOWN_PAYMENT"
  | "IBAN_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "PARTIAL_PAYMENT"
  | "OVERPAYMENT"
  | "CURRENCY_MISMATCH"
  | "AMBIGUOUS_MATCH"
  | "BENEFICIARY_NAME_MISMATCH"
  | "PAYMENT_BEFORE_ISSUE"
  | "OVERDUE_INVOICE";

/** A deterministic finding, always traceable to an original record. */
export interface Anomaly {
  /** Stable within a run, e.g. "ANM-003". */
  readonly id: string;
  readonly type: AnomalyType;
  readonly risk: RiskLevel;
  readonly recordType: "INVOICE" | "TRANSACTION";
  /** The invoice or transaction ID the finding is about. */
  readonly recordId: string;
  /** Other invoice / transaction IDs involved. */
  readonly relatedRecordIds: readonly string[];
  /** Relevant financial values, already formatted for display. */
  readonly values: Readonly<Record<string, string>>;
  readonly explanation: string;
  readonly recommendedAction: string;
}

export const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};
