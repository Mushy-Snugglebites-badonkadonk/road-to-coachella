import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TRACKER_CONFIG, trackerConfig, progressPercent, safeMetadataBase } from "../app/tracker-config.ts";

// Explicitly synthetic fixtures; no personal balances or dates.
const synthetic = { TRACKER_TOTAL_CENTS: "12345", TRACKER_INSTALLMENT_CENTS: "2500", TRACKER_ANCHOR_DATE: "2030-01-31" };
test("defaults require configuration and contain zero amounts and blank date", () => {
  assert.deepEqual(trackerConfig({}), { ...DEFAULT_TRACKER_CONFIG, configured: false });
  assert.deepEqual(DEFAULT_TRACKER_CONFIG, { totalCents: 0, installmentCents: 0, anchorDate: "" });
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(100, 0), 0);
  assert.equal(progressPercent(125, 500), 25);
  assert.equal(progressPercent(600, 500), 100);
});
test("configuration is atomic and rejects malformed amounts and invalid dates", () => {
  assert.equal(trackerConfig(synthetic).configured, true);
  for (const patch of [{ TRACKER_TOTAL_CENTS: "0" }, { TRACKER_INSTALLMENT_CENTS: "0" }, { TRACKER_TOTAL_CENTS: "-1" }, { TRACKER_TOTAL_CENTS: "1.2" }, { TRACKER_TOTAL_CENTS: "Infinity" }, { TRACKER_TOTAL_CENTS: "1e3" }, { TRACKER_TOTAL_CENTS: "9007199254740992" }, { TRACKER_ANCHOR_DATE: "2030-02-30" }, { TRACKER_ANCHOR_DATE: "" }]) {
    assert.deepEqual(trackerConfig({ ...synthetic, ...patch }), { ...DEFAULT_TRACKER_CONFIG, configured: false });
  }
});
test("metadata uses an explicit safe origin, never incoming forwarded hosts", () => {
  assert.equal(safeMetadataBase("").href, "http://localhost:3000/");
  assert.equal(safeMetadataBase("https://tracker.example/path?q=1").href, "https://tracker.example/");
  for (const url of ["javascript:alert(1)", "http://remote.example", "https://user:password@example.com", "not a url"]) {
    assert.equal(safeMetadataBase(url).href, "http://localhost:3000/");
  }
  assert.equal(safeMetadataBase("http://127.0.0.1:3001").href, "http://127.0.0.1:3001/");
});
