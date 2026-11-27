import type {
  DuplicateInvoiceGroup,
  DuplicateTransactionGroup,
} from "../../domain/ReconciliationResult.js";
import type { ValidationIssue } from "./ValidationIssue.js";

/** Deterministic facts about the imported data; the input of the Transaction Analyst agent. */
export interface DataQualityFacts {
  readonly invoiceCount: number;
  readonly transactionCount: number;
  readonly validationIssues: readonly ValidationIssue[];
  readonly duplicateInvoiceGroups: readonly DuplicateInvoiceGroup[];
  readonly duplicateTransactionGroups: readonly DuplicateTransactionGroup[];
  readonly transactionsWithoutReference: readonly string[];
  readonly suppliersWithMultipleIbans: readonly {
    readonly supplierName: string;
    readonly ibans: readonly string[];
    readonly invoiceIds: readonly string[];
  }[];
  readonly ibansSharedBySuppliers: readonly {
    readonly iban: string;
    readonly supplierNames: readonly string[];
    readonly invoiceIds: readonly string[];
  }[];
}
