import type { Invoice } from "../entities/Invoice.js";
import type { Transaction } from "../entities/Transaction.js";
import type {
  DuplicateInvoiceGroup,
  DuplicateTransactionGroup,
} from "../ReconciliationResult.js";
import { canonicalName } from "./DomainUtils.js";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);

    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

/**
 * Deterministic duplicate detection.
 *  - Invoices are duplicates when supplier and invoice number are the same
 *    (after normalisation) but the invoice IDs differ.
 *  - Transactions are duplicates when beneficiary IBAN, amount, currency,
 *    booking date and reference are all identical but the IDs differ.
 * The earliest record (by issue/booking date, then ID) is the "primary";
 * the others are reported as duplicates.
 */
export class DuplicateDetector {
  public static findDuplicateInvoices(
    invoices: readonly Invoice[],
  ): DuplicateInvoiceGroup[] {
    const groups = groupBy(
      invoices,
      (invoice) =>
        `${invoice.normalizedInvoiceNumber}|${canonicalName(invoice.supplierName)}`,
    );

    const result: DuplicateInvoiceGroup[] = [];

    for (const members of groups.values()) {
      if (members.length < 2) {
        continue;
      }

      const ordered = [...members].sort(
        (a, b) =>
          compareText(a.issueDate.value, b.issueDate.value) ||
          compareText(a.id, b.id),
      );
      const [primary, ...duplicates] = ordered;

      const detailsConflict = duplicates.some(
        (copy) =>
          !copy.expectedAmount.equals(primary.expectedAmount) ||
          !copy.expectedIban.equals(primary.expectedIban),
      );

      result.push({
        primaryInvoiceId: primary.id,
        duplicateInvoiceIds: duplicates.map((copy) => copy.id),
        detailsConflict,
      });
    }

    return result.sort((a, b) => compareText(a.primaryInvoiceId, b.primaryInvoiceId));
  }

  public static findDuplicateTransactions(
    transactions: readonly Transaction[],
  ): DuplicateTransactionGroup[] {
    const groups = groupBy(
      transactions,
      (tx) =>
        [
          tx.beneficiaryIban.value,
          tx.amount.currency.code,
          String(tx.amount.amountMinorUnits),
          tx.bookingDate.value,
          tx.normalizedReference,
        ].join("|"),
    );

    const result: DuplicateTransactionGroup[] = [];

    for (const members of groups.values()) {
      if (members.length < 2) {
        continue;
      }

      const ordered = [...members].sort((a, b) =>
        compareText(a.id.value, b.id.value),
      );
      const [primary, ...duplicates] = ordered;

      result.push({
        primaryTransactionId: primary.id.value,
        duplicateTransactionIds: duplicates.map((copy) => copy.id.value),
      });
    }

    return result.sort((a, b) =>
      compareText(a.primaryTransactionId, b.primaryTransactionId),
    );
  }
}