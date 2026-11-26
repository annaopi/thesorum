import { describe, expect, it } from "vitest";
import { Invoice } from "../../../../../src/modules/reconciliation/domain/entities/Invoice.js";
import { Currency } from "../../../../../src/modules/reconciliation/domain/value-objects/Currency.js";
import { Money } from "../../../../../src/modules/reconciliation/domain/value-objects/Money.js";
import { Iban } from "../../../../../src/modules/reconciliation/domain/value-objects/Iban.js";
import { LocalDate } from "../../../../../src/modules/reconciliation/domain/value-objects/LocalDate.js";

const validInvoice = () =>
  Invoice.create({
    id: "INV-001",
    invoiceNumber: " INV 2026/001 ",
    supplierName: "  Acme   d.o.o. ",
    expectedAmount: Money.fromDecimal(
      "150.00",
      Currency.create("EUR")
    ),
    expectedIban: Iban.create(
      "GB82 WEST 1234 5698 7654 32"
    ),
    issueDate: LocalDate.create("2026-11-01"),
    dueDate: LocalDate.create("2026-11-30")
  });

describe("Invoice", () => {
  it("creates a valid invoice", () => {
    const invoice = validInvoice();

    expect(invoice.id).toBe("INV-001");
    expect(invoice.supplierName).toBe("Acme d.o.o.");
    expect(invoice.normalizedSupplierName).toBe(
      "acme d.o.o."
    );
  });

  it("normalizes the invoice number", () => {
    const invoice = validInvoice();

    expect(invoice.normalizedInvoiceNumber)
      .toBe("INV2026/001");
  });

  it("rejects an empty ID", () => {
    expect(() =>
      Invoice.create({
        ...validInvoice(),
        id: " "
      })
    ).toThrow("Invoice ID cannot be empty");
  });

  it("rejects an empty supplier name", () => {
    expect(() =>
      Invoice.create({
        id: "INV-002",
        invoiceNumber: "2026/002",
        supplierName: " ",
        expectedAmount: Money.fromDecimal(
          "100.00",
          Currency.create("EUR")
        ),
        expectedIban: Iban.create(
          "GB82WEST12345698765432"
        ),
        issueDate: LocalDate.create("2026-11-01"),
        dueDate: LocalDate.create("2026-11-30")
      })
    ).toThrow("Supplier name cannot be empty");
  });

  it("rejects a non-positive amount", () => {
    expect(() =>
      Invoice.create({
        id: "INV-003",
        invoiceNumber: "2026/003",
        supplierName: "Acme",
        expectedAmount: Money.fromDecimal(
          "0.00",
          Currency.create("EUR")
        ),
        expectedIban: Iban.create(
          "GB82WEST12345698765432"
        ),
        issueDate: LocalDate.create("2026-11-01"),
        dueDate: LocalDate.create("2026-11-30")
      })
    ).toThrow("Invoice amount must be positive");
  });

  it("rejects a due date before the issue date", () => {
    expect(() =>
      Invoice.create({
        id: "INV-004",
        invoiceNumber: "2026/004",
        supplierName: "Acme",
        expectedAmount: Money.fromDecimal(
          "100.00",
          Currency.create("EUR")
        ),
        expectedIban: Iban.create(
          "GB82WEST12345698765432"
        ),
        issueDate: LocalDate.create("2026-11-20"),
        dueDate: LocalDate.create("2026-11-10")
      })
    ).toThrow("Due date cannot be before issue date");
  });

  it("compares invoices by ID", () => {
    const first = validInvoice();

    const second = Invoice.create({
      id: "INV-001",
      invoiceNumber: "OTHER-001",
      supplierName: "Different supplier",
      expectedAmount: Money.fromDecimal(
        "200.00",
        Currency.create("EUR")
      ),
      expectedIban: Iban.create(
        "GB82WEST12345698765432"
      ),
      issueDate: LocalDate.create("2026-11-01"),
      dueDate: LocalDate.create("2026-11-30")
    });

    expect(first.equals(second)).toBe(true);
  });

  it("allows duplicate invoice numbers with different IDs", () => {
    const first = validInvoice();

    const second = Invoice.create({
      id: "INV-002",
      invoiceNumber: "INV 2026/001",
      supplierName: "Acme d.o.o.",
      expectedAmount: Money.fromDecimal(
        "150.00",
        Currency.create("EUR")
      ),
      expectedIban: Iban.create(
        "GB82WEST12345698765432"
      ),
      issueDate: LocalDate.create("2026-11-01"),
      dueDate: LocalDate.create("2026-11-30")
    });

    expect(first.equals(second)).toBe(false);
    expect(first.normalizedInvoiceNumber).toBe(
      second.normalizedInvoiceNumber
    );
  });
});
