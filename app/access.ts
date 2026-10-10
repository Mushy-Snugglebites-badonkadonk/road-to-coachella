import { env } from "cloudflare:workers";
import { isOwner } from "./authorization";
export { isSameOriginRequest } from "./request-security";

type RuntimeEnv = typeof env & { INVITE_CODE_SECRET?: string };

export type InviteRow = {
  id: number;
  code_hash: string;
  code_ciphertext: string;
  status: "active" | "redeemed" | "revoked";
  created_at: string;
  expires_at: string;
  redeemed_by_email: string | null;
  redeemed_by_name: string | null;
  redeemed_at: string | null;
  revoked_at: string | null;
};

const createInviteCodes = `CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  redeemed_by_email TEXT,
  redeemed_by_name TEXT,
  redeemed_at TEXT,
  revoked_at TEXT
)`;

const createAccessGrants = `CREATE TABLE IF NOT EXISTS access_grants (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  invite_code_id INTEGER NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id)
)`;

const createInviteAttempts = `CREATE TABLE IF NOT EXISTS invite_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TEXT
)`;

export async function initializeAccess() {
  const db = env.DB;
  await db.batch([
    db.prepare(createInviteCodes),
    db.prepare(createAccessGrants),
    db.prepare(createInviteAttempts),
    db.prepare("CREATE INDEX IF NOT EXISTS invite_codes_status_idx ON invite_codes(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS access_grants_active_idx ON access_grants(active)"),
  ]);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hasSiteAccess(email: string) {
  if (isOwner(email)) return true;
  await initializeAccess();
  const row = await env.DB.prepare("SELECT active FROM access_grants WHERE email = ?")
    .bind(normalizeEmail(email)).first<{ active: number }>();
  return row?.active === 1;
}

export function generateInviteCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `RTTD-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

export function normalizeInviteCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function hashInviteCode(value: string) {
  const data = new TextEncoder().encode(normalizeInviteCode(value));
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

export async function encryptInviteCode(value: string) {
  const key = await inviteEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptInviteCode(value: string) {
  const [ivPart, ciphertextPart] = value.split(".");
  if (!ivPart || !ciphertextPart) throw new Error("Invalid encrypted invitation code.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(ivPart) },
    await inviteEncryptionKey(),
    base64UrlDecode(ciphertextPart),
  );
  return new TextDecoder().decode(plaintext);
}

async function inviteEncryptionKey() {
  const encoded = String((env as RuntimeEnv).INVITE_CODE_SECRET ?? "").trim();
  if (!encoded) throw new Error("Invitation-code encryption is not configured.");
  const bytes = base64UrlDecode(encoded);
  if (bytes.byteLength !== 32) throw new Error("Invitation-code encryption key is invalid.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
