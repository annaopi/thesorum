import { DomainError } from "../DomainError.js";
import { Iban } from "../value-objects/Iban.js";
import { LocalDate } from "../value-objects/LocalDate.js";
import { Money } from "../value-objects/Money.js";

interface CreateInvoiceProps {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  expectedAmount: Money;
  expectedIban: Iban;
  issueDate: LocalDate;
  dueDate: LocalDate;
}

export class Invoice {
  private constructor(
    public readonly id: string,
    public readonly invoiceNumber: string,
    public readonly normalizedInvoiceNumber: string,
    public readonly supplierName: string,
    public readonly normalizedSupplierName: string,
    public readonly expectedAmount: Money,
    public readonly expectedIban: Iban,
    public readonly issueDate: LocalDate,
    public readonly dueDate: LocalDate
  ) {}

  public static create(props: CreateInvoiceProps): Invoice {
    const id = props.id.trim();
    const invoiceNumber = props.invoiceNumber.trim();
    const supplierName = props.supplierName
      .trim()
      .replace(/\s+/g, " ");

    if (!id) {
      throw new DomainError("Invoice ID cannot be empty.");
    }

    if (!invoiceNumber) {
      throw new DomainError(
        "Invoice number cannot be empty."
      );
    }

    if (!supplierName) {
      throw new DomainError(
        "Supplier name cannot be empty."
      );
    }

    if (props.expectedAmount.amountMinorUnits <= 0) {
      throw new DomainError(
        "Invoice amount must be positive."
      );
    }

    if (props.dueDate.isBefore(props.issueDate)) {
      throw new DomainError(
        "Due date cannot be before issue date."
      );
    }

    return new Invoice(
      id,
      invoiceNumber,
      invoiceNumber.replace(/\s+/g, "").toUpperCase(),
      supplierName,
      supplierName.toLowerCase(),
      props.expectedAmount,
      props.expectedIban,
      props.issueDate,
      props.dueDate
    );
  }

  public equals(other: Invoice): boolean {
    return this.id === other.id;
  }
}
