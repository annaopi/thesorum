import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/DomainError.js";
import { ReconciliationRun } from "../../src/domain/ReconciliationRun.js";
import { MatchingService } from "../../src/domain/services/MatchingService.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";
import { makeInvoice, makeRun, makeTx } from "../helpers/builders.js";

describe("ReconciliationRun", () => {
  const asOf = LocalDate.create("2026-12-01");

  it("exposes lookups and is immutable", () => {
    const run = makeRun([makeInvoice()], [makeTx()]);
    expect(run.invoiceById("I-1")?.id).toBe("I-1");
    expect(run.transactionById("T-1")?.id.value).toBe("T-1");
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.decisions)).toBe(true);
  });

  it("rejects an outcome that lacks a decision", () => {
    const invoices = [makeInvoice()];
    const transactions = [makeTx()];
    const outcome = MatchingService.match({ invoices, transactions, asOf });
    let code: string | undefined;
    try {
      ReconciliationRun.create({ id: "R", asOf, invoices, transactions, outcome: { ...outcome, decisions: [] } });
    } catch (error: unknown) {
      code = error instanceof DomainError ? error.code : "other";
    }
    expect(code).toBe("INVALID_RECONCILIATION");
  });

  it("rejects empty run IDs and duplicate transaction IDs", () => {
    const invoices = [makeInvoice()];
    const outcome = MatchingService.match({ invoices, transactions: [], asOf });
    expect(() => ReconciliationRun.create({ id: " ", asOf, invoices, transactions: [], outcome })).toThrow("Run ID");
    expect(() =>
      ReconciliationRun.create({ id: "R", asOf, invoices, transactions: [makeTx(), makeTx()], outcome }),
    ).toThrow("unique");
  });

  it("MatchingService refuses duplicate transaction IDs outright", () => {
    expect(() =>
      MatchingService.match({ invoices: [makeInvoice()], transactions: [makeTx(), makeTx({ amount: "5.00" })], asOf }),
    ).toThrow(DomainError);
  });
});
