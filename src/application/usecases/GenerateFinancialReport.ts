import type { Anomaly, RiskLevel } from "../../domain/Anomaly.js";
import { RISK_ORDER } from "../../domain/Anomaly.js";
import type { ReconciliationRun } from "../../domain/ReconciliationRun.js";
import { Money } from "../../domain/value-objects/Money.js";
import type { AgentMessage } from "../dto/AgentMessage.js";
import type {
  AnomalyReportLine,
  CurrencyTotals,
  FinancialReport,
  InvoiceReportLine,
  ReviewItem,
  TransactionReportLine,
} from "../dto/FinancialReport.js";
import type { ImportResult } from "../dto/ImportResult.js";
import type {
  DataQualityAnalysis,
  ExceptionAnalysis,
  ExceptionInsight,
} from "../ports/AIAnalysisPort.js";

export const REPORT_DISCLAIMER =
  "Advisory report. THESORUM never approves, modifies or executes payments; " +
  "all statuses and amounts are computed deterministically and every flagged item requires human review. " +
  "AI commentary is explanatory only and cannot change a status, risk level or amount.";

export interface GenerateReportInput {
  readonly run: ReconciliationRun;
  readonly anomalies: readonly Anomaly[];
  readonly invoiceImport: ImportResult;
  readonly transactionImport: ImportResult;
  readonly dataQuality: DataQualityAnalysis;
  readonly exceptionAnalysis: ExceptionAnalysis;
  readonly trace: readonly AgentMessage[];
}

interface Accumulator {
  invoiced: Money;
  paid: Money;
  outstanding: Money;
  overdue: Money;
  overpaid: Money;
  notApplied: Money;
}

function higherRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Pure consolidation of deterministic results and advisory AI output into one report. */
export class GenerateFinancialReport {
  public execute(input: GenerateReportInput): FinancialReport {
    const { run, anomalies } = input;
    const insightsByAnomaly = new Map<string, ExceptionInsight>(
      input.exceptionAnalysis.insights.map((insight) => [insight.anomalyId, insight]),
    );

    const invoiceStatusCounts: Record<string, number> = {};
    const transactionStatusCounts: Record<string, number> = {};
    const anomalyRiskCounts: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };

