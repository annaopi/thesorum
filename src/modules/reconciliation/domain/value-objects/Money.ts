import { Currency } from "./Currency.js";

export class Money {
  private constructor(
    public readonly amountMinorUnits: number,
    public readonly currency: Currency
  ) {}

  public static fromMinorUnits(
    amountMinorUnits: number,
    currency: Currency
  ): Money {
    if (!Number.isSafeInteger(amountMinorUnits)) {
      throw new Error(
        "Amount must be a safe integer in minor units."
      );
    }

    return new Money(amountMinorUnits, currency);
  }

  public static fromDecimal(
    amount: string,
    currency: Currency
  ): Money {
    const normalizedAmount = amount.trim();

    const match = normalizedAmount.match(
      /^([+-]?)(\d+)(?:\.(\d+))?$/
    );

    if (!match) {
      throw new Error(`Invalid monetary amount: ${amount}`);
    }

    const sign = match[1] === "-" ? -1 : 1;
    const wholePart = match[2];
    const fractionalPart = match[3] ?? "";

    if (fractionalPart.length > currency.minorUnit) {
      throw new Error(
        `Too many decimal places for ${currency.code}.`
      );
    }

    const scale = 10 ** currency.minorUnit;

    const wholeUnits = Number(wholePart);

    const fractionalUnits = Number(
      fractionalPart.padEnd(currency.minorUnit, "0") || "0"
    );

    const absoluteAmount =
      wholeUnits * scale + fractionalUnits;

    const amountMinorUnits = sign * absoluteAmount;

    if (!Number.isSafeInteger(amountMinorUnits)) {
      throw new Error("Monetary amount exceeds safe integer range.");
    }

    return new Money(amountMinorUnits, currency);
  }

  public add(other: Money): Money {
    this.ensureSameCurrency(other);

    return Money.fromMinorUnits(
      this.amountMinorUnits + other.amountMinorUnits,
      this.currency
    );
  }

  public subtract(other: Money): Money {
    this.ensureSameCurrency(other);

    return Money.fromMinorUnits(
      this.amountMinorUnits - other.amountMinorUnits,
      this.currency
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

  public toDecimalString(): string {
    const sign = this.amountMinorUnits < 0 ? "-" : "";
    const absoluteAmount = Math.abs(this.amountMinorUnits);

    const scale = 10 ** this.currency.minorUnit;
    const wholePart = Math.floor(absoluteAmount / scale);

    if (this.currency.minorUnit === 0) {
      return `${sign}${wholePart}`;
    }

    const fractionalPart = String(
      absoluteAmount % scale
    ).padStart(this.currency.minorUnit, "0");

    return `${sign}${wholePart}.${fractionalPart}`;
  }

  private ensureSameCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new Error(
        `Currency mismatch: ${this.currency.code} and ${other.currency.code}.`
      );
    }
  }
}
