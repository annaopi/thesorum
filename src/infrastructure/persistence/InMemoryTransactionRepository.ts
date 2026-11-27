import type { Transaction } from "../../domain/entities/Transaction.js";
import type { TransactionRepository } from "../../application/ports/TransactionRepository.js";

export class InMemoryTransactionRepository implements TransactionRepository {
  private readonly store = new Map<string, Transaction>();

  public async saveAll(transactions: readonly Transaction[]): Promise<void> {
    for (const transaction of transactions) {
      this.store.set(transaction.id.value, transaction);
    }
  }

  public async findAll(): Promise<readonly Transaction[]> {
    return [...this.store.values()];
  }

  public async findById(id: string): Promise<Transaction | undefined> {
    return this.store.get(id);
  }
}
