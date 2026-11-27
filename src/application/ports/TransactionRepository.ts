import type { Transaction } from "../../domain/entities/Transaction.js";

export interface TransactionRepository {
  saveAll(transactions: readonly Transaction[]): Promise<void>;
  findAll(): Promise<readonly Transaction[]>;
  findById(id: string): Promise<Transaction | undefined>;
}