    const invoices: InvoiceReportLine[] = run.settlements.map((settlement) => {
      const invoice = run.invoiceById(settlement.invoiceId);

      if (!invoice) {
        throw new Error(`Invoice ${settlement.invoiceId} missing from run.`);
      }

      increment(invoiceStatusCounts, settlement.status);

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        supplier: invoice.supplierName,
        status: settlement.status,
        currency: invoice.expectedAmount.currency.code,
        expected: settlement.expectedAmount.toDecimalString(),
        paid: settlement.paidAmount.toDecimalString(),
        outstanding: settlement.outstandingAmount.toDecimalString(),
        overpaid: settlement.overpaidAmount.toDecimalString(),
        dueDate: invoice.dueDate.value,
        isOverdue: settlement.isOverdue,
        paymentTransactionIds: settlement.paymentTransactionIds,
        heldTransactionIds: settlement.heldTransactionIds,
        duplicateOf: settlement.duplicateOfInvoiceId,
        explanation: settlement.explanation,
      };
    });

    const transactions: TransactionReportLine[] = run.decisions.map((decision) => {
      const tx = run.transactionById(decision.transactionId);

      if (!tx) {
        throw new Error(`Transaction ${decision.transactionId} missing from run.`);
      }

      increment(transactionStatusCounts, decision.status);

      return {
        transactionId: tx.id.value,
        bookingDate: tx.bookingDate.value,
        currency: tx.amount.currency.code,
        amount: tx.amount.toDecimalString(),
        beneficiary: tx.beneficiaryName,
        iban: tx.beneficiaryIban.value,
        reference: tx.reference,
        status: decision.status,
        reason: decision.reason,
        invoiceId: decision.invoiceId,
        allocated: decision.allocatedAmount.toDecimalString(),
        notApplied: decision.unallocatedAmount.toDecimalString(),
        candidateInvoiceIds: decision.candidateInvoiceIds,
        evidence: decision.evidence,
        explanation: decision.explanation,
      };
    });

    const anomalyLines: AnomalyReportLine[] = anomalies.map((anomaly) => {
      anomalyRiskCounts[anomaly.risk] += 1;
      const insight = insightsByAnomaly.get(anomaly.id);

      return {
        ...anomaly,
        aiInsight: insight
          ? {
              source: input.exceptionAnalysis.source,
              likelyCauses: insight.likelyCauses,
              recommendation: insight.recommendation,
              suggestedPriority: insight.suggestedPriority,
              relatedObservationIds: insight.relatedObservationIds,
            }
          : null,
      };
    });

    const reviewQueue: ReviewItem[] = anomalyLines
      .map((line) => ({
        line,
        priority: higherRisk(line.risk, line.aiInsight?.suggestedPriority ?? line.risk),
      }))
      .sort(
        (a, b) =>
          RISK_ORDER[b.priority] - RISK_ORDER[a.priority] ||
          (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0),
      )
      .map(({ line, priority }, index) => ({
        rank: index + 1,
        priority,
        anomalyId: line.id,
        type: line.type,
        recordType: line.recordType,
        recordId: line.recordId,
        headline: line.explanation,
        recommendedAction: line.recommendedAction,
      }));

    return {
      runId: run.id,
      asOf: run.asOf.value,
      input: {
        invoicesRead: input.invoiceImport.recordsRead,
        invoicesImported: input.invoiceImport.imported,
        transactionsRead: input.transactionImport.recordsRead,
        transactionsImported: input.transactionImport.imported,
        validationIssues: [...input.invoiceImport.issues, ...input.transactionImport.issues],
      },
      totalsByCurrency: this.totals(run),
      invoiceStatusCounts,
      transactionStatusCounts,
      anomalyRiskCounts,
      invoices,
      transactions,
      anomalies: anomalyLines,
      reviewQueue,
      dataQuality: {
        source: input.dataQuality.source,
        summary: input.dataQuality.summary,
        observations: input.dataQuality.observations,
      },
      exceptionAnalysis: {
        source: input.exceptionAnalysis.source,
        summary: input.exceptionAnalysis.summary,
      },
      agentTrace: input.trace,
      disclaimer: REPORT_DISCLAIMER,
    };
  }

  private totals(run: ReconciliationRun): CurrencyTotals[] {
    const byCurrency = new Map<string, Accumulator>();

    const accumulatorFor = (money: Money): Accumulator => {
      const code = money.currency.code;
      const existing = byCurrency.get(code);

      if (existing) {
        return existing;
      }

      const zero = Money.zero(money.currency);
      const created: Accumulator = {
        invoiced: zero,
        paid: zero,
        outstanding: zero,
        overdue: zero,
        overpaid: zero,
        notApplied: zero,
      };
      byCurrency.set(code, created);
      return created;
    };

    for (const settlement of run.settlements) {
      const acc = accumulatorFor(settlement.expectedAmount);

      if (settlement.status === "DUPLICATE") {
        continue;
      }

      acc.invoiced = acc.invoiced.add(settlement.expectedAmount);
      acc.paid = acc.paid.add(settlement.paidAmount);
      acc.outstanding = acc.outstanding.add(settlement.outstandingAmount);
      acc.overpaid = acc.overpaid.add(settlement.overpaidAmount);

      if (settlement.isOverdue) {
        acc.overdue = acc.overdue.add(settlement.outstandingAmount);
      }
    }

    for (const decision of run.decisions) {
      const acc = accumulatorFor(decision.unallocatedAmount);
      acc.notApplied = acc.notApplied.add(decision.unallocatedAmount);
    }

    return [...byCurrency.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([currency, acc]) => ({
        currency,
        invoiced: acc.invoiced.toDecimalString(),
        paid: acc.paid.toDecimalString(),
        outstanding: acc.outstanding.toDecimalString(),
        overdue: acc.overdue.toDecimalString(),
        overpaid: acc.overpaid.toDecimalString(),
        notApplied: acc.notApplied.toDecimalString(),
      }));
  }
}
