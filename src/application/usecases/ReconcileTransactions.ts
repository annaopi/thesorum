import { ReconciliationRun } from "../../domain/ReconciliationRun.js";
import { MatchingService } from "../../domain/services/MatchingService.js";
import type { LocalDate } from "../../domain/value-objects/LocalDate.js";
import type { InvoiceRepository } from "../ports/InvoiceRepository.js";
import type { PaymentRepository } from "../ports/PaymentRepository.js";
import type { TransactionRepository } from "../ports/TransactionRepository.js";

export interface ReconcileCommand {
  readonly runId: string;
  readonly asOf: LocalDate;
}

/** Runs the deterministic matching engine over everything in the repositories. */
export class ReconcileTransactions {
  public constructor(
    private readonly invoices: InvoiceRepository,
    private readonly transactions: TransactionRepository,
    private readonly payments: PaymentRepository,
  ) {}

  public async execute(command: ReconcileCommand): Promise<ReconciliationRun> {
    const invoices = await this.invoices.findAll();
    const transactions = await this.transactions.findAll();

    const outcome = MatchingService.match({
      invoices,
      transactions,
      asOf: command.asOf,
    });

    const run = ReconciliationRun.create({
      id: command.runId,
      asOf: command.asOf,
      invoices,
      transactions,
      outcome,
    });

    await this.payments.replaceAll(run.payments);

    return run;
  }
}
