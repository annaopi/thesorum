import { describe, expect, it } from "vitest";
import { Iban } from "../../../../../src/modules/reconciliation/domain/value-objects/Iban.js";

describe("Iban", () => {
  it("creates a valid IBAN", () => {
    const iban = Iban.create("GB82 WEST 1234 5698 7654 32");

    expect(iban.toString()).toBe(
      "GB82WEST12345698765432"
    );
  });

  it("normalizes lowercase input", () => {
    const iban = Iban.create("gb82 west 1234 5698 7654 32");

    expect(iban.toString()).toBe(
      "GB82WEST12345698765432"
    );
  });

  it("rejects an invalid structure", () => {
    expect(() => Iban.create("123456789")).toThrow(
      "Invalid IBAN structure"
    );
  });

  it("rejects an invalid checksum", () => {
    expect(() =>
      Iban.create("GB82WEST12345698765431")
    ).toThrow("Invalid IBAN checksum");
  });

  it("considers identical IBANs equal", () => {
    const first = Iban.create("GB82WEST12345698765432");
    const second = Iban.create("GB82 WEST 1234 5698 7654 32");

    expect(first.equals(second)).toBe(true);
  });
});
