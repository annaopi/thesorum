import type { Anomaly } from "../../domain/Anomaly.js";
import type { ReconciliationRun } from "../../domain/ReconciliationRun.js";
import type { LocalDate } from "../../domain/value-objects/LocalDate.js";
import type { AgentMessage } from "../dto/AgentMessage.js";
import type { FinancialReport } from "../dto/FinancialReport.js";
import type {
  AIAnalysisPort,
  DataQualityAnalysis,
  ExceptionAnalysis,
} from "../ports/AIAnalysisPort.js";
import type { InvoiceRepository } from "../ports/InvoiceRepository.js";
import type { TransactionRepository } from "../ports/TransactionRepository.js";
import type { DetectAnomalies } from "../usecases/DetectAnomalies.js";
import type { GenerateFinancialReport } from "../usecases/GenerateFinancialReport.js";
import type { ImportInvoices } from "../usecases/ImportInvoices.js";
import type { ImportTransactions } from "../usecases/ImportTransactions.js";
import type { ProfileImportedData } from "../usecases/ProfileImportedData.js";
import type { ReconcileTransactions } from "../usecases/ReconcileTransactions.js";
import { AgentOutputGuard } from "./AgentOutputGuard.js";

const IMPORTER = "ImportService";
const ANALYST = "TransactionAnalystAgent";
const ENGINE = "ReconciliationEngine";
const DETECTOR = "AnomalyDetector";
const EXCEPTION_ANALYST = "ExceptionAnalystAgent";
const REPORTER = "ReportGenerator";

export interface WorkflowDependencies {
  readonly importInvoices: ImportInvoices;
  readonly importTransactions: ImportTransactions;
  readonly profileData: ProfileImportedData;
  readonly reconcile: ReconcileTransactions;
  readonly detectAnomalies: DetectAnomalies;
  readonly generateReport: GenerateFinancialReport;
  readonly invoices: InvoiceRepository;
  readonly transactions: TransactionRepository;
  /** Preferred agent implementation (e.g. LLM-backed). */
  readonly ai: AIAnalysisPort;
  /** Deterministic implementation used when `ai` fails. */
  readonly fallbackAi: AIAnalysisPort;
}

export interface WorkflowResult {
  readonly report: FinancialReport;
  readonly run: ReconciliationRun;
  readonly anomalies: readonly Anomaly[];
}

export interface WorkflowCommand {
  readonly asOf: LocalDate;
  readonly runId?: string;
}

/**
 * Orchestrates the end-to-end flow. State travels as typed values:
 *
 *   import -> facts -> [Agent 1: TransactionAnalyst] -> observations
 *          -> deterministic reconciliation -> anomalies
 *          -> [Agent 2: ExceptionAnalyst(anomalies + observations)] -> insights
 *          -> report
 *
 * Agent 2 depends on Agent 1's output, and both outputs pass through
 * AgentOutputGuard. If an agent fails, the deterministic fallback runs and the
 * trace says so; the financial results never depend on an agent succeeding.
 */
export class ReconciliationWorkflow {
  public constructor(private readonly deps: WorkflowDependencies) {}

