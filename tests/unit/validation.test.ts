import { describe, expect, it } from "vitest";
import type { RawRecord } from "../../src/application/dto/RawRecord.js";
import { ValidateInvoices } from "../../src/application/usecases/ValidateInvoices.js";
import { ValidateTransactions } from "../../src/application/usecases/ValidateTransactions.js";
import { IBANS } from "../helpers/builders.js";

function row(rowNumber: number, fields: Record<string, string>): RawRecord {
  return { rowNumber, fields };
}

const goodInvoice = {
  id: "I-1",
  invoice_number: "INV-1",
  supplier_name: "Acme GmbH",
  amount: "1200.00",
  currency: "eur",
  iban: "DE89 3704 0044 0532 0130 00",
  issue_date: "2026-10-01",
  due_date: "2026-10-31",
};

const goodTx = {
  id: "T-1",
  booking_date: "2026-10-15",
  amount: "1200.00",
  currency: "EUR",
  beneficiary_name: "Acme GmbH",
  beneficiary_iban: IBANS.acme,
  reference: "INV-1",
};

describe("ValidateInvoices", () => {
  const validator = new ValidateInvoices();

  it("normalises and accepts a valid row", () => {
    const result = validator.execute([row(1, goodInvoice)]);
    expect(result.issues).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.expectedIban.value).toBe(IBANS.acme);
    expect(result.valid[0]?.expectedAmount.currency.code).toBe("EUR");
  });

  it("reports every problem of a row, not just the first", () => {
    const result = validator.execute([row(3, { ...goodInvoice, iban: "XX00", issue_date: "2026-13-01", currency: "ABC" })]);
    expect(result.valid).toHaveLength(0);
    const fields = result.issues.map((issue) => issue.field);
    expect(fields).toContain("iban");
    expect(fields).toContain("issue_date");
    expect(fields).toContain("currency");
    expect(result.issues[0]?.rowNumber).toBe(3);
    expect(result.issues[0]?.recordId).toBe("I-1");
  });

  it("rejects missing fields, bad amounts and inconsistent dates", () => {
    const result = validator.execute([
      row(1, { ...goodInvoice, supplier_name: "  " }),
      row(2, { ...goodInvoice, id: "I-2", amount: "1,200.00" }),
      row(3, { ...goodInvoice, id: "I-3", amount: "-5.00" }),
      row(4, { ...goodInvoice, id: "I-4", due_date: "2026-09-01" }),
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.issues.map((i) => i.code)).toEqual([
      "MISSING_FIELD",
      "INVALID_MONEY",
      "INVALID_INVOICE",
      "INVALID_INVOICE",
    ]);
  });

  it("keeps the first row of a duplicate ID", () => {
    const result = validator.execute([row(1, goodInvoice), row(2, { ...goodInvoice, amount: "5.00" })]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.expectedAmount.toDecimalString()).toBe("1200.00");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("DUPLICATE_ID");
  });
});

describe("ValidateTransactions", () => {
  const validator = new ValidateTransactions();

  it("accepts a valid row and treats the reference as optional", () => {
    const { reference: _reference, ...withoutReference } = goodTx;
    const result = validator.execute([row(1, goodTx), row(2, { ...withoutReference, id: "T-2" })]);
    expect(result.issues).toEqual([]);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[1]?.reference).toBe("");
  });

  it("rejects bad IBAN, zero amount, bad date and bad id", () => {
    const result = validator.execute([
      row(1, { ...goodTx, beneficiary_iban: "DE00370400440532013000" }),
      row(2, { ...goodTx, id: "T-2", amount: "0.00" }),
      row(3, { ...goodTx, id: "T-3", booking_date: "2026-02-30" }),
      row(4, { ...goodTx, id: "bad id" }),
    ]);
    expect(result.valid).toHaveLength(0);
    expect(result.issues.map((i) => i.code)).toEqual([
      "INVALID_IBAN",
      "INVALID_TRANSACTION",
      "INVALID_DATE",
      "INVALID_TRANSACTION",
    ]);
  });

  it("ignores later rows that reuse a transaction ID", () => {
    const result = validator.execute([row(1, goodTx), row(2, goodTx)]);
    expect(result.valid).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("DUPLICATE_ID");
    expect(result.issues[0]?.message).toContain("row 1");
  });

  it("does not throw on non-string input values", () => {
    const hostile = { ...goodTx, amount: undefined as unknown as string };
    const result = validator.execute([row(1, hostile)]);
    expect(result.valid).toHaveLength(0);
    expect(result.issues[0]?.code).toBe("MISSING_FIELD");
  });
});
