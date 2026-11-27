import { DomainError } from "../DomainError.js";

export class Iban {
  private constructor(
    public readonly value: string,
  ) {
    Object.freeze(this);
  }

  public static create(input: string): Iban {
    if (typeof input !== "string") {
      throw new DomainError("INVALID_IBAN", "IBAN must be a string.");
    }

    const normalized = input
      .replace(/\s+/g, "")
      .toUpperCase();

    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) {
      throw new DomainError("INVALID_IBAN", "Invalid IBAN structure.");
    }

    if (normalized.length < 15 || normalized.length > 34) {
      throw new DomainError("INVALID_IBAN", "Invalid IBAN length.");
    }

    if (!Iban.hasValidChecksum(normalized)) {
      throw new DomainError("INVALID_IBAN", "Invalid IBAN checksum.");
    }

    return new Iban(normalized);
  }

  private static hasValidChecksum(iban: string): boolean {
    const rearranged =
      iban.slice(4) + iban.slice(0, 4);

    let remainder = 0;

    for (const character of rearranged) {
      const value = /[A-Z]/.test(character)
        ? String(character.charCodeAt(0) - 55)
        : character;

      for (const digit of value) {
        remainder = (remainder * 10 + Number(digit)) % 97;
      }
    }

    return remainder === 1;
  }

  public equals(other: Iban): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}
