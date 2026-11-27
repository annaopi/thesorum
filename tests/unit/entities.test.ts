import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/DomainError.js";
import { Payment } from "../../src/domain/entities/Payment.js";
import { Transaction } from "../../src/domain/entities/Transaction.js";
import { Iban } from "../../src/domain/value-objects/Iban.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";
import { TransactionId } from "../../src/domain/value-objects/TransactionId.js";
import { IBANS, makeInvoice, makeTx, money } from "../helpers/builders.js";

describe("Transaction", () => {
  it("normalises reference and beneficiary", () => {
    const tx = makeTx({ name: "  Acme   GmbH ", reference: "  pay   inv-1 " });
    expect(tx.beneficiaryName).toBe("Acme GmbH");
    expect(tx.reference).toBe("pay inv-1");
    expect(tx.normalizedReference).toBe("PAY INV-1");
  });

  it("rejects non-positive amounts and empty beneficiary", () => {
    const base = {
      id: TransactionId.create("T-9"),
      bookingDate: LocalDate.create("2026-10-01"),
      beneficiaryIban: Iban.create(IBANS.acme),
      reference: "",
    };
    expect(() => Transaction.create({ ...base, amount: money("0.00"), beneficiaryName: "A" })).toThrow(DomainError);
    expect(() => Transaction.create({ ...base, amount: money("-5.00"), beneficiaryName: "A" })).toThrow("positive");
    expect(() => Transaction.create({ ...base, amount: money("5.00"), beneficiaryName: "  " })).toThrow("Beneficiary");
  });

  it("is immutable", () => {
    expect(Object.isFrozen(makeTx())).toBe(true);
    expect(Object.isFrozen(makeInvoice())).toBe(true);
  });
});

describe("Payment", () => {
  it("requires a positive amount and an invoice id", () => {
    const id = TransactionId.create("T-1");
    expect(Payment.create({ transactionId: id, invoiceId: "I-1", amount: money("1.00") }).invoiceId).toBe("I-1");
    expect(() => Payment.create({ transactionId: id, invoiceId: "I-1", amount: money("0.00") })).toThrow(DomainError);
    expect(() => Payment.create({ transactionId: id, invoiceId: " ", amount: money("1.00") })).toThrow(DomainError);
  });
});
