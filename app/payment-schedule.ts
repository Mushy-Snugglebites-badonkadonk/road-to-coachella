import { isConfiguredSchedule } from "./tracker-config.ts";

type ScheduledPayment = { amount_cents: number; paid_on: string; status: string };

// The stored date anchors the first outstanding installment, not today's month.
// Recalculate from the ledger so approvals, edits and deletions stay consistent.
export function paymentSchedule(totalCents: number, installmentCents: number, anchor: string, payments: ScheduledPayment[]) {
  if (!isConfiguredSchedule(totalCents, installmentCents, anchor)) return { nextPaymentDate: null, nextPaymentCents: 0 };
  const approved = payments.filter((payment) => payment.status === "approved");
  const remaining = Math.max(0, totalCents - approved.reduce((sum, payment) => sum + payment.amount_cents, 0));
  if (remaining === 0) return { nextPaymentDate: null, nextPaymentCents: 0 };
  const credited = approved.filter((payment) => payment.paid_on >= anchor).reduce((sum, payment) => sum + payment.amount_cents, 0);
  const monthsCovered = Math.floor(credited / installmentCents);
  const [, month, day] = anchor.split("-").map(Number);
  const due = new Date(`${anchor}T00:00:00Z`);
  due.setUTCDate(1);
  due.setUTCMonth(month - 1 + monthsCovered);
  if (!Number.isFinite(due.getTime()) || due.getUTCFullYear() > 9999) return { nextPaymentDate: null, nextPaymentCents: 0 };
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, lastDay));
  return {
    nextPaymentDate: due.toISOString().slice(0, 10),
    nextPaymentCents: Math.min(remaining, installmentCents - credited % installmentCents),
  };
}
