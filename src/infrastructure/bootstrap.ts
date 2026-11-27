import { DetectAnomalies } from "../application/usecases/DetectAnomalies.js";
import { GenerateFinancialReport } from "../application/usecases/GenerateFinancialReport.js";
import { ImportInvoices } from "../application/usecases/ImportInvoices.js";
import { ImportTransactions } from "../application/usecases/ImportTransactions.js";
import { ProfileImportedData } from "../application/usecases/ProfileImportedData.js";
import { ReconcileTransactions } from "../application/usecases/ReconcileTransactions.js";
import type { AIAnalysisPort } from "../application/ports/AIAnalysisPort.js";
import { ReconciliationWorkflow } from "../application/workflow/ReconciliationWorkflow.js";
import { CsvInvoiceSource } from "./csv/CsvInvoiceSource.js";
import { CsvTransactionSource } from "./csv/CsvTransactionSource.js";
import { LlmAnalysisAdapter } from "./ai/LlmAnalysisAdapter.js";
import { createLlmClient, resolveLlmConfig } from "./ai/LlmConfig.js";
import { RuleBasedAnalysisAdapter } from "./ai/RuleBasedAnalysisAdapter.js";
import { InMemoryInvoiceRepository } from "./persistence/InMemoryInvoiceRepository.js";
import { InMemoryPaymentRepository } from "./persistence/InMemoryPaymentRepository.js";
import { InMemoryTransactionRepository } from "./persistence/InMemoryTransactionRepository.js";

export interface AppConfig {
  readonly invoicesPath: string;
  readonly transactionsPath: string;
  /** "demo" forces rule-based agents; "auto" uses the LLM when an API key is set. */
  readonly aiMode: "auto" | "demo";
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchFn?: typeof fetch;
  /** Overrides the AI adapter entirely (used by tests). */
  readonly aiOverride?: AIAnalysisPort;
}

export interface Application {
  readonly workflow: ReconciliationWorkflow;
  readonly aiMode: "LLM" | "DEMO";
  /** e.g. "openai / my-model" when aiMode is LLM. */
  readonly aiDescription?: string;
  /** Why LLM mode was not activated although it looked configured (never contains secrets). */
  readonly aiWarning?: string;
}

/** Composition root: wires ports to adapters. The only place that knows concrete classes. */
export function createApplication(config: AppConfig): Application {
  const invoices = new InMemoryInvoiceRepository();
  const transactions = new InMemoryTransactionRepository();
  const payments = new InMemoryPaymentRepository();

  const fallbackAi = new RuleBasedAnalysisAdapter();

  let ai: AIAnalysisPort = config.aiOverride ?? fallbackAi;
  let aiMode: Application["aiMode"] = "DEMO";
  let aiDescription: string | undefined;
  let aiWarning: string | undefined;

  if (config.aiOverride === undefined && config.aiMode === "auto") {
    const resolved = resolveLlmConfig(config.env);

    if (resolved.config) {
      const llm = resolved.config;
      ai = new LlmAnalysisAdapter(createLlmClient(llm, config.fetchFn), {
        maxTokens: llm.maxTokens,
        temperature: llm.temperature,
      });
      aiMode = "LLM";
      aiDescription = `${llm.provider} / ${llm.model}`;
    } else {
      aiWarning = resolved.warning;
    }
  }

  const workflow = new ReconciliationWorkflow({
    importInvoices: new ImportInvoices(new CsvInvoiceSource(config.invoicesPath), invoices),
    importTransactions: new ImportTransactions(
      new CsvTransactionSource(config.transactionsPath),
      transactions,
    ),
    profileData: new ProfileImportedData(invoices, transactions),
    reconcile: new ReconcileTransactions(invoices, transactions, payments),
    detectAnomalies: new DetectAnomalies(),
    generateReport: new GenerateFinancialReport(),
    invoices,
    transactions,
    ai,
    fallbackAi,
  });

  return {
    workflow,
    aiMode,
    ...(aiDescription !== undefined ? { aiDescription } : {}),
    ...(aiWarning !== undefined ? { aiWarning } : {}),
  };
}
