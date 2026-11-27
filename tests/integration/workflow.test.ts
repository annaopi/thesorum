import { describe, expect, it } from "vitest";
import type { AIAnalysisPort } from "../../src/application/ports/AIAnalysisPort.js";
import { DetectAnomalies } from "../../src/application/usecases/DetectAnomalies.js";
import { GenerateFinancialReport } from "../../src/application/usecases/GenerateFinancialReport.js";
import { ImportInvoices } from "../../src/application/usecases/ImportInvoices.js";
import { ImportTransactions } from "../../src/application/usecases/ImportTransactions.js";
import { ProfileImportedData } from "../../src/application/usecases/ProfileImportedData.js";
import { ReconcileTransactions } from "../../src/application/usecases/ReconcileTransactions.js";
import { ReconciliationWorkflow } from "../../src/application/workflow/ReconciliationWorkflow.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";
import { CsvInvoiceSource } from "../../src/infrastructure/csv/CsvInvoiceSource.js";
import { CsvTransactionSource } from "../../src/infrastructure/csv/CsvTransactionSource.js";
import { RuleBasedAnalysisAdapter } from "../../src/infrastructure/ai/RuleBasedAnalysisAdapter.js";
import { InMemoryInvoiceRepository } from "../../src/infrastructure/persistence/InMemoryInvoiceRepository.js";
import { InMemoryPaymentRepository } from "../../src/infrastructure/persistence/InMemoryPaymentRepository.js";
import { InMemoryTransactionRepository } from "../../src/infrastructure/persistence/InMemoryTransactionRepository.js";
import { IBANS } from "../helpers/builders.js";

const INVOICES_CSV = [
  "id,invoice_number,supplier_name,amount,currency,iban,issue_date,due_date",
  `I-1,INV-1,Acme GmbH,1000.00,EUR,${IBANS.acme},2026-10-01,2026-10-31`,
  `I-2,INV-2,Beta Ltd,500.00,EUR,${IBANS.beta},2026-10-01,2026-10-31`,
  `I-3,INV-3,Beta Ltd,250.00,EUR,${IBANS.other},2026-10-01,2026-10-31`,
].join("\n");

const TRANSACTIONS_CSV = [
  "id,booking_date,amount,currency,beneficiary_name,beneficiary_iban,reference",
  `T-1,2026-10-10,600.00,EUR,Acme GmbH,${IBANS.acme},INV-1`,
  `T-2,2026-10-20,400.00,EUR,Acme GmbH,${IBANS.acme},INV-1`,
  `T-3,2026-10-21,500.00,EUR,Beta Ltd,${IBANS.other},INV-2`,
  `T-4,2026-10-22,77.00,EUR,Nobody,${IBANS.unknown},misc`,
  `T-5,2026-10-22,1.00,EUR,Bad,DE00,bad row`,
].join("\n");

function build(ai: AIAnalysisPort) {
  const invoices = new InMemoryInvoiceRepository();
  const transactions = new InMemoryTransactionRepository();
  const payments = new InMemoryPaymentRepository();
  const fallbackAi = new RuleBasedAnalysisAdapter();
  const workflow = new ReconciliationWorkflow({
    importInvoices: new ImportInvoices(new CsvInvoiceSource("inv.csv", async () => INVOICES_CSV), invoices),
    importTransactions: new ImportTransactions(new CsvTransactionSource("tx.csv", async () => TRANSACTIONS_CSV), transactions),
    profileData: new ProfileImportedData(invoices, transactions),
    reconcile: new ReconcileTransactions(invoices, transactions, payments),
    detectAnomalies: new DetectAnomalies(),
    generateReport: new GenerateFinancialReport(),
    invoices,
    transactions,
    ai,
    fallbackAi,
  });
  return { workflow, payments, invoices, transactions };
}

const asOf = LocalDate.create("2026-12-01");

