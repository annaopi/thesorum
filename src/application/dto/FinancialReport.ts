import type { AnomalyType, RiskLevel } from "../../domain/Anomaly.js";
import type {
  MatchEvidence,
  MatchReason,
  MatchStatus,
  SettlementStatus,
} from "../../domain/ReconciliationResult.js";
import type {
  AnalysisSource,
  DataObservation,
} from "../ports/AIAnalysisPort.js";
import type { AgentMessage } from "./AgentMessage.js";
import type { ValidationIssue } from "./ValidationIssue.js";

export interface CurrencyTotals {
  readonly currency: string;
  /** Sum of all non-duplicate invoices. */
  readonly invoiced: string;
  /** Sum of amounts applied to invoices. */
  readonly paid: string;
  readonly outstanding: string;
  /** Part of `outstanding` that is past its due date. */
  readonly overdue: string;
  /** Excess paid over invoice totals. */
  readonly overpaid: string;
  /** Transaction money NOT applied to any invoice (unmatched, held, duplicate, excess). */
  readonly notApplied: string;
}

export interface InvoiceReportLine {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly supplier: string;
  readonly status: SettlementStatus;
  readonly currency: string;
  readonly expected: string;
  readonly paid: string;
  readonly outstanding: string;
  readonly overpaid: string;
  readonly dueDate: string;
  readonly isOverdue: boolean;
  readonly paymentTransactionIds: readonly string[];
  readonly heldTransactionIds: readonly string[];
  readonly duplicateOf: string | null;
  readonly explanation: string;
}

export interface TransactionReportLine {
  readonly transactionId: string;
  readonly bookingDate: string;
  readonly currency: string;
  readonly amount: string;
  readonly beneficiary: string;
  readonly iban: string;
  readonly reference: string;
  readonly status: MatchStatus;
  readonly reason: MatchReason;
  readonly invoiceId: string | null;
  readonly allocated: string;
  readonly notApplied: string;
  readonly candidateInvoiceIds: readonly string[];
  readonly evidence: readonly MatchEvidence[];
  readonly explanation: string;
}

export interface AnomalyInsightLine {
  readonly source: AnalysisSource;
  readonly likelyCauses: readonly string[];
  readonly recommendation: string;
  readonly suggestedPriority: RiskLevel;
  readonly relatedObservationIds: readonly string[];
}

export interface AnomalyReportLine {
  readonly id: string;
  readonly type: AnomalyType;
  readonly risk: RiskLevel;
  readonly recordType: "INVOICE" | "TRANSACTION";
  readonly recordId: string;
  readonly relatedRecordIds: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly explanation: string;
  readonly recommendedAction: string;
  readonly aiInsight: AnomalyInsightLine | null;
}

export interface ReviewItem {
  readonly rank: number;
  readonly priority: RiskLevel;
  readonly anomalyId: string;
  readonly type: AnomalyType;
  readonly recordType: "INVOICE" | "TRANSACTION";
  readonly recordId: string;
  readonly headline: string;
  readonly recommendedAction: string;
}

export interface FinancialReport {
  readonly runId: string;
  readonly asOf: string;
  readonly input: {
    readonly invoicesRead: number;
    readonly invoicesImported: number;
    readonly transactionsRead: number;
    readonly transactionsImported: number;
    readonly validationIssues: readonly ValidationIssue[];
  };
  readonly totalsByCurrency: readonly CurrencyTotals[];
  readonly invoiceStatusCounts: Readonly<Record<string, number>>;
  readonly transactionStatusCounts: Readonly<Record<string, number>>;
  readonly anomalyRiskCounts: Readonly<Record<RiskLevel, number>>;
  readonly invoices: readonly InvoiceReportLine[];
  readonly transactions: readonly TransactionReportLine[];
  readonly anomalies: readonly AnomalyReportLine[];

  readonly reviewQueue: readonly ReviewItem[];
  readonly dataQuality: {
    readonly source: AnalysisSource;
    readonly summary: string;
    readonly observations: readonly DataObservation[];
  };
  readonly exceptionAnalysis: {
    readonly source: AnalysisSource;
    readonly summary: string;
  };
  readonly agentTrace: readonly AgentMessage[];
  readonly disclaimer: string;
}
