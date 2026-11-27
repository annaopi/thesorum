import { describe, expect, it } from "vitest";
import { MatchingService } from "../../src/domain/services/MatchingService.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";
import { IBANS, makeInvoice, makeRun, makeTx } from "../helpers/builders.js";

describe("MatchingService - the six core scenarios", () => {
  it("1. full payment: matches and settles the invoice", () => {
    const run = makeRun([makeInvoice()], [makeTx()]);
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("MATCHED");
    expect(decision?.reason).toBe("REFERENCE_AND_IBAN_MATCH");
    expect(decision?.invoiceId).toBe("I-1");
    expect(decision?.explanation.length).toBeGreaterThan(10);
    expect(run.settlementFor("I-1")?.status).toBe("PAID");
    expect(run.payments).toHaveLength(1);
  });

  it("2. partial payment: PARTIALLY_MATCHED with the remainder outstanding", () => {
    const run = makeRun([makeInvoice()], [makeTx({ amount: "400.00" })]);
    expect(run.decisionFor("T-1")?.status).toBe("PARTIALLY_MATCHED");
    const settlement = run.settlementFor("I-1");
    expect(settlement?.status).toBe("PARTIALLY_PAID");
    expect(settlement?.outstandingAmount.toDecimalString()).toBe("600.00");
  });

  it("3. amount mismatch above the invoice: overpayment is applied up to the invoice total only", () => {
    const run = makeRun([makeInvoice()], [makeTx({ amount: "1200.00" })]);
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("OVERPAYMENT");
    expect(decision?.allocatedAmount.toDecimalString()).toBe("1000.00");
    expect(decision?.unallocatedAmount.toDecimalString()).toBe("200.00");
    const settlement = run.settlementFor("I-1");
    expect(settlement?.status).toBe("OVERPAID");
    expect(settlement?.paidAmount.toDecimalString()).toBe("1000.00");
    expect(settlement?.overpaidAmount.toDecimalString()).toBe("200.00");
  });

  it("4. duplicate invoice: the copy is excluded and payment goes to the primary", () => {
    const run = makeRun(
      [makeInvoice({ id: "I-1", issue: "2026-10-01" }), makeInvoice({ id: "I-2", number: "inv-1", issue: "2026-10-05" })],
      [makeTx()],
    );
    expect(run.settlementFor("I-1")?.status).toBe("PAID");
    expect(run.settlementFor("I-2")?.status).toBe("DUPLICATE");
    expect(run.settlementFor("I-2")?.duplicateOfInvoiceId).toBe("I-1");
    expect(run.settlementFor("I-2")?.outstandingAmount.isZero()).toBe(true);
    expect(run.duplicateInvoices).toHaveLength(1);
  });

  it("5. unknown payment: UNMATCHED and nothing applied", () => {
    const run = makeRun(
      [makeInvoice()],
      [makeTx({ reference: "Consulting", iban: IBANS.unknown, name: "Stranger Ltd" })],
    );
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("UNMATCHED");
    expect(decision?.reason).toBe("NO_CANDIDATE_INVOICE");
    expect(decision?.invoiceId).toBeNull();
    expect(decision?.allocatedAmount.isZero()).toBe(true);
    expect(run.settlementFor("I-1")?.status).toBe("UNPAID");
    expect(run.payments).toHaveLength(0);
  });

  it("6. IBAN change: held for review, not applied, invoice flagged", () => {
    const run = makeRun([makeInvoice()], [makeTx({ iban: IBANS.other })]);
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("REQUIRES_REVIEW");
    expect(decision?.reason).toBe("IBAN_MISMATCH");
    expect(decision?.invoiceId).toBe("I-1");
    expect(decision?.allocatedAmount.isZero()).toBe(true);
    const settlement = run.settlementFor("I-1");
    expect(settlement?.status).toBe("REQUIRES_REVIEW");
    expect(settlement?.paidAmount.isZero()).toBe(true);
    expect(settlement?.heldTransactionIds).toEqual(["T-1"]);
  });
});

