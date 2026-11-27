import type { ValidationIssue } from "./ValidationIssue.js";

export interface ImportResult {
  readonly recordsRead: number;
  readonly imported: number;
  readonly issues: readonly ValidationIssue[];
}
