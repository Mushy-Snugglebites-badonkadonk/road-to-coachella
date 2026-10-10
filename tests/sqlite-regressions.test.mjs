import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const ownerEmail = "owner@example.test";
const viewerEmail = "viewer@example.test";
const otherEmail = "other@example.test";
const code = "RTTD-2345-6789-ABCD";
const request = (path, method, body) => new Request(`https://tracker.example/api/${path}`, {
  method, headers: { origin: "https://tracker.example", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const redeem = (api) => api.POST(request("access/redeem", "POST", { code }));
const revoke = (api, id = 1) => api.PATCH(request("invites", "PATCH", { id, action: "revoke" }));
const patch = (api, action, id, amount = 90) => api.PATCH(request("payments", "PATCH", {
  action, id, amount, paidOn: "2030-01-21", note: "Synthetic edited note",
}));

async function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(resolve(root, "drizzle/0000_initial_schema.sql"), "utf8"));
  t.after(() => db.close());
  return db;
}

// Load the actual production routes/helpers, not copied SQL. The adapter executes
// their exact statements/bindings in real SQLite, with D1's atomic batch contract.
// Hooks model competing requests between reads and atomic writes deterministically.
async function harness(db, { email = viewerEmail, beforeWrite = async () => {}, beforeBatch = async () => {} } = {}) {
  const batches = [];
  const environment = {
    OWNER_EMAIL: ownerEmail, OWNER_DISPLAY_NAME: "Synthetic Owner",
    TRACKER_TOTAL_CENTS: "10000", TRACKER_INSTALLMENT_CENTS: "2500", TRACKER_ANCHOR_DATE: "2030-01-31",
  };
  environment.DB = {
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        execute() { const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; },
        async run() { await beforeWrite(sql, this.values); return this.execute(); },
        async all() { return { results: db.prepare(sql).all(...this.values) }; },
        async first() { return db.prepare(sql).get(...this.values) ?? null; },
      };
    },
    async batch(statements) {
      await beforeBatch(statements);
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = Array.from(statements, (statement) => statement.execute());
        db.exec("COMMIT");
        batches.push({ statements, results });
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const context = createContext({ Request, Response, Headers, URL, console, crypto, TextEncoder, TextDecoder, atob, btoa });
  const modules = new Map();
  const synthetic = (values) => new SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const stubs = new Map([
    ["cloudflare:workers", synthetic({ env: environment })],
    [resolve(root, "app/chatgpt-auth.ts"), synthetic({ getChatGPTUser: async () => ({ email, displayName: "Synthetic User", fullName: null }) })],
  ]);
  async function load(path) {
    if (stubs.has(path)) return stubs.get(path);
    if (modules.has(path)) return modules.get(path);
    const compiled = new SourceTextModule(stripTypeScriptTypes(await readFile(path, "utf8")), { context, identifier: path });
    modules.set(path, compiled);
    await compiled.link((specifier, parent) => {
      if (stubs.has(specifier)) return stubs.get(specifier);
      const target = resolve(dirname(parent.identifier), specifier);
      return load(target.endsWith(".ts") ? target : `${target}.ts`);
    });
    return compiled;
  }
  async function api(path) {
    const compiled = await load(resolve(root, path));
    await compiled.evaluate();
    return compiled.namespace;
  }
  return { api, batches };
}

async function invite(db, harness, expires = "2999-01-01 00:00:00") {
  const access = await harness.api("app/access.ts");
  db.prepare("INSERT INTO invite_codes (code_hash, code_ciphertext, expires_at) VALUES (?, 'synthetic-unused-ciphertext', ?)")
    .run(await access.hashInviteCode(code), expires);
}
function grant(db, email = viewerEmail) {
  db.prepare("INSERT INTO invite_codes (code_hash, code_ciphertext, expires_at, status) VALUES (?, '', '2999-01-01', 'redeemed')").run(`synthetic-${email}`);
  db.prepare("INSERT INTO access_grants (email, invite_code_id) VALUES (?, last_insert_rowid())").run(email);
}
function payment(db, id, amount, status = "pending", email = otherEmail) {
  db.prepare("INSERT INTO payments (id, amount_cents, paid_on, note, status, submitted_by, approved_by, approved_at, created_at) VALUES (?, ?, '2030-01-21', 'Synthetic private note', ?, ?, ?, '2030-01-22 01:02:03', '2030-01-20 04:05:06')")
    .run(id, amount, status, email, ownerEmail);
}
const approvedTotal = (db) => db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE status = 'approved'").get().total;

function claimBatch(statements) { return statements[0]?.sql.startsWith("UPDATE invite_codes SET status = 'redeemed'"); }

test("SQLite: revocation after invitation lookup prevents claim and any grant write", async (t) => {
  const db = await database(t);
  const owner = await harness(db, { email: ownerEmail });
  const ownerApi = await owner.api("app/api/invites/route.ts");
  let interleaved = false;
  const viewer = await harness(db, { beforeBatch: async (statements) => {
    if (!claimBatch(statements)) return;
    interleaved = true;
    assert.equal((await revoke(ownerApi)).status, 200);
  } });
  await invite(db, viewer);
  db.prepare("INSERT INTO invite_attempts (email, attempts) VALUES (?, 1)").run(viewerEmail);
  const response = await redeem(await viewer.api("app/api/access/redeem/route.ts"));
  assert.equal(interleaved, true);
  assert.equal(response.status, 400);
  assert.equal(db.prepare("SELECT attempts FROM invite_attempts WHERE email = ?").get(viewerEmail).attempts, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM access_grants").get().count, 0);
  assert.equal(db.prepare("SELECT status FROM invite_codes").get().status, "revoked");
  assert.deepEqual(viewer.batches.at(-1).results.map((result) => result.meta.changes), [0, 0, 0]);
});

test("SQLite: expiry after invitation lookup is rechecked by the claim", async (t) => {
  const db = await database(t);
  const viewer = await harness(db, { beforeBatch: async (statements) => {
    if (claimBatch(statements)) db.exec("UPDATE invite_codes SET expires_at = '2000-01-01 00:00:00'");
  } });
  await invite(db, viewer);
  assert.equal((await redeem(await viewer.api("app/api/access/redeem/route.ts"))).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM access_grants").get().count, 0);
  assert.equal(db.prepare("SELECT status FROM invite_codes").get().status, "active");
});

test("SQLite: two identities racing to redeem only grant the successful claimant", async (t) => {
  const db = await database(t);
  const winner = await harness(db, { email: otherEmail });
  const winnerApi = await winner.api("app/api/access/redeem/route.ts");
  const loser = await harness(db, { beforeBatch: async (statements) => {
    if (claimBatch(statements)) assert.equal((await redeem(winnerApi)).status, 200);
  } });
  await invite(db, loser);
  assert.equal((await redeem(await loser.api("app/api/access/redeem/route.ts"))).status, 400);
  const rows = db.prepare("SELECT email, active FROM access_grants").all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ email: otherEmail, active: 1 }]);
  assert.equal(db.prepare("SELECT redeemed_by_email FROM invite_codes").get().redeemed_by_email, otherEmail);
});

