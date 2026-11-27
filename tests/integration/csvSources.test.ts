import { describe, expect, it } from "vitest";
import { ImportError } from "../../src/application/errors.js";
import { ImportInvoices } from "../../src/application/usecases/ImportInvoices.js";
import { ImportTransactions } from "../../src/application/usecases/ImportTransactions.js";
import { CsvInvoiceSource } from "../../src/infrastructure/csv/CsvInvoiceSource.js";
import { CsvTransactionSource } from "../../src/infrastructure/csv/CsvTransactionSource.js";
import { InMemoryInvoiceRepository } from "../../src/infrastructure/persistence/InMemoryInvoiceRepository.js";
import { InMemoryTransactionRepository } from "../../src/infrastructure/persistence/InMemoryTransactionRepository.js";
import { IBANS } from "../helpers/builders.js";

describe("CSV import -> validation -> repository", () => {
  it("imports valid rows, reports invalid ones and stores only valid entities", async () => {
    const csv = [
      "id,invoice_number,supplier_name,amount,currency,iban,issue_date,due_date",
      `I-1,"INV-1","Acme, GmbH",10.50,EUR,${IBANS.acme},2026-10-01,2026-10-31`,
      `I-2,INV-2,Beta,abc,EUR,${IBANS.beta},2026-10-01,2026-10-31`,
    ].join("\r\n");
    const repo = new InMemoryInvoiceRepository();
    const result = await new ImportInvoices(new CsvInvoiceSource("x.csv", async () => csv), repo).execute();

    expect(result).toMatchObject({ recordsRead: 2, imported: 1 });
    expect(result.issues[0]?.code).toBe("INVALID_MONEY");
    const stored = await repo.findAll();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.supplierName).toBe("Acme, GmbH");
    expect((await repo.findById("I-1"))?.expectedAmount.toDecimalString()).toBe("10.50");
    expect(await repo.findById("I-2")).toBeUndefined();
  });

  it("imports transactions without a reference column", async () => {
    const csv = ["id,booking_date,amount,currency,beneficiary_name,beneficiary_iban", `T-1,2026-10-10,5.00,EUR,Acme,${IBANS.acme}`].join("\n");
    const repo = new InMemoryTransactionRepository();
    const result = await new ImportTransactions(new CsvTransactionSource("t.csv", async () => csv), repo).execute();
    expect(result.imported).toBe(1);
    expect((await repo.findById("T-1"))?.reference).toBe("");
  });

  it("surfaces structural problems as ImportError and unreadable files cleanly", async () => {
    const repo = new InMemoryTransactionRepository();
    let error: unknown;
    try {
      await new ImportTransactions(new CsvTransactionSource("t.csv", async () => "id,amount\n1,2"), repo).execute();
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error instanceof ImportError).toBe(true);

    let missing: unknown;
    try {
      await new CsvTransactionSource("/definitely/not/here.csv").read();
    } catch (caught: unknown) {
      missing = caught;
    }
    expect(missing instanceof ImportError).toBe(true);
  });
});
