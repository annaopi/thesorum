import { describe, expect, it } from "vitest";
import {
  canonicalName,
  daysBetween,
  referenceMentions,
  sameParty,
} from "../../src/domain/services/DomainUtils.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";

describe("referenceMentions", () => {
  it("matches the invoice number as a standalone token", () => {
    expect(referenceMentions("PAYMENT INV-2026-001", "INV-2026-001")).toBe(true);
    expect(referenceMentions("INV-2026-001.", "inv-2026-001")).toBe(true);
    expect(referenceMentions("INV 2026 001", "INV 2026 001")).toBe(true);
  });

  it("does not match longer or embedded numbers", () => {
    expect(referenceMentions("INV-10", "INV-1")).toBe(false);
    expect(referenceMentions("INV-1-A", "INV-1")).toBe(false);
    expect(referenceMentions("XINV-1", "INV-1")).toBe(false);
    expect(referenceMentions("X-INV-1", "INV-1")).toBe(false);
  });

  it("treats regex characters literally", () => {
    expect(referenceMentions("A.B", "A.B")).toBe(true);
    expect(referenceMentions("AXB", "A.B")).toBe(false);
  });
});

describe("names and dates", () => {
  it("compares party names ignoring case, accents and punctuation", () => {
    expect(canonicalName("Acme d.o.o.")).toBe("acmedoo");
    expect(sameParty("Société Générale", "SOCIETE GENERALE")).toBe(true);
    expect(sameParty("Acme", "Acme Ltd")).toBe(false);
    expect(sameParty("", "")).toBe(false);
  });

  it("counts days between dates", () => {
    expect(daysBetween(LocalDate.create("2026-10-31"), LocalDate.create("2026-12-01"))).toBe(31);
    expect(daysBetween(LocalDate.create("2028-02-28"), LocalDate.create("2028-03-01"))).toBe(2);
    expect(daysBetween(LocalDate.create("2026-12-01"), LocalDate.create("2026-11-30"))).toBe(-1);
  });
});
