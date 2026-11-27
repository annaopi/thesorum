import type { Invoice } from "../../domain/entities/Invoice.js";
import type { InvoiceRepository } from "../../application/ports/InvoiceRepository.js";

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly store = new Map<string, Invoice>();

  public async saveAll(invoices: readonly Invoice[]): Promise<void> {
    for (const invoice of invoices) {
      this.store.set(invoice.id, invoice);
    }
  }

  public async findAll(): Promise<readonly Invoice[]> {
    return [...this.store.values()];
  }

  public async findById(id: string): Promise<Invoice | undefined> {
    return this.store.get(id);
  }
}
