import { Invoice } from "../../domain/entities/Invoice.js";
import { Currency } from "../../domain/value-objects/Currency.js";
import { Iban } from "../../domain/value-objects/Iban.js";
import { LocalDate } from "../../domain/value-objects/LocalDate.js";
import { Money } from "../../domain/value-objects/Money.js";
import type { RawRecord } from "../dto/RawRecord.js";
import type { ValidationIssue, ValidationResult } from "../dto/ValidationIssue.js";
import { RecordParser } from "./RecordParser.js";

/**
 * Validates and normalises untrusted invoice rows into Invoice entities.
 * Expected columns: id, invoice_number, supplier_name, amount, currency,
 * iban, issue_date, due_date.
 */
export class ValidateInvoices {
  public execute(records: readonly RawRecord[]): ValidationResult<Invoice> {
    const issues: ValidationIssue[] = [];
    const valid: Invoice[] = [];
    const firstRowById = new Map<string, number>();

    for (const record of records) {
      const parser = new RecordParser("INVOICE", record, issues);
      const issuesBefore = issues.length;

      const id = parser.required("id");
      const invoiceNumber = parser.required("invoice_number");
      const supplierName = parser.required("supplier_name");
      const amountText = parser.required("amount");
      const currencyText = parser.required("currency");
      const ibanText = parser.required("iban");
      const issueText = parser.required("issue_date");
      const dueText = parser.required("due_date");

      const currency =
        currencyText !== undefined
          ? parser.attempt("currency", () => Currency.of(currencyText.toUpperCase()))
          : undefined;
      const amount =
        amountText !== undefined && currency !== undefined
          ? parser.attempt("amount", () => Money.fromDecimalString(amountText, currency))
          : undefined;
      const iban =
        ibanText !== undefined ? parser.attempt("iban", () => Iban.create(ibanText)) : undefined;
      const issueDate =
        issueText !== undefined
          ? parser.attempt("issue_date", () => LocalDate.create(issueText))
          : undefined;
      const dueDate =
        dueText !== undefined
          ? parser.attempt("due_date", () => LocalDate.create(dueText))
          : undefined;

      if (
        issues.length > issuesBefore ||
        id === undefined ||
        invoiceNumber === undefined ||
        supplierName === undefined ||
        amount === undefined ||
        iban === undefined ||
        issueDate === undefined ||
        dueDate === undefined
      ) {
        continue;
      }

      const invoice = parser.attempt(null, () =>
        Invoice.create({
          id,
          invoiceNumber,
          supplierName,
          expectedAmount: amount,
          expectedIban: iban,
          issueDate,
          dueDate,
        }),
      );

      if (invoice === undefined) {
        continue;
      }

      const firstRow = firstRowById.get(invoice.id);

      if (firstRow !== undefined) {
        parser.fail(
          "DUPLICATE_ID",
          "id",
          `Duplicate invoice ID ${invoice.id} (first seen on row ${firstRow}); row ignored.`,
        );
        continue;
      }

      firstRowById.set(invoice.id, record.rowNumber);
      valid.push(invoice);
    }

    return { rowsRead: records.length, valid, issues };
  }
}
