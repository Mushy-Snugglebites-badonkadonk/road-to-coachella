export const DEFAULT_TRACKER_CONFIG = Object.freeze({ totalCents: 0, installmentCents: 0, anchorDate: "" });
export type TrackerConfig = { totalCents: number; installmentCents: number; anchorDate: string; configured: boolean };
export type TrackerEnvironment = {
  TRACKER_TOTAL_CENTS?: string;
  TRACKER_INSTALLMENT_CENTS?: string;
  TRACKER_ANCHOR_DATE?: string;
};

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isConfiguredSchedule(total: number, installment: number, anchor: string) {
  return Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(installment) && installment > 0 && isCalendarDate(anchor);
}

export function trackerConfig(environment: TrackerEnvironment): TrackerConfig {
  const total = String(environment.TRACKER_TOTAL_CENTS ?? "0").trim();
  const installment = String(environment.TRACKER_INSTALLMENT_CENTS ?? "0").trim();
  const anchor = String(environment.TRACKER_ANCHOR_DATE ?? "").trim();
  if (!/^\d+$/.test(total) || !/^\d+$/.test(installment) || !isConfiguredSchedule(Number(total), Number(installment), anchor)) {
    return { ...DEFAULT_TRACKER_CONFIG, configured: false };
  }
  return { totalCents: Number(total), installmentCents: Number(installment), anchorDate: anchor, configured: true };
}

export function progressPercent(paidCents: number, totalCents: number) {
  if (!Number.isFinite(totalCents) || totalCents <= 0 || !Number.isFinite(paidCents)) return 0;
  return Math.max(0, Math.min(Math.round((paidCents / totalCents) * 100), 100));
}

// Explicit operator configuration only; do not trust Host or forwarded headers.
export function safeMetadataBase(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Unsafe metadata origin");
    return new URL(url.origin);
  } catch {
    return new URL("http://localhost:3000");
  }
}
