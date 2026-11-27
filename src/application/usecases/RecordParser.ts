import { DomainError } from "../../domain/DomainError.js";
import type { RawRecord } from "../dto/RawRecord.js";
import type { ValidationIssue, ValidationIssueCode } from "../dto/ValidationIssue.js";

/** Collects per-field validation issues for one raw record instead of failing on the first. */
export class RecordParser {
  public constructor(
    private readonly recordType: ValidationIssue["recordType"],
    private readonly record: RawRecord,
    private readonly issues: ValidationIssue[],
  ) {}

  public get recordId(): string | null {
    const raw = this.record.fields["id"];
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }

  /** Trimmed value of a mandatory field; records MISSING_FIELD when absent or blank. */
  public required(field: string): string | undefined {
    const raw = this.record.fields[field];

    if (typeof raw !== "string" || raw.trim() === "") {
      this.fail("MISSING_FIELD", field, `Required field "${field}" is missing or empty.`);
      return undefined;
    }

    return raw.trim();
  }

  public optional(field: string): string {
    const raw = this.record.fields[field];
    return typeof raw === "string" ? raw.trim() : "";
  }

  /** Runs a domain constructor; converts DomainError into a validation issue. */
  public attempt<T>(field: string | null, build: () => T): T | undefined {
    try {
      return build();
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        this.fail(error.code, field, error.message);
        return undefined;
      }

      throw error;
    }
  }

  public fail(code: ValidationIssueCode, field: string | null, message: string): void {
    this.issues.push({
      recordType: this.recordType,
      rowNumber: this.record.rowNumber,
      recordId: this.recordId,
      field,
      code,
      message,
    });
  }
}
