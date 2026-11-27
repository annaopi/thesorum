import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/DomainError.js";
import { Currency } from "../../src/domain/value-objects/Currency.js";
import { Iban } from "../../src/domain/value-objects/Iban.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";
import { Money } from "../../src/domain/value-objects/Money.js";
import { TransactionId } from "../../src/domain/value-objects/TransactionId.js";
import { IBANS } from "../helpers/builders.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error: unknown) {
    return error instanceof DomainError ? error.code : "NOT_DOMAIN_ERROR";
  }
  return undefined;
}

describe("Iban", () => {
  it("normalises spaces and case", () => {
    expect(Iban.create("de89 3704 0044 0532 0130 00").value).toBe(IBANS.acme);
  });

  it("rejects a bad checksum with INVALID_IBAN", () => {
    expect(codeOf(() => Iban.create("DE00370400440532013000"))).toBe("INVALID_IBAN");
  });

  it("rejects bad structure with INVALID_IBAN (not a plain Error)", () => {
    expect(codeOf(() => Iban.create("not an iban"))).toBe("INVALID_IBAN");
  });

  it("compares by value", () => {
    expect(Iban.create(IBANS.acme).equals(Iban.create(IBANS.acme))).toBe(true);
    expect(Iban.create(IBANS.acme).equals(Iban.create(IBANS.beta))).toBe(false);
  });
});

describe("Money", () => {
  const eur = Currency.of("EUR");

  it("parses decimal strings exactly, without floating point", () => {
    expect(Money.fromDecimalString("0.10", eur).add(Money.fromDecimalString("0.20", eur)).toDecimalString()).toBe("0.30");
    expect(Money.fromDecimalString("1200", eur).amountMinorUnits).toBe(120000);
  });

  it("rejects too many decimals, thousand separators and garbage", () => {
    expect(codeOf(() => Money.fromDecimalString("1.001", eur))).toBe("INVALID_MONEY");
    expect(codeOf(() => Money.fromDecimalString("1,200.00", eur))).toBe("INVALID_MONEY");
    expect(codeOf(() => Money.fromDecimalString("abc", eur))).toBe("INVALID_MONEY");
  });

  it("refuses to mix currencies", () => {
    const usd = Money.fromDecimalString("1.00", Currency.of("USD"));
    expect(codeOf(() => Money.fromDecimalString("1.00", eur).add(usd))).toBe("CURRENCY_MISMATCH");
  });

  it("formats zero-decimal and three-decimal currencies", () => {
    expect(Money.fromDecimalString("500", Currency.of("JPY")).toDecimalString()).toBe("500");
    expect(Money.fromDecimalString("1.5", Currency.of("KWD")).toDecimalString()).toBe("1.500");
  });
});

describe("Currency, LocalDate, TransactionId", () => {
  it("rejects unknown currencies", () => {
    expect(codeOf(() => Currency.of("XXX"))).toBe("UNKNOWN_CURRENCY");
  });

  it("validates calendar dates", () => {
    expect(LocalDate.create("2028-02-29").value).toBe("2028-02-29");
    expect(codeOf(() => LocalDate.create("2026-02-29"))).toBe("INVALID_DATE");
    expect(codeOf(() => LocalDate.create("29.02.2026"))).toBe("INVALID_DATE");
  });

  it("validates transaction IDs", () => {
    expect(TransactionId.create("  T-001 ").value).toBe("T-001");
    expect(codeOf(() => TransactionId.create("   "))).toBe("INVALID_TRANSACTION");
    expect(codeOf(() => TransactionId.create("bad id!"))).toBe("INVALID_TRANSACTION");
  });
});
