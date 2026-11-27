import { Invoice } from "../../src/domain/entities/Invoice.js";
import { Transaction } from "../../src/domain/entities/Transaction.js";
import { ReconciliationRun } from "../../src/domain/ReconciliationRun.js";
import { MatchingService } from "../../src/domain/services/MatchingService.js";
import { Currency } from "../../src/domain/value-objects/Currency.js";
import { Iban } from "../../src/domain/value-objects/Iban.js";
import { LocalDate } from "../../src/domain/value-objects/LocalDate.js";
import { Money } from "../../src/domain/value-objects/Money.js";
import { TransactionId } from "../../src/domain/value-objects/TransactionId.js";

/** Valid (checksum-correct) synthetic IBANs. */
export const IBANS = {
  acme: "DE89370400440532013000",
  beta: "NL91ABNA0417164300",
  other: "DE44500105175407324931",
  unknown: "NL39RABO0300065264",
} as const;

export interface InvoiceOptions {
  id?: string;
  number?: string;
  supplier?: string;
  amount?: string;
  currency?: string;
  iban?: string;
  issue?: string;
  due?: string;
}

export function makeInvoice(o: InvoiceOptions = {}): Invoice {
  const currency = Currency.of(o.currency ?? "EUR");
  return Invoice.create({
    id: o.id ?? "I-1",
    invoiceNumber: o.number ?? "INV-1",
    supplierName: o.supplier ?? "Acme GmbH",
    expectedAmount: Money.fromDecimalString(o.amount ?? "1000.00", currency),
    expectedIban: Iban.create(o.iban ?? IBANS.acme),
    issueDate: LocalDate.create(o.issue ?? "2026-10-01"),
    dueDate: LocalDate.create(o.due ?? "2026-10-31"),
  });
}

export interface TransactionOptions {
  id?: string;
  date?: string;
  amount?: string;
  currency?: string;
  name?: string;
  iban?: string;
  reference?: string;
}

export function makeTx(o: TransactionOptions = {}): Transaction {
  const currency = Currency.of(o.currency ?? "EUR");
  return Transaction.create({
    id: TransactionId.create(o.id ?? "T-1"),
    bookingDate: LocalDate.create(o.date ?? "2026-10-15"),
    amount: Money.fromDecimalString(o.amount ?? "1000.00", currency),
    beneficiaryName: o.name ?? "Acme GmbH",
    beneficiaryIban: Iban.create(o.iban ?? IBANS.acme),
    reference: o.reference ?? "INV-1",
  });
}

export function makeRun(
  invoices: readonly Invoice[],
  transactions: readonly Transaction[],
  asOf = "2026-12-01",
): ReconciliationRun {
  const date = LocalDate.create(asOf);
  const outcome = MatchingService.match({ invoices, transactions, asOf: date });
  return ReconciliationRun.create({ id: "RUN-TEST", asOf: date, invoices, transactions, outcome });
}

export function money(amount: string, currency = "EUR"): Money {
  return Money.fromDecimalString(amount, Currency.of(currency));
}
