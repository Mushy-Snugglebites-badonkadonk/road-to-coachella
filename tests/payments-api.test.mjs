import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import test from "node:test";

// Execute actual route/helpers with explicit synthetic identity and D1 boundary.
// This is a unit harness, not a substitute for trusted-gateway deployment tests.
async function harness({ configured = false, owner = true, authenticated = true, changes = 1, easterEgg = false, access = true } = {}) {
  const calls = [];
  const environment = { OWNER_EMAIL: "owner@example.test", OWNER_DISPLAY_NAME: "Test Owner", EASTER_EGG_ENABLED: easterEgg ? "true" : "false" };
  if (configured) Object.assign(environment, { TRACKER_TOTAL_CENTS: "12345", TRACKER_INSTALLMENT_CENTS: "2500", TRACKER_ANCHOR_DATE: "2030-01-31" });
  environment.DB = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() { calls.push({ sql, values: this.values }); return { meta: { changes } }; },
        async all() { calls.push({ sql, values: this.values }); return { results: [] }; },
        async first() { return { status: "approved" }; },
      };
      return statement;
    },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  };
  const context = createContext({ Request, Response, Headers, URL, console, atob });
  const modules = new Map();
  const synthetic = (values) => new SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const root = fileURLToPath(new URL("../", import.meta.url));
  const stubs = new Map([
    ["cloudflare:workers", synthetic({ env: environment })],
    // Explicit synthetic inline media, not substituted production artwork.
    ["../private/easter_egg.jpg?inline", synthetic({ default: "data:image/jpeg;base64,dGVzdA==" })],
    ["../private/easter_egg.m4a?inline", synthetic({ default: "data:audio/mp4;base64,dGVzdA==" })],
    [resolve(root, "app/chatgpt-auth.ts"), synthetic({ getChatGPTUser: async () => authenticated ? { email: owner ? "owner@example.test" : "submitter@example.test", displayName: "Synthetic User", fullName: null } : null })],
    [resolve(root, "app/access.ts"), synthetic({ hasSiteAccess: async () => access })],
  ]);
  async function load(path) {
    if (stubs.has(path)) return stubs.get(path);
    if (modules.has(path)) return modules.get(path);
    const source = stripTypeScriptTypes(await readFile(path, "utf8"));
    const compiled = new SourceTextModule(source, { context, identifier: path });
    modules.set(path, compiled);
    await compiled.link((specifier, parent) => {
      if (stubs.has(specifier)) return stubs.get(specifier);
      const target = resolve(dirname(parent.identifier), specifier);
      return load(target.endsWith(".ts") ? target : `${target}.ts`);
    });
    return compiled;
  }
  const compiled = await load(resolve(root, "app/api/payments/route.ts"));
  await compiled.evaluate();
  return { api: compiled.namespace, calls, async media() {
    const mediaModule = await load(resolve(root, "app/private-media.ts"));
    await mediaModule.evaluate();
    return mediaModule.namespace;
  } };
}
const request = (method, body = { amount: 12.34, paidOn: "2030-01-21", id: 1, action: "update" }) => new Request("https://tracker.example/api/payments?id=1", { method, headers: { origin: "https://tracker.example", "content-type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });

test("all payment mutation methods reject unconfigured settings before touching D1", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const { api, calls } = await harness();
    const response = await api[method](request(method));
    assert.equal(response.status, 503, method);
    assert.match((await response.json()).error, /Configuration required/);
    assert.equal(calls.length, 0, `${method} must not mutate the database`);
  }
});
test("unconfigured GET reports safe zero data, never a paid-in-full default", async () => {
  const { api } = await harness();
  const response = await api.GET();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.configured, false);
  assert.equal(data.totalCents, 0);
  assert.equal(data.nextPaymentCents, 0);
  assert.equal(data.nextPaymentDate, null);
});
test("configured owner creation reaches real SQL and binds the configured cap", async () => {
  const { api, calls } = await harness({ configured: true });
  const response = await api.POST(request("POST"));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.configured, true);
  assert.equal(data.totalCents, 12345);
  assert.equal(data.installmentCents, 2500);
  assert.equal(data.nextPaymentDate, "2030-01-31");
  const settings = calls.find(({ sql }) => sql.startsWith("INSERT INTO tracker_settings"));
  assert.deepEqual(settings.values, [12345, 2500, "2030-01-31"]);
  const insert = calls.find(({ sql }) => sql.startsWith("INSERT INTO payments"));
  assert.match(insert.sql, /total_cents FROM tracker_settings/);
  assert.equal(insert.values[0], 1234);
});
test("configured creation enforces configured bounds and atomic total rejection", async () => {
  const invalid = await harness({ configured: true });
  assert.equal((await invalid.api.POST(request("POST", { amount: 123.46, paidOn: "2030-01-21" }))).status, 400);
  assert.equal(invalid.calls.length, 0);
  const full = await harness({ configured: true, changes: 0 });
  assert.equal((await full.api.POST(request("POST"))).status, 409);
});
test("configured submitters create pending entries but cannot manage payments", async () => {
  const { api, calls } = await harness({ configured: true, owner: false });
  assert.equal((await api.POST(request("POST"))).status, 201);
  assert.match(calls.find(({ sql }) => sql.startsWith("INSERT INTO payments")).sql, /'pending'/);
  assert.equal((await api.PATCH(request("PATCH"))).status, 403);
  assert.equal((await api.DELETE(request("DELETE"))).status, 403);
});
test("configured owner update, approve, reject and delete reach SQL mutations", async () => {
  for (const action of ["update", "approve", "reject"]) {
    const { api, calls } = await harness({ configured: true });
    assert.equal((await api.PATCH(request("PATCH", { id: 1, action, amount: 12.34, paidOn: "2030-01-21" }))).status, 200);
    assert.ok(calls.some(({ sql }) => sql.startsWith("UPDATE payments")), action);
  }
  const { api, calls } = await harness({ configured: true });
  assert.equal((await api.DELETE(request("DELETE"))).status, 200);
  assert.ok(calls.some(({ sql }) => sql.startsWith("DELETE FROM payments")));
});
test("easter egg is opt-in and authorized media remains non-cacheable", async () => {
  const req = new Request("https://tracker.example/api/media/easter-egg-face");
  const disabled = await harness();
  assert.equal((await (await disabled.media()).privateEasterEggImage(req)).status, 404);
  const enabled = await harness({ easterEgg: true });
  const response = await (await enabled.media()).privateEasterEggImage(req);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(await response.text(), "test");
  for (const options of [{ authenticated: false }, { owner: false, access: false }]) {
    const denied = await harness({ easterEgg: true, ...options });
    const media = await denied.media();
    assert.equal((await media.privateEasterEggImage(req)).status, 404);
    assert.equal((await media.privateEasterEggAudio(req)).status, 404);
  }
});

test("anonymous requests and cross-origin mutations are rejected", async () => {
  const { api } = await harness({ configured: true, authenticated: false });
  assert.equal((await api.GET()).status, 401);
  assert.equal((await api.POST(request("POST"))).status, 401);
  assert.equal((await api.POST(new Request("https://tracker.example/api/payments", { method: "POST", headers: { origin: "https://attacker.example" } }))).status, 403);
});
