import { isCop } from './currency';

/**
 * "Pendiente por facturar" header figures: the amount sums COP orders only (never
 * add different currencies); `foreignCount` is how many non-COP orders still have
 * a pending balance and were left out.
 */
export function pendingTotals(orders: { currency_code: string | null; pending: number }[]) {
  let copPending = 0;
  let foreignCount = 0;
  for (const o of orders) {
    if (isCop({ currencyCode: o.currency_code ?? undefined })) copPending += o.pending;
    else if (o.pending > 0) foreignCount += 1;
  }
  return { copPending, foreignCount };
}
