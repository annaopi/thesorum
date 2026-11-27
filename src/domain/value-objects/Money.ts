import { DomainError } from "../DomainError.js";
import { Currency } from "./Currency.js";

export class Money {
  private constructor(
    public readonly amountMinorUnits: number,
    public readonly currency: Currency,
  ) {
    Object.freeze(this);
  }

  public static fromMinorUnits(
    amountMinorUnits: number,
    currency: Currency,
  ): Money {
    if (!Number.isSafeInteger(amountMinorUnits)) {
      throw new DomainError(
        "INVALID_MONEY",
        "Amount must be a safe integer in minor units.",
      );
    }

    const normalizedAmount =
      amountMinorUnits === 0 ? 0 : amountMinorUnits;

    return new Money(normalizedAmount, currency);
  }

  public static fromDecimalString(
    amount: string,
    currency: Currency,
  ): Money {
    if (typeof amount !== "string") {
      throw new DomainError(
        "INVALID_MONEY",
        "Monetary amount must be a string.",
      );
    }

    const match = amount.match(/^(-?)(\d+)(?:\.(\d+))?$/);

    if (!match) {
      throw new DomainError(
        "INVALID_MONEY",
        `Invalid monetary amount: ${amount}`,
      );
    }

    const sign = match[1] === "-" ? -1 : 1;
    const wholePart = match[2];
    const fractionalPart = match[3] ?? "";

    if (fractionalPart.length > currency.minorUnits) {
      throw new DomainError(
        "INVALID_MONEY",
        `Too many decimal places for ${currency.code}.`,
      );
    }

    const paddedFraction = fractionalPart.padEnd(
      currency.minorUnits,
      "0",
    );

    const combinedDigits = `${wholePart}${paddedFraction}`;
    const normalizedDigits = combinedDigits.replace(/^0+/, "") || "0";
    const maxSafeDigits = String(Number.MAX_SAFE_INTEGER);

    if (
      normalizedDigits.length > maxSafeDigits.length ||
      (
        normalizedDigits.length === maxSafeDigits.length &&
        normalizedDigits > maxSafeDigits
      )
    ) {
      throw new DomainError(
        "INVALID_MONEY",
        "Monetary amount exceeds safe integer range.",
      );
    }

    const absoluteAmount = Number(normalizedDigits);
    const amountMinorUnits =
      absoluteAmount === 0 ? 0 : sign * absoluteAmount;

    return Money.fromMinorUnits(amountMinorUnits, currency);
  }

  public static zero(currency: Currency): Money {
    return Money.fromMinorUnits(0, currency);
  }

  public add(other: Money): Money {
    this.ensureSameCurrency(other);

    return Money.fromMinorUnits(
      this.amountMinorUnits + other.amountMinorUnits,
      this.currency,
    );
  }

  public subtract(other: Money): Money {
    this.ensureSameCurrency(other);

    return Money.fromMinorUnits(
      this.amountMinorUnits - other.amountMinorUnits,
      this.currency,
    );
  }

  public negate(): Money {
    return Money.fromMinorUnits(
      -this.amountMinorUnits,
      this.currency,
    );
  }

  public equals(other: Money): boolean {
    return (
      this.amountMinorUnits === other.amountMinorUnits &&
      this.currency.equals(other.currency)
    );
  }

  public compareTo(other: Money): number {
    this.ensureSameCurrency(other);

    if (this.amountMinorUnits < other.amountMinorUnits) {
      return -1;
    }

    if (this.amountMinorUnits > other.amountMinorUnits) {
      return 1;
    }

    return 0;
  }

  public isZero(): boolean {
    return this.amountMinorUnits === 0;
  }

  public isPositive(): boolean {
    return this.amountMinorUnits > 0;
  }

  public isNegative(): boolean {
    return this.amountMinorUnits < 0;
  }

  public toDecimalString(): string {
    const sign = this.amountMinorUnits < 0 ? "-" : "";
    const absoluteAmount = Math.abs(this.amountMinorUnits);

    if (this.currency.minorUnits === 0) {
      return `${sign}${absoluteAmount}`;
    }

    const scale = 10 ** this.currency.minorUnits;
    const wholePart = Math.floor(absoluteAmount / scale);

    const fractionalPart = String(
      absoluteAmount % scale,
    ).padStart(this.currency.minorUnits, "0");

    return `${sign}${wholePart}.${fractionalPart}`;
  }

  private ensureSameCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new DomainError(
        "CURRENCY_MISMATCH",
        `Currency mismatch: ${this.currency.code} and ${other.currency.code}.`,
      );
    }
  }
}
