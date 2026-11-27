import type { ImportResult } from "../dto/ImportResult.js";
import type { InvoiceRepository } from "../ports/InvoiceRepository.js";
import type { InvoiceSource } from "../ports/RecordSource.js";
import { ValidateInvoices } from "./ValidateInvoices.js";

export class ImportInvoices {
  public constructor(
    private readonly source: InvoiceSource,
    private readonly repository: InvoiceRepository,
    private readonly validator: ValidateInvoices = new ValidateInvoices(),
  ) {}

  public async execute(): Promise<ImportResult> {
    const records = await this.source.read();
    const { valid, issues, rowsRead } = this.validator.execute(records);

    await this.repository.saveAll(valid);

    return { recordsRead: rowsRead, imported: valid.length, issues };
  }
}
