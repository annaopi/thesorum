import { describe, expect, it } from "vitest";
import { LocalDate } from "../../../../../src/modules/reconciliation/domain/value-objects/LocalDate.js";

describe("LocalDate", () => {
  it("creates a valid date", () => {
    const date = LocalDate.create("2026-11-26");

    expect(date.toString()).toBe("2026-11-26");
  });

  it("rejects an incorrect format", () => {
    expect(() => LocalDate.create("26-11-2026"))
      .toThrow("YYYY-MM-DD");
  });

  it("rejects an impossible date", () => {
    expect(() => LocalDate.create("2026-02-30"))
      .toThrow("Invalid calendar date");
  });

  it("accepts a valid leap day", () => {
    expect(() => LocalDate.create("2024-02-29"))
      .not.toThrow();
  });

  it("rejects an invalid leap day", () => {
    expect(() => LocalDate.create("2025-02-29"))
      .toThrow("Invalid calendar date");
  });

  it("compares dates correctly", () => {
    const first = LocalDate.create("2026-01-10");
    const second = LocalDate.create("2026-01-11");

    expect(first.isBefore(second)).toBe(true);
    expect(second.isBefore(first)).toBe(false);
  });
});
