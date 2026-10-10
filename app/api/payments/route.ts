import { getTrackerConfig, ownerDisplayName } from "../../server-config";
import type { TrackerConfig } from "../../tracker-config";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { isOwner } from "../../authorization";
import { hasSiteAccess } from "../../access";
import { validatePayment } from "../../payment-validation";
import { isSameOriginRequest, jsonNoStore } from "../../request-security";
import { paymentSchedule } from "../../payment-schedule";

type PaymentRow = {
  id: number;
  amount_cents: number;
  paid_on: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  submitted_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

const createSettings = `CREATE TABLE IF NOT EXISTS tracker_settings (
  id INTEGER PRIMARY KEY,
  total_cents INTEGER NOT NULL DEFAULT 0,
  next_payment_cents INTEGER NOT NULL DEFAULT 0,
  next_payment_date TEXT NOT NULL DEFAULT ''
)`;

const createPayments = `CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_cents INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function paymentDto(row: PaymentRow, email: string, owner: boolean) {
  const canAudit = owner || row.submitted_by.trim().toLowerCase() === email.trim().toLowerCase();
  const submittedBy = row.submitted_by && isOwner(row.submitted_by) ? ownerDisplayName() : row.submitted_by;
  const approvedBy = row.approved_by && isOwner(row.approved_by) ? ownerDisplayName() : row.approved_by;
  // The shared ledger needs amounts/dates, not another participant's identity,
  // notes or audit timestamps. Preserve the DTO shape for progress/chart clients.
  return {
    id: row.id,
    amountCents: row.amount_cents,
    paidOn: row.paid_on,
    note: canAudit ? row.note : "",
    status: row.status,
    submittedBy: canAudit ? submittedBy : "",
    approvedBy: canAudit ? approvedBy : null,
    approvedAt: canAudit ? row.approved_at : null,
    createdAt: canAudit ? row.created_at : "",
  };
}

async function initialize(config: TrackerConfig) {
  const db = env.DB;
  await db.batch([
    db.prepare(createSettings),
    db.prepare(createPayments),
    db.prepare("CREATE INDEX IF NOT EXISTS payments_paid_on_idx ON payments(paid_on)"),
  ]);

  await db.prepare("CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status)").run();
  // Runtime environment is authoritative; the row supports atomic SQL caps.
  await db.prepare("INSERT INTO tracker_settings (id, total_cents, next_payment_cents, next_payment_date) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET total_cents = excluded.total_cents, next_payment_cents = excluded.next_payment_cents, next_payment_date = excluded.next_payment_date")
    .bind(config.totalCents, config.installmentCents, config.anchorDate).run();
}

async function readTracker(email: string, owner: boolean) {
  const config = getTrackerConfig();
  await initialize(config);
  const { results: approvedRows } = await env.DB.prepare("SELECT * FROM payments WHERE status = 'approved' ORDER BY paid_on ASC, id ASC").all<PaymentRow>();
  const entriesQuery = owner
    ? env.DB.prepare("SELECT * FROM payments ORDER BY created_at DESC, id DESC")
    : env.DB.prepare("SELECT * FROM payments WHERE submitted_by = ? ORDER BY created_at DESC, id DESC").bind(email);
  const { results: entryRows } = await entriesQuery.all<PaymentRow>();
  return {
    configured: config.configured,
    totalCents: config.totalCents,
    installmentCents: config.installmentCents,
    ...paymentSchedule(config.totalCents, config.installmentCents, config.anchorDate, approvedRows),
    payments: approvedRows.map((row) => paymentDto(row, email, owner)),
    entries: entryRows.map((row) => paymentDto(row, email, owner)),
    viewer: { isOwner: owner },
  };
}

async function requireUser() {
  const user = await getChatGPTUser();
  if (!user) return null;
  const owner = isOwner(user.email);
  if (!owner && !await hasSiteAccess(user.email)) return null;
  return { ...user, owner };
}

export async function GET() {
  const user = await requireUser();
  if (!user) return jsonNoStore({ error: "Sign in to continue." }, { status: 401 });
  try {
    return jsonNoStore(await readTracker(user.email, user.owner));
  } catch {
    return jsonNoStore({ error: "Saved payments are temporarily unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return jsonNoStore({ error: "That request was not accepted." }, { status: 403 });
  const user = await requireUser();
  if (!user) return jsonNoStore({ error: "Sign in to continue." }, { status: 401 });
  const config = getTrackerConfig();
  if (!config.configured) return jsonNoStore({ error: "Configuration required: set the total, installment, and anchor date before changing payments." }, { status: 503 });
  try {
    const parsed = validatePayment(await request.json() as { amount?: number; paidOn?: string; note?: string }, config.totalCents);
    if (!parsed) return jsonNoStore({ error: "Enter a positive amount within the configured total and a valid date." }, { status: 400 });
    await initialize(config);
    let result: D1Result<unknown>;
    if (!user.owner) {
      result = await env.DB.prepare("INSERT INTO payments (amount_cents, paid_on, note, status, submitted_by) SELECT ?, ?, ?, 'pending', ? WHERE (SELECT COUNT(*) FROM payments WHERE submitted_by = ? AND status = 'pending') < 10")
        .bind(parsed.amountCents, parsed.paidOn, parsed.note, user.email, user.email).run();
      if (result.meta.changes !== 1) return jsonNoStore({ error: "You already have 10 payments awaiting review." }, { status: 429 });
    } else {
      result = await env.DB.prepare("INSERT INTO payments (amount_cents, paid_on, note, status, submitted_by, approved_by, approved_at) SELECT ?, ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP WHERE (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'approved') + ? <= (SELECT total_cents FROM tracker_settings WHERE id = 1)")
        .bind(parsed.amountCents, parsed.paidOn, parsed.note, user.email, user.email, parsed.amountCents).run();
      if (result.meta.changes !== 1) return jsonNoStore({ error: "That payment would exceed the configured repayment total." }, { status: 409 });
    }
    return jsonNoStore(await readTracker(user.email, user.owner), { status: 201 });
  } catch {
    return jsonNoStore({ error: "That payment could not be submitted." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return jsonNoStore({ error: "That request was not accepted." }, { status: 403 });
  const user = await requireUser();
  if (!user) return jsonNoStore({ error: "Sign in to continue." }, { status: 401 });
  if (!user.owner) return jsonNoStore({ error: "Only the owner can manage payments." }, { status: 403 });
  const config = getTrackerConfig();
  if (!config.configured) return jsonNoStore({ error: "Configuration required: set the total, installment, and anchor date before changing payments." }, { status: 503 });
  try {
    await initialize(config);
    const payload = await request.json() as { id?: number; action?: string; amount?: number; paidOn?: string; note?: string };
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) return jsonNoStore({ error: "Choose a valid payment." }, { status: 400 });
    let result: D1Result<unknown>;
    if (payload.action === "approve") {
      result = await env.DB.prepare("UPDATE payments SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending' AND (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'approved') + amount_cents <= (SELECT total_cents FROM tracker_settings WHERE id = 1)").bind(user.email, id).run();
    } else if (payload.action === "reject") {
      result = await env.DB.prepare("UPDATE payments SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(user.email, id).run();
    } else if (payload.action === "update") {
      const parsed = validatePayment(payload, config.totalCents);
      if (!parsed) return jsonNoStore({ error: "Enter a positive amount within the configured total and a valid date." }, { status: 400 });
      // Test the row's current status and approved balance inside one write;
      // an approval between a status read and an edit must not bypass the cap.
      result = await env.DB.prepare("UPDATE payments SET amount_cents = ?, paid_on = ?, note = ? WHERE id = ? AND (status != 'approved' OR (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'approved' AND id != ?) + ? <= (SELECT total_cents FROM tracker_settings WHERE id = 1))")
        .bind(parsed.amountCents, parsed.paidOn, parsed.note, id, id, parsed.amountCents).run();
    } else {
      return jsonNoStore({ error: "Choose a valid management action." }, { status: 400 });
    }
    if (result.meta.changes !== 1) return jsonNoStore({ error: "That payment no longer exists or has already changed." }, { status: 409 });
    return jsonNoStore(await readTracker(user.email, true));
  } catch {
    return jsonNoStore({ error: "That payment could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return jsonNoStore({ error: "That request was not accepted." }, { status: 403 });
  const user = await requireUser();
  if (!user) return jsonNoStore({ error: "Sign in to continue." }, { status: 401 });
  if (!user.owner) return jsonNoStore({ error: "Only the owner can delete payments." }, { status: 403 });
  const config = getTrackerConfig();
  if (!config.configured) return jsonNoStore({ error: "Configuration required: set the total, installment, and anchor date before changing payments." }, { status: 503 });
  try {
    await initialize(config);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) return jsonNoStore({ error: "Choose a valid payment." }, { status: 400 });
    const result = await env.DB.prepare("DELETE FROM payments WHERE id = ?").bind(id).run();
    if (result.meta.changes !== 1) return jsonNoStore({ error: "That payment no longer exists." }, { status: 404 });
    return jsonNoStore(await readTracker(user.email, true));
  } catch {
    return jsonNoStore({ error: "That payment could not be deleted." }, { status: 500 });
  }
}
