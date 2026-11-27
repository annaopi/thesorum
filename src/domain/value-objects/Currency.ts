import { DomainError } from "../DomainError.js";

const SUPPORTED_CURRENCIES = new Map<string, number>([
  ["EUR", 2],
  ["USD", 2],
  ["RSD", 2],
  ["HUF", 2],
  ["JPY", 0],
  ["KWD", 3],
]);

export class Currency {
  private constructor(
    public readonly code: string,
    public readonly minorUnits: number,
  ) {
    Object.freeze(this);
  }

  public static of(code: string): Currency {
    const minorUnits = SUPPORTED_CURRENCIES.get(code);

    if (minorUnits === undefined) {
      throw new DomainError(
        "UNKNOWN_CURRENCY",
        `Unsupported currency: ${code}`,
      );
    }

    return new Currency(code, minorUnits);
  }

  public equals(other: Currency): boolean {
    return this.code === other.code;
  }
}
