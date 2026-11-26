import { describe, expect, it } from "vitest";

import { Currency } from "../../../../../src/modules/reconciliation/domain/value-objects/Currency.js";
import { Money } from "../../../../../src/modules/reconciliation/domain/value-objects/Money.js";

describe("Currency", () => {
  it("creates a currency using an uppercase code", () => {
    const currency = Currency.create("eur");

    expect(currency.code).toBe("EUR");
    expect(currency.minorUnit).toBe(2);
  });

  it("supports currencies with zero decimal places", () => {
    const currency = Currency.create("JPY");

    expect(currency.minorUnit).toBe(0);
  });

  it("rejects unsupported currencies", () => {
    expect(() => Currency.create("XYZ")).toThrow(
      "Unsupported currency"
    );
  });

  it("considers currencies with the same code equal", () => {
    const first = Currency.create("EUR");
    const second = Currency.create("eur");

    expect(first.equals(second)).toBe(true);
  });
});

describe("Money", () => {
  const eur = Currency.create("EUR");

  it("creates money from a decimal string", () => {
    const money = Money.fromDecimal("125.50", eur);

    expect(money.amountMinorUnits).toBe(12550);
    expect(money.toDecimalString()).toBe("125.50");
  });

  it("adds two monetary amounts", () => {
    const first = Money.fromDecimal("100.50", eur);
    const second = Money.fromDecimal("25.25", eur);

    const result = first.add(second);

    expect(result.toDecimalString()).toBe("125.75");
  });

  it("subtracts two monetary amounts", () => {
    const first = Money.fromDecimal("100.00", eur);
    const second = Money.fromDecimal("35.50", eur);

    const result = first.subtract(second);

    expect(result.toDecimalString()).toBe("64.50");
  });

  it("supports negative monetary values", () => {
    const money = Money.fromDecimal("-12.50", eur);

    expect(money.amountMinorUnits).toBe(-1250);
    expect(money.toDecimalString()).toBe("-12.50");
  });

  it("rejects amounts with too many decimal places", () => {
    expect(() =>
      Money.fromDecimal("10.555", eur)
    ).toThrow("Too many decimal places");
  });

  it("rejects invalid monetary input", () => {
    expect(() =>
      Money.fromDecimal("10,50", eur)
    ).toThrow("Invalid monetary amount");
  });

  it("rejects arithmetic between different currencies", () => {
    const usd = Currency.create("USD");

    const euroAmount = Money.fromDecimal("100.00", eur);
    const dollarAmount = Money.fromDecimal("100.00", usd);

    expect(() => euroAmount.add(dollarAmount)).toThrow(
      "Currency mismatch"
    );
  });

  it("compares monetary values", () => {
    const first = Money.fromDecimal("100.00", eur);
    const second = Money.fromDecimal("150.00", eur);

    expect(first.compareTo(second)).toBe(-1);
    expect(second.compareTo(first)).toBe(1);
    expect(first.compareTo(first)).toBe(0);
  });

  it("considers equal amounts with equal currencies equal", () => {
    const first = Money.fromDecimal("50.00", eur);
    const second = Money.fromDecimal("50.00", eur);

    expect(first.equals(second)).toBe(true);
  });

  it("supports currencies with zero decimal places", () => {
    const jpy = Currency.create("JPY");
    const money = Money.fromDecimal("1500", jpy);

    expect(money.amountMinorUnits).toBe(1500);
    expect(money.toDecimalString()).toBe("1500");
  });

  it("supports currencies with three decimal places", () => {
    const kwd = Currency.create("KWD");
    const money = Money.fromDecimal("12.345", kwd);

    expect(money.amountMinorUnits).toBe(12345);
    expect(money.toDecimalString()).toBe("12.345");
  });

  it("rejects unsafe integer values", () => {
    expect(() =>
      Money.fromMinorUnits(Number.MAX_SAFE_INTEGER + 1, eur)
    ).toThrow("safe integer");
  });
});
