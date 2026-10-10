import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const trackerSettings = sqliteTable("tracker_settings", {
  id: integer("id").primaryKey(),
  totalCents: integer("total_cents").notNull().default(0),
  nextPaymentCents: integer("next_payment_cents").notNull().default(0),
  nextPaymentDate: text("next_payment_date").notNull().default(""),
});

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  amountCents: integer("amount_cents").notNull(),
  paidOn: text("paid_on").notNull(),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  submittedBy: text("submitted_by").notNull().default(""),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("payments_paid_on_idx").on(table.paidOn),
  index("payments_status_idx").on(table.status),
]);

export const inviteCodes = sqliteTable("invite_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codeHash: text("code_hash").notNull().unique(),
  codeCiphertext: text("code_ciphertext").notNull(),
  status: text("status", { enum: ["active", "redeemed", "revoked"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  redeemedByEmail: text("redeemed_by_email"),
  redeemedByName: text("redeemed_by_name"),
  redeemedAt: text("redeemed_at"),
  revokedAt: text("revoked_at"),
}, (table) => [index("invite_codes_status_idx").on(table.status)]);

export const accessGrants = sqliteTable("access_grants", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  inviteCodeId: integer("invite_code_id").notNull().unique().references(() => inviteCodes.id),
  active: integer("active").notNull().default(1),
  grantedAt: text("granted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
}, (table) => [index("access_grants_active_idx").on(table.active)]);

export const inviteAttempts = sqliteTable("invite_attempts", {
  email: text("email").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lockedUntil: text("locked_until"),
});
