import type { LocalDate } from "../value-objects/LocalDate.js";
import type { Money } from "../value-objects/Money.js";

/** "1200.00 EUR" */
export function formatMoney(money: Money): string {
  return `${money.toDecimalString()} ${money.currency.code}`;
}

/**
 * Comparison key for party names: case-, accent-, punctuation- and
 * whitespace-insensitive ("Acme d.o.o." and "ACME DOO" are equal).
 */
export function canonicalName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function sameParty(a: string, b: string): boolean {
  const left = canonicalName(a);
  return left.length > 0 && left === canonicalName(b);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the (upper-cased, whitespace-collapsed) payment reference contains
 * the invoice number as a standalone token. "INV-1" does not match "INV-10"
 * or "INV-1-A".
 */
export function referenceMentions(
  normalizedReference: string,
  invoiceNumber: string,
): boolean {
  const token = invoiceNumber
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

  if (!token) {
    return false;
  }

  const pattern = new RegExp(
    `(?<![A-Z0-9][-/_])(?<![A-Z0-9])${escapeRegExp(token)}(?![A-Z0-9])(?![-/_][A-Z0-9])`,
  );

  return pattern.test(normalizedReference);
}

function utcDayNumber(date: LocalDate): number {
  const [year, month, day] = date.value.split("-").map(Number);
  const instant = new Date(Date.UTC(2000, 0, 1));
  instant.setUTCFullYear(year, month - 1, day);
  return Math.round(instant.getTime() / 86_400_000);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return utcDayNumber(to) - utcDayNumber(from);
}
