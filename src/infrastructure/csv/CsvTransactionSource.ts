import type { RawRecord } from "../../application/dto/RawRecord.js";
import type { TransactionSource } from "../../application/ports/RecordSource.js";
import { readTextFile, type TextFileReader } from "./CsvFileReader.js";
import { readCsvRecords } from "./CsvParser.js";

export const TRANSACTION_COLUMNS = [
  "id",
  "booking_date",
  "amount",
  "currency",
  "beneficiary_name",
  "beneficiary_iban",
] as const;

export class CsvTransactionSource implements TransactionSource {
  public constructor(
    private readonly path: string,
    private readonly readFileText: TextFileReader = readTextFile,
  ) {}

  public async read(): Promise<readonly RawRecord[]> {
    const text = await this.readFileText(this.path);
    // "reference" is optional but read when present.
    return readCsvRecords(text, `Transactions file ${this.path}`, TRANSACTION_COLUMNS);
  }
}
