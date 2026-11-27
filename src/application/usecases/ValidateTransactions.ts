import { Transaction } from "../../domain/entities/Transaction.js";
import { Currency } from "../../domain/value-objects/Currency.js";
import { Iban } from "../../domain/value-objects/Iban.js";
import { LocalDate } from "../../domain/value-objects/LocalDate.js";
import { Money } from "../../domain/value-objects/Money.js";
import { TransactionId } from "../../domain/value-objects/TransactionId.js";
import type { RawRecord } from "../dto/RawRecord.js";
import type { ValidationIssue, ValidationResult } from "../dto/ValidationIssue.js";
import { RecordParser } from "./RecordParser.js";

/**
 * Validates and normalises untrusted bank-transaction rows into Transaction entities.
 * Expected columns: id, booking_date, amount, currency, beneficiary_name,
 * beneficiary_iban, reference (optional).
 */
export class ValidateTransactions {
  public execute(records: readonly RawRecord[]): ValidationResult<Transaction> {
    const issues: ValidationIssue[] = [];
    const valid: Transaction[] = [];
    const firstRowById = new Map<string, number>();

    for (const record of records) {
      const parser = new RecordParser("TRANSACTION", record, issues);
      const issuesBefore = issues.length;

      const idText = parser.required("id");
      const dateText = parser.required("booking_date");
      const amountText = parser.required("amount");
      const currencyText = parser.required("currency");
      const beneficiaryName = parser.required("beneficiary_name");
      const ibanText = parser.required("beneficiary_iban");
      const reference = parser.optional("reference");

      const id =
        idText !== undefined
          ? parser.attempt("id", () => TransactionId.create(idText))
          : undefined;
      const bookingDate =
        dateText !== undefined
          ? parser.attempt("booking_date", () => LocalDate.create(dateText))
          : undefined;
      const currency =
        currencyText !== undefined
          ? parser.attempt("currency", () => Currency.of(currencyText.toUpperCase()))
          : undefined;
      const amount =
        amountText !== undefined && currency !== undefined
          ? parser.attempt("amount", () => Money.fromDecimalString(amountText, currency))
          : undefined;
      const iban =
        ibanText !== undefined
          ? parser.attempt("beneficiary_iban", () => Iban.create(ibanText))
          : undefined;

      if (
        issues.length > issuesBefore ||
        id === undefined ||
        bookingDate === undefined ||
        amount === undefined ||
        iban === undefined ||
        beneficiaryName === undefined
      ) {
        continue;
      }

      const transaction = parser.attempt(null, () =>
        Transaction.create({
          id,
          bookingDate,
          amount,
          beneficiaryName,
          beneficiaryIban: iban,
          reference,
        }),
      );

      if (transaction === undefined) {
        continue;
      }

      const firstRow = firstRowById.get(transaction.id.value);

      if (firstRow !== undefined) {
        parser.fail(
          "DUPLICATE_ID",
          "id",
          `Duplicate transaction ID ${transaction.id.value} (first seen on row ${firstRow}); row ignored.`,
        );
        continue;
      }

      firstRowById.set(transaction.id.value, record.rowNumber);
      valid.push(transaction);
    }

    return { rowsRead: records.length, valid, issues };
  }
}
