import type { Payment } from "../../domain/entities/Payment.js";
import type { PaymentRepository } from "../../application/ports/PaymentRepository.js";

export class InMemoryPaymentRepository implements PaymentRepository {
  private payments: readonly Payment[] = [];

  public async replaceAll(payments: readonly Payment[]): Promise<void> {
    this.payments = [...payments];
  }

  public async findAll(): Promise<readonly Payment[]> {
    return this.payments;
  }

  public async findByInvoiceId(invoiceId: string): Promise<readonly Payment[]> {
    return this.payments.filter((payment) => payment.invoiceId === invoiceId);
  }
}
