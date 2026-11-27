import { describe, expect, it } from "vitest";
import type { Anomaly, AnomalyType } from "../../src/domain/Anomaly.js";
import { DetectAnomalies } from "../../src/application/usecases/DetectAnomalies.js";
import { IBANS, makeInvoice, makeRun, makeTx } from "../helpers/builders.js";
import type { Invoice } from "../../src/domain/entities/Invoice.js";
import type { Transaction } from "../../src/domain/entities/Transaction.js";

function detect(invoices: Invoice[], txs: Transaction[], asOf = "2026-12-01"): readonly Anomaly[] {
  return new DetectAnomalies().execute(makeRun(invoices, txs, asOf));
}

function find(anomalies: readonly Anomaly[], type: AnomalyType): Anomaly | undefined {
  return anomalies.find((a) => a.type === type);
}

describe("DetectAnomalies", () => {
  it("reports nothing for a clean, fully paid invoice", () => {
    expect(detect([makeInvoice()], [makeTx()])).toHaveLength(0);
  });

  it("IBAN change: HIGH, traceable to the transaction and the invoice, with values", () => {
    const anomaly = find(detect([makeInvoice()], [makeTx({ iban: IBANS.other })]), "IBAN_MISMATCH");
    expect(anomaly?.risk).toBe("HIGH");
    expect(anomaly?.recordType).toBe("TRANSACTION");
    expect(anomaly?.recordId).toBe("T-1");
    expect(anomaly?.relatedRecordIds).toEqual(["I-1"]);
    expect(anomaly?.values["expectedIban"]).toBe(IBANS.acme);
    expect(anomaly?.values["actualIban"]).toBe(IBANS.other);
    expect(anomaly?.explanation.length).toBeGreaterThan(20);
    expect(anomaly?.recommendedAction.length).toBeGreaterThan(20);
  });

  it("unknown payment: HIGH to an unknown account, MEDIUM to a known account", () => {
    const unknown = find(
      detect([makeInvoice()], [makeTx({ reference: "Consulting", iban: IBANS.unknown, name: "Stranger" })]),
      "UNKNOWN_PAYMENT",
    );
    const known = find(
      detect([makeInvoice()], [makeTx({ reference: "Consulting", amount: "123.45" })]),
      "UNKNOWN_PAYMENT",
    );
    expect(unknown?.risk).toBe("HIGH");
    expect(known?.risk).toBe("MEDIUM");
  });

  it("high-value unknown payments are HIGH even to a known account", () => {
    const anomaly = find(
      detect([makeInvoice()], [makeTx({ reference: "x", amount: "5000.00" })]),
      "UNKNOWN_PAYMENT",
    );
    expect(anomaly?.risk).toBe("HIGH");
  });

  it("duplicate invoice: MEDIUM when identical, HIGH when details conflict", () => {
    const same = find(detect([makeInvoice({ id: "I-1" }), makeInvoice({ id: "I-2" })], []), "DUPLICATE_INVOICE");
    const conflict = find(
      detect([makeInvoice({ id: "I-1" }), makeInvoice({ id: "I-2", iban: IBANS.other })], []),
      "DUPLICATE_INVOICE",
    );
    expect(same?.risk).toBe("MEDIUM");
    expect(same?.recordId).toBe("I-2");
    expect(same?.relatedRecordIds).toEqual(["I-1"]);
    expect(conflict?.risk).toBe("HIGH");
  });

  it("duplicate transaction: HIGH, related to the primary", () => {
    const anomaly = find(detect([makeInvoice()], [makeTx({ id: "T-1" }), makeTx({ id: "T-2" })]), "DUPLICATE_TRANSACTION");
    expect(anomaly?.risk).toBe("HIGH");
    expect(anomaly?.recordId).toBe("T-2");
    expect(anomaly?.relatedRecordIds).toEqual(["T-1"]);
  });

  it("partial payment is LOW when not yet due and MEDIUM when overdue", () => {
    const early = find(detect([makeInvoice()], [makeTx({ amount: "400.00" })], "2026-10-20"), "PARTIAL_PAYMENT");
    const late = find(detect([makeInvoice()], [makeTx({ amount: "400.00" })], "2026-12-01"), "PARTIAL_PAYMENT");
    expect(early?.risk).toBe("LOW");
    expect(late?.risk).toBe("MEDIUM");
    expect(late?.values["shortfall"]).toContain("600.00 EUR");
  });

  it("a small shortfall is an AMOUNT_MISMATCH, not a partial payment", () => {
    const anomalies = detect([makeInvoice()], [makeTx({ amount: "980.00" })]);
    expect(find(anomalies, "AMOUNT_MISMATCH")?.risk).toBe("MEDIUM");
    expect(find(anomalies, "PARTIAL_PAYMENT")).toBeUndefined();
  });

  it("the 5% tolerance boundary is exact", () => {
    expect(find(detect([makeInvoice()], [makeTx({ amount: "950.00" })]), "AMOUNT_MISMATCH")).toBeDefined();
    expect(find(detect([makeInvoice()], [makeTx({ amount: "949.99" })]), "PARTIAL_PAYMENT")).toBeDefined();
  });

  it("overpayment is MEDIUM, but paying a whole invoice twice is HIGH", () => {
    const over = find(detect([makeInvoice()], [makeTx({ amount: "1200.00" })]), "OVERPAYMENT");
    const twice = find(
      detect([makeInvoice()], [makeTx({ id: "T-1", date: "2026-10-10" }), makeTx({ id: "T-2", date: "2026-10-12", reference: "inv-1 again" })]),
      "OVERPAYMENT",
    );
    expect(over?.risk).toBe("MEDIUM");
    expect(twice?.risk).toBe("HIGH");
  });

  it("overdue unpaid invoices escalate after 30 days", () => {
    const recent = find(detect([makeInvoice()], [], "2026-11-15"), "OVERDUE_INVOICE");
    const old = find(detect([makeInvoice()], [], "2026-12-01"), "OVERDUE_INVOICE");
    expect(recent?.risk).toBe("LOW");
    expect(old?.risk).toBe("MEDIUM");
    expect(find(detect([makeInvoice()], [], "2026-10-30"), "OVERDUE_INVOICE")).toBeUndefined();
  });

  it("soft findings on applied payments: name mismatch (LOW) and payment before issue (MEDIUM)", () => {
    expect(find(detect([makeInvoice()], [makeTx({ name: "Someone Else" })]), "BENEFICIARY_NAME_MISMATCH")?.risk).toBe("LOW");
    expect(find(detect([makeInvoice()], [makeTx({ date: "2026-09-01" })]), "PAYMENT_BEFORE_ISSUE")?.risk).toBe("MEDIUM");
  });

  it("flags ambiguous and currency-mismatched payments", () => {
    expect(
      find(detect([makeInvoice({ id: "I-1", number: "INV-1" }), makeInvoice({ id: "I-2", number: "INV-2" })], [makeTx({ reference: "INV-1 INV-2" })]), "AMBIGUOUS_MATCH")?.risk,
    ).toBe("MEDIUM");
    expect(find(detect([makeInvoice()], [makeTx({ currency: "USD" })]), "CURRENCY_MISMATCH")?.risk).toBe("MEDIUM");
  });

  it("orders by risk and assigns stable sequential IDs", () => {
    const anomalies = detect(
      [makeInvoice({ id: "I-1" }), makeInvoice({ id: "I-9", number: "INV-9", amount: "100.00" })],
      [makeTx({ iban: IBANS.other })],
    );
    expect(anomalies.map((a) => a.id)).toEqual(anomalies.map((_, i) => `ANM-${String(i + 1).padStart(3, "0")}`));
    expect(anomalies[0]?.risk).toBe("HIGH");
    const again = detect(
      [makeInvoice({ id: "I-1" }), makeInvoice({ id: "I-9", number: "INV-9", amount: "100.00" })],
      [makeTx({ iban: IBANS.other })],
    );
    expect(again).toEqual(anomalies);
  });
});
