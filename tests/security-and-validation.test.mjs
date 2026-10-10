import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { validatePayment } from "../app/payment-validation.ts";
import { isSameOriginRequest, jsonNoStore } from "../app/request-security.ts";

test("accepts only exact same-origin mutation requests", () => {
  const url = "https://tracker.example/api/payments";
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: new URL(url).origin } })), true);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { "sec-fetch-site": "same-origin" } })), true);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" } })), false);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { "sec-fetch-site": "same-site" } })), false);
  assert.equal(isSameOriginRequest(new Request(url)), false);
});
test("validates configured payment bounds, dates, and control characters", () => {
  // Synthetic payment, date, note, and configured cap.
  assert.deepEqual(validatePayment({ amount: 12.34, paidOn: "2030-01-21", note: "  Test\npayment  " }, 12345), {
    amountCents: 1234, paidOn: "2030-01-21", note: "Test payment",
  });
  for (const amount of [0, -1, 123.46, Infinity, NaN]) assert.equal(validatePayment({ amount, paidOn: "2030-01-21" }, 12345), null);
  assert.equal(validatePayment({ amount: 10, paidOn: "2030-02-30" }, 12345), null);
  assert.equal(validatePayment({ amount: 10, paidOn: "2030-01-21" }, 0), null);
  assert.equal(validatePayment({ amount: 10, paidOn: "2030-01-21" }), null);
});
test("marks private JSON responses as non-cacheable", () => {
  const response = jsonNoStore({ ok: true });
  assert.match(response.headers.get("cache-control") ?? "", /private/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("pragma"), "no-cache");
});
test("keeps share URLs opaque, media private, and blocks crawler indexing", async () => {
  const [share, worker, media, robots] = await Promise.all(["app/invite-admin.tsx", "worker/index.ts", "app/private-media.ts", "public/robots.txt"].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(share, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(share, /\?invite=\$\{invite\.id\}/);
  assert.equal(share.includes("shareLink}\\nRoad to the Desert"), true);
  assert.match(worker, /X-Robots-Tag/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(media, /hasSiteAccess/);
  assert.match(media, /private, no-store/);
  assert.match(media, /private\/easter_egg\.jpg/);
  assert.match(media, /private\/easter_egg\.m4a/);
  assert.match(robots, /User-agent:\s*\*/i);
  assert.match(robots, /Disallow:\s*\//i);
  assert.deepEqual((await readdir(new URL("../private/", import.meta.url))).sort(), ["easter_egg.jpg", "easter_egg.m4a"]);
  assert.deepEqual((await readdir(new URL("../app/api/media/", import.meta.url))).sort(), ["easter-egg-audio", "easter-egg-face"]);
  const publicFiles = await readdir(new URL("../public/", import.meta.url));
  assert.deepEqual(publicFiles.filter((name) => /\.(png|jpg|m4a)$/.test(name)), ["og-road-to-desert-v3.png"]);
});
