import { DomainError } from "../DomainError.js";

export class LocalDate {
  private constructor(
    public readonly value: string,
  ) {
    Object.freeze(this);
  }

  public static create(value: string): LocalDate {
    const normalized = value.trim();

    const match = normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})$/,
    );

    if (!match) {
      throw new DomainError(
        "INVALID_DATE",
        "Date must use the YYYY-MM-DD format.",
      );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const daysInMonth = [
      31,
      LocalDate.isLeapYear(year) ? 29 : 28,
      31, 30, 31, 30,
      31, 31, 30, 31, 30, 31,
    ];

    if (
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth[month - 1]
    ) {
      throw new DomainError(
        "INVALID_DATE",
        "Invalid calendar date.",
      );
    }

    return new LocalDate(normalized);
  }

  public isBefore(other: LocalDate): boolean {
    return this.value < other.value;
  }

  public equals(other: LocalDate): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  private static isLeapYear(year: number): boolean {
    return (
      year % 400 === 0 ||
      (year % 4 === 0 && year % 100 !== 0)
    );
  }
}
