import type { RawRecord } from "../dto/RawRecord.js";

export interface InvoiceSource {
  read(): Promise<readonly RawRecord[]>;
}

export interface TransactionSource {
  read(): Promise<readonly RawRecord[]>;
}
