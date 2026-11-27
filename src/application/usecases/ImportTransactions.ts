import type { ImportResult } from "../dto/ImportResult.js";
import type { TransactionSource } from "../ports/RecordSource.js";
import type { TransactionRepository } from "../ports/TransactionRepository.js";
import { ValidateTransactions } from "./ValidateTransactions.js";

export class ImportTransactions {
  public constructor(
    private readonly source: TransactionSource,
    private readonly repository: TransactionRepository,
    private readonly validator: ValidateTransactions = new ValidateTransactions(),
  ) {}

  public async execute(): Promise<ImportResult> {
    const records = await this.source.read();
    const { valid, issues, rowsRead } = this.validator.execute(records);

    await this.repository.saveAll(valid);

    return { recordsRead: rowsRead, imported: valid.length, issues };
  }
}
