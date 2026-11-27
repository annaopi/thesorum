import type { RawRecord } from "../../application/dto/RawRecord.js";
import type { InvoiceSource } from "../../application/ports/RecordSource.js";
import { readTextFile, type TextFileReader } from "./CsvFileReader.js";
import { readCsvRecords } from "./CsvParser.js";

export const INVOICE_COLUMNS = [
  "id",
  "invoice_number",
  "supplier_name",
  "amount",
  "currency",
  "iban",
  "issue_date",
  "due_date",
] as const;

export class CsvInvoiceSource implements InvoiceSource {
  public constructor(
    private readonly path: string,
    private readonly readFileText: TextFileReader = readTextFile,
  ) {}

  public async read(): Promise<readonly RawRecord[]> {
    const text = await this.readFileText(this.path);
    return readCsvRecords(text, `Invoices file ${this.path}`, INVOICE_COLUMNS);
  }
}
