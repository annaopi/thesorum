import type { Invoice } from "../../domain/entities/Invoice.js";

export interface InvoiceRepository {
  saveAll(invoices: readonly Invoice[]): Promise<void>;
  findAll(): Promise<readonly Invoice[]>;
  findById(id: string): Promise<Invoice | undefined>;
}
