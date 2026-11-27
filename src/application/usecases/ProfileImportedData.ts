import { DuplicateDetector } from "../../domain/services/DuplicateDetector.js";
import { canonicalName } from "../../domain/services/DomainUtils.js";
import type { DataQualityFacts } from "../dto/DataQualityFacts.js";
import type { ImportResult } from "../dto/ImportResult.js";
import type { InvoiceRepository } from "../ports/InvoiceRepository.js";
import type { TransactionRepository } from "../ports/TransactionRepository.js";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministically profiles the imported data. The resulting facts are what
 * the Transaction Analyst agent receives; no AI is used here.
 */
export class ProfileImportedData {
  public constructor(
    private readonly invoices: InvoiceRepository,
    private readonly transactions: TransactionRepository,
  ) {}

  public async execute(
    invoiceImport: ImportResult,
    transactionImport: ImportResult,
  ): Promise<DataQualityFacts> {
    const invoices = await this.invoices.findAll();
    const transactions = await this.transactions.findAll();

    const ibansBySupplier = new Map<
      string,
      { name: string; ibans: Set<string>; invoiceIds: string[] }
    >();
    const suppliersByIban = new Map<
      string,
      { names: Map<string, string>; invoiceIds: string[] }
    >();

    for (const invoice of invoices) {
      const supplierKey = canonicalName(invoice.supplierName);
      const bySupplier = ibansBySupplier.get(supplierKey) ?? {
        name: invoice.supplierName,
        ibans: new Set<string>(),
        invoiceIds: [],
      };
      bySupplier.ibans.add(invoice.expectedIban.value);
      bySupplier.invoiceIds.push(invoice.id);
      ibansBySupplier.set(supplierKey, bySupplier);

      const byIban = suppliersByIban.get(invoice.expectedIban.value) ?? {
        names: new Map<string, string>(),
        invoiceIds: [],
      };
      byIban.names.set(supplierKey, invoice.supplierName);
      byIban.invoiceIds.push(invoice.id);
      suppliersByIban.set(invoice.expectedIban.value, byIban);
    }

    return {
      invoiceCount: invoices.length,
      transactionCount: transactions.length,
      validationIssues: [...invoiceImport.issues, ...transactionImport.issues],
      duplicateInvoiceGroups: DuplicateDetector.findDuplicateInvoices(invoices),
      duplicateTransactionGroups: DuplicateDetector.findDuplicateTransactions(transactions),
      transactionsWithoutReference: transactions
        .filter((tx) => tx.reference === "")
        .map((tx) => tx.id.value)
        .sort(compareText),
      suppliersWithMultipleIbans: [...ibansBySupplier.values()]
        .filter((entry) => entry.ibans.size > 1)
        .map((entry) => ({
          supplierName: entry.name,
          ibans: [...entry.ibans].sort(compareText),
          invoiceIds: [...entry.invoiceIds].sort(compareText),
        }))
        .sort((a, b) => compareText(a.supplierName, b.supplierName)),
      ibansSharedBySuppliers: [...suppliersByIban.entries()]
        .filter(([, entry]) => entry.names.size > 1)
        .map(([iban, entry]) => ({
          iban,
          supplierNames: [...entry.names.values()].sort(compareText),
          invoiceIds: [...entry.invoiceIds].sort(compareText),
        }))
        .sort((a, b) => compareText(a.iban, b.iban)),
    };
  }
}
