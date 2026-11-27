import type { DomainErrorCode } from "../../domain/DomainError.js";

export type ValidationIssueCode = DomainErrorCode | "MISSING_FIELD" | "DUPLICATE_ID";

export interface ValidationIssue {
  readonly recordType: "INVOICE" | "TRANSACTION";
  readonly rowNumber: number;
  readonly recordId: string | null;
  readonly field: string | null;
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export interface ValidationResult<T> {
  readonly rowsRead: number;
  readonly valid: readonly T[];
  readonly issues: readonly ValidationIssue[];
}
