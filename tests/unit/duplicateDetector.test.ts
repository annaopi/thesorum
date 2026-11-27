import { describe, expect, it } from "vitest";
import { DuplicateDetector } from "../../src/domain/services/DuplicateDetector.js";
import { IBANS, makeInvoice, makeTx } from "../helpers/builders.js";

describe("DuplicateDetector", () => {
  it("groups invoices with the same normalised number and supplier", () => {
    const groups = DuplicateDetector.findDuplicateInvoices([
      makeInvoice({ id: "I-2", number: " inv-1 ", issue: "2026-10-09" }),
      makeInvoice({ id: "I-1", number: "INV-1", issue: "2026-10-01" }),
      makeInvoice({ id: "I-3", number: "INV-3" }),
    ]);
    expect(groups).toEqual([{ primaryInvoiceId: "I-1", duplicateInvoiceIds: ["I-2"], detailsConflict: false }]);
  });

  it("flags conflicting amount or IBAN", () => {
    const amount = DuplicateDetector.findDuplicateInvoices([
      makeInvoice({ id: "I-1" }),
      makeInvoice({ id: "I-2", amount: "1500.00" }),
    ]);
    const iban = DuplicateDetector.findDuplicateInvoices([
      makeInvoice({ id: "I-1" }),
      makeInvoice({ id: "I-2", iban: IBANS.other }),
    ]);
    expect(amount[0]?.detailsConflict).toBe(true);
    expect(iban[0]?.detailsConflict).toBe(true);
  });

  it("does not treat the same invoice number from different suppliers as duplicates", () => {
    expect(
      DuplicateDetector.findDuplicateInvoices([
        makeInvoice({ id: "I-1", supplier: "Acme GmbH" }),
        makeInvoice({ id: "I-2", supplier: "Beta Ltd" }),
      ]),
    ).toHaveLength(0);
  });

  it("groups identical transactions only when every key field is equal", () => {
    const groups = DuplicateDetector.findDuplicateTransactions([
      makeTx({ id: "T-2" }),
      makeTx({ id: "T-1" }),
      makeTx({ id: "T-3", date: "2026-10-16" }),
      makeTx({ id: "T-4", amount: "999.99" }),
    ]);
    expect(groups).toEqual([{ primaryTransactionId: "T-1", duplicateTransactionIds: ["T-2"] }]);
  });
});
