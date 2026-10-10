import assert from "node:assert/strict";
import test from "node:test";
import { paymentSchedule } from "../app/payment-schedule.ts";

// All values here are synthetic test data, not a personal ledger.
const payment = (amount_cents, paid_on, status = "approved") => ({ amount_cents, paid_on, status });
const schedule = (rows) => paymentSchedule(12345, 2500, "2030-01-31", rows);
test("unconfigured or malformed schedules safely return no due payment", () => {
  for (const [total, installment, anchor] of [[0, 0, ""], [12345, 0, "2030-01-31"], [12345, 2500, ""], [12345, 2500, "2030-02-30"], [NaN, 2500, "2030-01-31"], [12345, -1, "2030-01-31"]]) {
    assert.deepEqual(paymentSchedule(total, installment, anchor, []), { nextPaymentDate: null, nextPaymentCents: 0 });
  }
});
test("late installment advances from anchor, clamping to the month end", () => {
  assert.deepEqual(schedule([payment(2500, "2030-02-05")]), { nextPaymentDate: "2030-02-28", nextPaymentCents: 2500 });
});
test("partial payments combine and only approved payments count", () => {
  assert.deepEqual(schedule([payment(1000, "2030-02-05"), payment(1500, "2030-02-05", "pending")]), { nextPaymentDate: "2030-01-31", nextPaymentCents: 1500 });
  assert.equal(schedule([payment(1000, "2030-02-05"), payment(1500, "2030-02-06")]).nextPaymentDate, "2030-02-28");
  assert.equal(schedule([payment(2500, "2030-02-05", "rejected")]).nextPaymentDate, "2030-01-31");
});
test("historical payments reduce balance without consuming anchored installments", () => {
  assert.equal(schedule([payment(2500, "2029-11-01"), payment(2500, "2029-12-01"), payment(2500, "2030-02-05")]).nextPaymentDate, "2030-02-28");
});
test("multiple installments, deletion, leap-year and year rollover recalculate", () => {
  assert.equal(schedule([payment(5000, "2030-02-05")]).nextPaymentDate, "2030-03-31");
  assert.equal(schedule([]).nextPaymentDate, "2030-01-31");
  assert.equal(paymentSchedule(12345, 2500, "2029-12-31", [payment(2500, "2030-01-05")]).nextPaymentDate, "2030-01-31");
  assert.equal(paymentSchedule(12345, 2500, "2032-01-31", [payment(2500, "2032-02-05")]).nextPaymentDate, "2032-02-29");
});
test("caps final installment and removes due date when paid off", () => {
  assert.deepEqual(schedule([payment(11000, "2030-01-31")]), { nextPaymentDate: "2030-05-31", nextPaymentCents: 1345 });
  assert.deepEqual(schedule([payment(12345, "2030-01-31")]), { nextPaymentDate: null, nextPaymentCents: 0 });
});
