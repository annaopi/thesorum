import type { Payment } from "../../domain/entities/Payment.js";

export interface PaymentRepository {
  replaceAll(payments: readonly Payment[]): Promise<void>;
  findAll(): Promise<readonly Payment[]>;
  findByInvoiceId(invoiceId: string): Promise<readonly Payment[]>;
}
