import { isCalendarDate } from "./tracker-config.ts";

export function validatePayment(payload: { amount?: number; paidOn?: string; note?: string }, maxPaymentCents = 0) {
  if (!payload || typeof payload.amount !== "number" || !Number.isSafeInteger(maxPaymentCents) || maxPaymentCents < 1) return null;
  const amountCents = Math.round(payload.amount * 100);
  const paidOn = String(payload.paidOn ?? "");
  const note = String(payload.note ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 80);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > maxPaymentCents || !isCalendarDate(paidOn)) return null;
  return { amountCents, paidOn, note };
}