test("SQLite: duplicate same-identity redemption cannot write after a lost claim", async (t) => {
  const db = await database(t);
  const first = await harness(db);
  const firstApi = await first.api("app/api/access/redeem/route.ts");
  const second = await harness(db, { beforeBatch: async (statements) => {
    if (claimBatch(statements)) assert.equal((await redeem(firstApi)).status, 200);
  } });
  await invite(db, second);
  assert.equal((await redeem(await second.api("app/api/access/redeem/route.ts"))).status, 400);
  assert.deepEqual(second.batches.at(-1).results.map((result) => result.meta.changes), [0, 0, 0]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM access_grants WHERE active = 1").get().count, 1);
});

test("SQLite: outstanding same-identity duplicate cannot restore a revoked grant", async (t) => {
  const db = await database(t);
  const first = await harness(db);
  const firstApi = await first.api("app/api/access/redeem/route.ts");
  const owner = await harness(db, { email: ownerEmail });
  const ownerApi = await owner.api("app/api/invites/route.ts");
  const duplicate = await harness(db, { beforeBatch: async (statements) => {
    if (!claimBatch(statements)) return;
    assert.equal((await redeem(firstApi)).status, 200);
    assert.equal((await revoke(ownerApi)).status, 200);
  } });
  await invite(db, duplicate);
  assert.equal((await redeem(await duplicate.api("app/api/access/redeem/route.ts"))).status, 400);
  assert.equal(db.prepare("SELECT active FROM access_grants").get().active, 0);
  assert.equal(db.prepare("SELECT status FROM invite_codes").get().status, "revoked");
  assert.deepEqual(duplicate.batches.at(-1).results.map((result) => result.meta.changes), [0, 0, 0]);
});

test("SQLite: redemption followed by revocation removes access; fresh invite may regrant", async (t) => {
  const db = await database(t);
  const viewer = await harness(db, { email: "  VIEWER@EXAMPLE.TEST  " });
  await invite(db, viewer);
  db.prepare("INSERT INTO invite_attempts (email, attempts) VALUES (?, 1)").run(viewerEmail);
  const api = await viewer.api("app/api/access/redeem/route.ts");
  assert.equal((await redeem(api)).status, 200);
  assert.deepEqual(viewer.batches.at(-1).results.map((result) => result.meta.changes), [1, 1, 1]);
  assert.equal(db.prepare("SELECT email FROM access_grants").get().email, viewerEmail);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invite_attempts").get().count, 0);
  const access = await viewer.api("app/access.ts");
  assert.equal(await access.hasSiteAccess(viewerEmail), true);
  const owner = await harness(db, { email: ownerEmail });
  assert.equal((await revoke(await owner.api("app/api/invites/route.ts"))).status, 200);
  assert.equal(await access.hasSiteAccess(viewerEmail), false);
  assert.equal((await redeem(api)).status, 400);
  db.exec("UPDATE invite_codes SET code_hash = 'synthetic-old-hash' WHERE id = 1");
  await invite(db, viewer);
  assert.equal((await redeem(api)).status, 200);
  assert.equal(await access.hasSiteAccess(viewerEmail), true);
  assert.equal(db.prepare("SELECT invite_code_id FROM access_grants").get().invite_code_id, 2);
});

test("SQLite: grant failure rolls the claim back, never returns success", async (t) => {
  const db = await database(t);
  const viewer = await harness(db);
  await invite(db, viewer);
  db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON access_grants BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.equal((await redeem(await viewer.api("app/api/access/redeem/route.ts"))).status, 500);
  assert.equal(db.prepare("SELECT status FROM invite_codes").get().status, "active");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM access_grants").get().count, 0);
});

test("SQLite: approval interleaved before pending edit cannot bypass approved total cap", async (t) => {
  const db = await database(t);
  payment(db, 1, 4000, "approved");
  payment(db, 2, 1000);
  const approver = await harness(db, { email: ownerEmail });
  const approveApi = await approver.api("app/api/payments/route.ts");
  let interleaved = false;
  const editor = await harness(db, { email: ownerEmail, beforeWrite: async (sql) => {
    if (!sql.startsWith("UPDATE payments SET amount_cents")) return;
    interleaved = true;
    assert.equal((await patch(approveApi, "approve", 2)).status, 200);
  } });
  assert.equal((await patch(await editor.api("app/api/payments/route.ts"), "update", 2)).status, 409);
  assert.equal(interleaved, true);
  assert.equal(approvedTotal(db), 5000);
  assert.equal(db.prepare("SELECT amount_cents FROM payments WHERE id = 2").get().amount_cents, 1000);
});

test("SQLite: pending edit interleaved before approval is included in approval cap", async (t) => {
  const db = await database(t);
  payment(db, 1, 4000, "approved");
  payment(db, 2, 1000);
  const editor = await harness(db, { email: ownerEmail });
  const editApi = await editor.api("app/api/payments/route.ts");
  const approver = await harness(db, { email: ownerEmail, beforeWrite: async (sql) => {
    if (sql.startsWith("UPDATE payments SET status = 'approved'")) assert.equal((await patch(editApi, "update", 2)).status, 200);
  } });
  assert.equal((await patch(await approver.api("app/api/payments/route.ts"), "approve", 2)).status, 409);
  assert.equal(approvedTotal(db), 4000);
  assert.equal(db.prepare("SELECT status FROM payments WHERE id = 2").get().status, "pending");
});

test("SQLite: competing approvals and owner inserts each enforce the current total", async (t) => {
  const db = await database(t);
  payment(db, 1, 6000);
  payment(db, 2, 6000);
  const owner = await harness(db, { email: ownerEmail });
  const api = await owner.api("app/api/payments/route.ts");
  assert.equal((await patch(api, "approve", 1)).status, 200);
  assert.equal((await patch(api, "approve", 2)).status, 409);
  assert.equal((await api.POST(request("payments", "POST", { amount: 60, paidOn: "2030-01-21" }))).status, 409);
  assert.equal((await patch(api, "update", 1, 100)).status, 200);
  assert.equal(approvedTotal(db), 10000);
  assert.equal((await patch(api, "approve", 2)).status, 409);
  assert.equal((await patch(api, "update", 999)).status, 409);
});

test("SQLite privacy: shared approved ledger redacts other participants, keeps own entries and owner audit", async (t) => {
  const db = await database(t);
  grant(db);
  payment(db, 1, 1000, "approved", viewerEmail);
  payment(db, 2, 2000, "approved");
  payment(db, 3, 3000, "pending");
  const viewer = await harness(db);
  const response = await (await viewer.api("app/api/payments/route.ts")).GET();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.payments.reduce((total, payment) => total + payment.amountCents, 0), 3000);
  assert.equal(data.nextPaymentCents, 2500);
  assert.deepEqual(data.payments.map(({ id, amountCents, paidOn, status }) => ({ id, amountCents, paidOn, status })), [
    { id: 1, amountCents: 1000, paidOn: "2030-01-21", status: "approved" },
    { id: 2, amountCents: 2000, paidOn: "2030-01-21", status: "approved" },
  ]);
  const shared = data.payments.find(({ id }) => id === 2);
  assert.deepEqual(shared, { id: 2, amountCents: 2000, paidOn: "2030-01-21", status: "approved", note: "", submittedBy: "", approvedBy: null, approvedAt: null, createdAt: "" });
  assert.equal(JSON.stringify(data).includes(otherEmail), false);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].submittedBy, viewerEmail);
  assert.equal(data.entries[0].note, "Synthetic private note");
  assert.equal(data.payments[0].note, "Synthetic private note");
  const owner = await harness(db, { email: ownerEmail });
  const audit = await (await (await owner.api("app/api/payments/route.ts")).GET()).json();
  assert.equal(audit.entries.length, 3);
  assert.equal(audit.payments[1].submittedBy, otherEmail);
  assert.equal(audit.payments[1].note, "Synthetic private note");
  assert.equal(audit.payments[1].approvedAt, "2030-01-22 01:02:03");
});
