export class Currency {
  private constructor(
    public readonly code: string,
    public readonly minorUnit: number
  ) {}

  private static readonly SUPPORTED_CURRENCIES: Record<string, number> = {
    EUR: 2,
    USD: 2,
    GBP: 2,
    CHF: 2,
    RSD: 2,
    JPY: 0,
    KWD: 3
  };

  public static create(code: string): Currency {
    const normalizedCode = code.trim().toUpperCase();

    const minorUnit =
      Currency.SUPPORTED_CURRENCIES[normalizedCode];

    if (minorUnit === undefined) {
      throw new Error(`Unsupported currency: ${code}`);
    }

    return new Currency(normalizedCode, minorUnit);
  }

  public equals(other: Currency): boolean {
    return this.code === other.code;
  }
}
