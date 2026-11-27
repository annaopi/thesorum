import type { Anomaly, RiskLevel } from "../../domain/Anomaly.js";
import type { DataQualityFacts } from "../dto/DataQualityFacts.js";

/**
 * Port for the two advisory AI agents.
 *
 * Contract: implementations may ONLY interpret and explain the structured input.
 * They cannot approve, change or execute payments, and they cannot change
 * statuses, risk levels or amounts. Their output is validated by
 * AgentOutputGuard before it is used.
 */
export type AnalysisSource = "RULE_BASED" | "LLM" | "RULE_BASED_FALLBACK";

export type ObservationKind =
  | "VALIDATION_FAILURE"
  | "DUPLICATE_INVOICE"
  | "DUPLICATE_TRANSACTION"
  | "MISSING_REFERENCE"
  | "SUPPLIER_MULTIPLE_IBANS"
  | "IBAN_SHARED_BY_SUPPLIERS"
  | "GENERAL";

export type ObservationSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface DataObservation {
  readonly id: string;
  readonly kind: ObservationKind;
  readonly severity: ObservationSeverity;
  readonly recordIds: readonly string[];
  readonly message: string;
  readonly suggestedCheck: string;
}

/** Output of Agent 1 (Financial Document / Transaction Analyst). */
export interface DataQualityAnalysis {
  readonly source: AnalysisSource;
  readonly summary: string;
  readonly observations: readonly DataObservation[];
}

export interface ExceptionInsight {
  readonly anomalyId: string;
  readonly likelyCauses: readonly string[];
  readonly recommendation: string;
  readonly suggestedPriority: RiskLevel;
  readonly relatedObservationIds: readonly string[];
}

/** Output of Agent 2 (Reconciliation / Exception Analyst). */
export interface ExceptionAnalysis {
  readonly source: AnalysisSource;
  readonly summary: string;
  readonly insights: readonly ExceptionInsight[];
}

/** Input of Agent 2: deterministic findings PLUS the hand-over from Agent 1. */
export interface ExceptionAnalysisInput {
  readonly runId: string;
  readonly asOf: string;
  readonly anomalies: readonly Anomaly[];
  readonly dataQuality: DataQualityAnalysis;
}

export interface AIAnalysisPort {
  analyzeDataQuality(facts: DataQualityFacts): Promise<DataQualityAnalysis>;
  analyzeExceptions(input: ExceptionAnalysisInput): Promise<ExceptionAnalysis>;
}

export class AIAnalysisError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AIAnalysisError";
  }
}