  public async run(command: WorkflowCommand): Promise<WorkflowResult> {
    const trace: AgentMessage[] = [];
    const log = (
      from: string,
      to: string,
      kind: AgentMessage["kind"],
      summary: string,
    ): void => {
      trace.push({ sequence: trace.length + 1, from, to, kind, summary });
    };

    // 1. Import & validate (deterministic)
    const invoiceImport = await this.deps.importInvoices.execute();
    const transactionImport = await this.deps.importTransactions.execute();
    log(
      IMPORTER,
      "Workflow",
      "RESULT",
      `Imported ${invoiceImport.imported}/${invoiceImport.recordsRead} invoices and ` +
        `${transactionImport.imported}/${transactionImport.recordsRead} transactions; ` +
        `${invoiceImport.issues.length + transactionImport.issues.length} validation issue(s).`,
    );

    // 2. Agent 1: analyse imported data
    const facts = await this.deps.profileData.execute(invoiceImport, transactionImport);
    log(
      "Workflow",
      ANALYST,
      "REQUEST",
      `Deterministic data-quality facts: ${facts.validationIssues.length} validation issue(s), ` +
        `${facts.duplicateInvoiceGroups.length} duplicate-invoice group(s), ` +
        `${facts.duplicateTransactionGroups.length} duplicate-transaction group(s), ` +
        `${facts.suppliersWithMultipleIbans.length} supplier(s) with several IBANs.`,
    );

    const knownRecordIds = new Set<string>([
      ...(await this.deps.invoices.findAll()).map((invoice) => invoice.id),
      ...(await this.deps.transactions.findAll()).map((tx) => tx.id.value),
      ...facts.validationIssues.flatMap((issue) => (issue.recordId ? [issue.recordId] : [])),
    ]);

    const dataQuality = AgentOutputGuard.sanitizeDataQuality(
      await this.callAgent<DataQualityAnalysis>(
        ANALYST,
        log,
        () => this.deps.ai.analyzeDataQuality(facts),
        () => this.deps.fallbackAi.analyzeDataQuality(facts),
      ),
      knownRecordIds,
    );
    log(
      ANALYST,
      "Workflow",
      "RESULT",
      `${dataQuality.observations.length} observation(s) [source: ${dataQuality.source}].`,
    );

    // 3. Deterministic reconciliation and anomaly detection
    const run = await this.deps.reconcile.execute({
      runId: command.runId ?? `RUN-${command.asOf.value}`,
      asOf: command.asOf,
    });
    log(
      ENGINE,
      DETECTOR,
      "HANDOFF",
      `${run.decisions.length} transaction decision(s), ${run.settlements.length} invoice settlement(s), ` +
        `${run.payments.length} allocation(s).`,
    );

    const anomalies = this.deps.detectAnomalies.execute(run);
    log(
      DETECTOR,
      EXCEPTION_ANALYST,
      "HANDOFF",
      `${anomalies.length} anomaly/anomalies, ${anomalies.filter((a) => a.risk === "HIGH").length} HIGH risk.`,
    );

    // 4. Agent 2: analyse exceptions, using Agent 1's observations
    log(
      ANALYST,
      EXCEPTION_ANALYST,
      "HANDOFF",
      `${dataQuality.observations.length} data-quality observation(s) passed as context.`,
    );

    const exceptionAnalysis = AgentOutputGuard.sanitizeExceptionAnalysis(
      await this.callAgent<ExceptionAnalysis>(
        EXCEPTION_ANALYST,
        log,
        () =>
          this.deps.ai.analyzeExceptions({
            runId: run.id,
            asOf: run.asOf.value,
            anomalies,
            dataQuality,
          }),
        () =>
          this.deps.fallbackAi.analyzeExceptions({
            runId: run.id,
            asOf: run.asOf.value,
            anomalies,
            dataQuality,
          }),
      ),
      anomalies,
      dataQuality.observations,
    );
    log(
      EXCEPTION_ANALYST,
      REPORTER,
      "RESULT",
      `${exceptionAnalysis.insights.length} insight(s) [source: ${exceptionAnalysis.source}].`,
    );

    // 5. Report
    log(REPORTER, "User", "RESULT", "Consolidated report generated for human review.");

    const report = this.deps.generateReport.execute({
      run,
      anomalies,
      invoiceImport,
      transactionImport,
      dataQuality,
      exceptionAnalysis,
      trace,
    });

    return { report, run, anomalies };
  }

  private async callAgent<T extends { source: string; summary: string }>(
    agentName: string,
    log: (from: string, to: string, kind: AgentMessage["kind"], summary: string) => void,
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await primary();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      log(
        agentName,
        "Workflow",
        "FALLBACK",
        `Agent call failed (${reason}); using the deterministic rule-based analysis instead.`,
      );
      const result = await fallback();
      return { ...result, source: "RULE_BASED_FALLBACK" };
    }
  }
}