describe("MatchingService - further rules", () => {
  it("supports multiple payments for one invoice", () => {
    const run = makeRun(
      [makeInvoice()],
      [makeTx({ id: "T-1", amount: "600.00", date: "2026-10-10" }), makeTx({ id: "T-2", amount: "400.00", date: "2026-10-20" })],
    );
    expect(run.decisionFor("T-1")?.status).toBe("PARTIALLY_MATCHED");
    expect(run.decisionFor("T-2")?.status).toBe("MATCHED");
    expect(run.settlementFor("I-1")?.status).toBe("PAID");
    expect(run.settlementFor("I-1")?.paymentTransactionIds).toEqual(["T-1", "T-2"]);
    expect(run.payments).toHaveLength(2);
  });

  it("uses exact integer arithmetic (0.10 + 0.20 settles 0.30)", () => {
    const run = makeRun(
      [makeInvoice({ amount: "0.30" })],
      [makeTx({ id: "T-1", amount: "0.10", date: "2026-10-10" }), makeTx({ id: "T-2", amount: "0.20", date: "2026-10-11" })],
    );
    expect(run.settlementFor("I-1")?.status).toBe("PAID");
    expect(run.settlementFor("I-1")?.outstandingAmount.isZero()).toBe(true);
  });

  it("a second payment on a settled invoice is entirely excess", () => {
    const run = makeRun(
      [makeInvoice()],
      [makeTx({ id: "T-1", date: "2026-10-10" }), makeTx({ id: "T-2", date: "2026-10-12" })],
    );
    const second = run.decisionFor("T-2");
    expect(second?.status).toBe("OVERPAYMENT");
    expect(second?.allocatedAmount.isZero()).toBe(true);
    expect(second?.unallocatedAmount.toDecimalString()).toBe("1000.00");
    expect(run.settlementFor("I-1")?.status).toBe("OVERPAID");
  });

  it("identical transactions: only the first is applied, the copy needs review", () => {
    const run = makeRun([makeInvoice()], [makeTx({ id: "T-1" }), makeTx({ id: "T-2" })]);
    expect(run.decisionFor("T-1")?.status).toBe("MATCHED");
    expect(run.decisionFor("T-2")?.reason).toBe("DUPLICATE_TRANSACTION");
    expect(run.decisionFor("T-2")?.status).toBe("REQUIRES_REVIEW");
    const settlement = run.settlementFor("I-1");
    expect(settlement?.status).toBe("PAID");
    expect(settlement?.paidAmount.toDecimalString()).toBe("1000.00");
    expect(run.duplicateTransactions).toHaveLength(1);
  });

  it("does not match INV-1 against a reference containing INV-10", () => {
    const run = makeRun([makeInvoice()], [makeTx({ reference: "INV-10", iban: IBANS.unknown, name: "Other" })]);
    expect(run.decisionFor("T-1")?.status).toBe("UNMATCHED");
  });

  it("matches without a reference only when IBAN, name, currency and exact amount agree", () => {
    const run = makeRun([makeInvoice()], [makeTx({ reference: "" })]);
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("MATCHED");
    expect(decision?.reason).toBe("FIELD_MATCH_WITHOUT_REFERENCE");
  });

  it("refuses a reference-less match when the amount differs (insufficient evidence)", () => {
    const run = makeRun([makeInvoice()], [makeTx({ reference: "", amount: "400.00" })]);
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("UNMATCHED");
    expect(decision?.candidateInvoiceIds).toEqual(["I-1"]);
    expect(run.settlementFor("I-1")?.status).toBe("UNPAID");
  });

  it("refuses a reference-less match when the name differs", () => {
    const run = makeRun([makeInvoice()], [makeTx({ reference: "", name: "Somebody Else" })]);
    expect(run.decisionFor("T-1")?.status).toBe("UNMATCHED");
  });

  it("refuses a reference-less match booked before the invoice was issued", () => {
    const run = makeRun([makeInvoice()], [makeTx({ reference: "", date: "2026-09-01" })]);
    expect(run.decisionFor("T-1")?.status).toBe("UNMATCHED");
  });

  it("flags a reference-less payment as ambiguous when two invoices fit equally", () => {
    const run = makeRun(
      [makeInvoice({ id: "I-1", number: "INV-1" }), makeInvoice({ id: "I-2", number: "INV-2" })],
      [makeTx({ reference: "" })],
    );
    const decision = run.decisionFor("T-1");
    expect(decision?.status).toBe("REQUIRES_REVIEW");
    expect(decision?.reason).toBe("AMBIGUOUS_CANDIDATES");
    expect(decision?.candidateInvoiceIds).toEqual(["I-1", "I-2"]);
    expect(run.payments).toHaveLength(0);
  });

  it("flags a reference naming two invoices as ambiguous and applies nothing", () => {
    const run = makeRun(
      [makeInvoice({ id: "I-1", number: "INV-1", amount: "700.00" }), makeInvoice({ id: "I-2", number: "INV-2", amount: "300.00" })],
      [makeTx({ reference: "INV-1 and INV-2" })],
    );
    expect(run.decisionFor("T-1")?.reason).toBe("AMBIGUOUS_CANDIDATES");
    expect(run.settlementFor("I-1")?.status).toBe("REQUIRES_REVIEW");
    expect(run.settlementFor("I-2")?.status).toBe("REQUIRES_REVIEW");
    expect(run.payments).toHaveLength(0);
  });

  it("uses the beneficiary IBAN to pick between identical invoice numbers of different suppliers", () => {
    const run = makeRun(
      [
        makeInvoice({ id: "I-1", number: "INV-1", supplier: "Acme GmbH", iban: IBANS.acme }),
        makeInvoice({ id: "I-2", number: "INV-1", supplier: "Beta Ltd", iban: IBANS.beta }),
      ],
      [makeTx({ iban: IBANS.beta, name: "Beta Ltd" })],
    );
    expect(run.decisionFor("T-1")?.invoiceId).toBe("I-2");
    expect(run.settlementFor("I-2")?.status).toBe("PAID");
    expect(run.settlementFor("I-1")?.status).toBe("UNPAID");
  });

  it("holds a payment in another currency instead of converting", () => {
    const run = makeRun([makeInvoice()], [makeTx({ currency: "USD" })]);
    expect(run.decisionFor("T-1")?.reason).toBe("CURRENCY_MISMATCH");
    expect(run.decisionFor("T-1")?.status).toBe("REQUIRES_REVIEW");
    expect(run.settlementFor("I-1")?.paidAmount.isZero()).toBe(true);
  });

  it("tracks overdue status against the reporting date", () => {
    const before = makeRun([makeInvoice()], [], "2026-10-31");
    const after = makeRun([makeInvoice()], [], "2026-11-01");
    expect(before.settlementFor("I-1")?.isOverdue).toBe(false);
    expect(after.settlementFor("I-1")?.isOverdue).toBe(true);
  });

  it("is deterministic and independent of input order", () => {
    const invoices = [makeInvoice({ id: "I-1", number: "INV-1" }), makeInvoice({ id: "I-2", number: "INV-2", amount: "500.00" })];
    const txs = [
      makeTx({ id: "T-1", amount: "300.00", reference: "INV-2", date: "2026-10-05" }),
      makeTx({ id: "T-2", amount: "200.00", reference: "INV-2", date: "2026-10-06" }),
      makeTx({ id: "T-3", reference: "INV-1", date: "2026-10-07" }),
    ];
    const forward = makeRun(invoices, txs);
    const backward = makeRun(invoices, [...txs].reverse());
    for (const id of ["T-1", "T-2", "T-3"]) {
      expect(backward.decisionFor(id)?.status).toBe(forward.decisionFor(id)?.status);
      expect(backward.decisionFor(id)?.explanation).toBe(forward.decisionFor(id)?.explanation);
    }
    expect(backward.settlementFor("I-2")?.status).toBe("PAID");
  });

  it("returns one decision per transaction in input order", () => {
    const outcome = MatchingService.match({
      invoices: [makeInvoice()],
      transactions: [makeTx({ id: "T-2", date: "2026-10-20" }), makeTx({ id: "T-1", date: "2026-10-10", reference: "x", iban: IBANS.unknown, name: "Z" })],
      asOf: LocalDate.create("2026-12-01"),
    });
    expect(outcome.decisions.map((d) => d.transactionId)).toEqual(["T-2", "T-1"]);
  });
});