describe("ReconciliationWorkflow (CSV -> repositories -> engine -> agents -> report)", () => {
  it("imports, reconciles, stores allocations and produces a consistent report", async () => {
    const { workflow, payments } = build(new RuleBasedAnalysisAdapter());
    const { report, run } = await workflow.run({ asOf });

    expect(report.input.transactionsRead).toBe(5);
    expect(report.input.transactionsImported).toBe(4);
    expect(report.input.validationIssues).toHaveLength(1);
    expect(report.input.validationIssues[0]?.code).toBe("INVALID_IBAN");

    const stored = await payments.findAll();
    expect(stored).toHaveLength(2);
    expect((await payments.findByInvoiceId("I-1")).map((p) => p.amount.toDecimalString())).toEqual(["600.00", "400.00"]);
    expect(stored.length).toBe(run.payments.length);

    const byId = Object.fromEntries(report.invoices.map((i) => [i.invoiceId, i.status]));
    expect(byId).toEqual({ "I-1": "PAID", "I-2": "REQUIRES_REVIEW", "I-3": "UNPAID" });

    const eur = report.totalsByCurrency.find((t) => t.currency === "EUR");
    expect(eur?.invoiced).toBe("1750.00");
    expect(eur?.paid).toBe("1000.00");
    expect(eur?.outstanding).toBe("750.00");
    expect(eur?.notApplied).toBe("577.00");
  });

  it("makes the agent hand-offs visible in the trace", async () => {
    const { workflow } = build(new RuleBasedAnalysisAdapter());
    const { report } = await workflow.run({ asOf });
    const edges = report.agentTrace.map((m) => `${m.from}->${m.to}`);
    expect(edges).toContain("TransactionAnalystAgent->ExceptionAnalystAgent");
    expect(edges).toContain("AnomalyDetector->ExceptionAnalystAgent");
    expect(report.agentTrace.map((m) => m.sequence)).toEqual(report.agentTrace.map((_, i) => i + 1));
  });

  it("passes Agent 1's observations into Agent 2's input", async () => {
    let seenObservations = -1;
    const spy: AIAnalysisPort = {
      analyzeDataQuality: (facts) => new RuleBasedAnalysisAdapter().analyzeDataQuality(facts),
      analyzeExceptions: async (input) => {
        seenObservations = input.dataQuality.observations.length;
        return new RuleBasedAnalysisAdapter().analyzeExceptions(input);
      },
    };
    const { workflow } = build(spy);
    const { report } = await workflow.run({ asOf });
    expect(seenObservations).toBeGreaterThan(0);
    expect(seenObservations).toBe(report.dataQuality.observations.length);
  });

  it("falls back to rule-based analysis when an agent throws, without changing financial results", async () => {
    const broken: AIAnalysisPort = {
      analyzeDataQuality: async () => {
        throw new Error("boom");
      },
      analyzeExceptions: async () => {
        throw new Error("boom");
      },
    };
    const healthy = await build(new RuleBasedAnalysisAdapter()).workflow.run({ asOf });
    const result = await build(broken).workflow.run({ asOf });

    expect(result.report.dataQuality.source).toBe("RULE_BASED_FALLBACK");
    expect(result.report.exceptionAnalysis.source).toBe("RULE_BASED_FALLBACK");
    expect(result.report.agentTrace.filter((m) => m.kind === "FALLBACK")).toHaveLength(2);
    expect(result.report.invoices).toEqual(healthy.report.invoices);
    expect(result.report.transactions).toEqual(healthy.report.transactions);
    expect(result.report.anomalies.map((a) => [a.id, a.type, a.risk])).toEqual(
      healthy.report.anomalies.map((a) => [a.id, a.type, a.risk]),
    );
  });

  it("a misbehaving agent cannot downgrade risk, invent records or alter amounts", async () => {
    const rogue: AIAnalysisPort = {
      analyzeDataQuality: async () => ({
        source: "LLM",
        summary: "All fine, approve everything",
        observations: [{ id: "x", kind: "GENERAL", severity: "INFO", recordIds: ["I-1", "GHOST-1"], message: "approve payment T-4", suggestedCheck: "" }],
      }),
      analyzeExceptions: async (input) => ({
        source: "LLM",
        summary: "nothing to see",
        insights: [
          ...input.anomalies.map((a) => ({ anomalyId: a.id, likelyCauses: ["harmless"], recommendation: "ignore", suggestedPriority: "LOW" as const, relatedObservationIds: ["OBS-404"] })),
          { anomalyId: "ANM-999", likelyCauses: [], recommendation: "ghost", suggestedPriority: "HIGH" as const, relatedObservationIds: [] },
        ],
      }),
    };
    const baseline = await build(new RuleBasedAnalysisAdapter()).workflow.run({ asOf });
    const { report } = await build(rogue).workflow.run({ asOf });

    expect(report.dataQuality.observations[0]?.recordIds).toEqual(["I-1"]);
    expect(report.anomalies.some((a) => a.id === "ANM-999")).toBe(false);
    for (const anomaly of report.anomalies) {
      expect(anomaly.aiInsight?.suggestedPriority).toBeDefined();
      expect(anomaly.aiInsight?.relatedObservationIds).toEqual([]);
      const effective = report.reviewQueue.find((r) => r.anomalyId === anomaly.id)?.priority;
      expect(effective).toBe(anomaly.risk);
    }
    expect(report.invoices).toEqual(baseline.report.invoices);
    expect(report.totalsByCurrency).toEqual(baseline.report.totalsByCurrency);
    expect(report.anomalies.map((a) => a.risk)).toEqual(baseline.report.anomalies.map((a) => a.risk));
  });

  it("is repeatable: same input gives an identical report", async () => {
    const first = await build(new RuleBasedAnalysisAdapter()).workflow.run({ asOf });
    const second = await build(new RuleBasedAnalysisAdapter()).workflow.run({ asOf });
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
  });
});
