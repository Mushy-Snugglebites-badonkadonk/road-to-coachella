import { env } from "cloudflare:workers";
import { decryptInviteCode, encryptInviteCode, generateInviteCode, hashInviteCode, initializeAccess, isSameOriginRequest } from "../../access";
import type { InviteRow } from "../../access";
import { getChatGPTUser } from "../../chatgpt-auth";
import { isOwner } from "../../authorization";
import { jsonNoStore } from "../../request-security";

async function requireOwner() {
  const user = await getChatGPTUser();
  return user && isOwner(user.email) ? user : null;
}

async function readInvites() {
  await initializeAccess();
  const { results } = await env.DB.prepare("SELECT * FROM invite_codes ORDER BY created_at DESC, id DESC").all<InviteRow>();
  return Promise.all(results.map(async (row: InviteRow) => {
    const expired = row.status === "active" && Date.parse(`${row.expires_at.replace(" ", "T")}Z`) <= Date.now();
    return {
      id: row.id,
      code: row.status === "active" && !expired ? await decryptInviteCode(row.code_ciphertext) : null,
      status: expired ? "expired" : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      redeemedBy: row.redeemed_by_email,
      redeemedName: row.redeemed_by_name,
      redeemedAt: row.redeemed_at,
    };
  }));
}

export async function GET() {
  if (!await requireOwner()) return jsonNoStore({ error: "Only the owner can view invitation codes." }, { status: 403 });
  try {
    return jsonNoStore({ invites: await readInvites() });
  } catch {
    return jsonNoStore({ error: "Invitation codes are temporarily unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await requireOwner()) return jsonNoStore({ error: "Only the owner can generate invitation codes." }, { status: 403 });
  if (!isSameOriginRequest(request)) return jsonNoStore({ error: "That request was not accepted." }, { status: 403 });
  try {
    await initializeAccess();
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
    await env.DB.prepare("INSERT INTO invite_codes (code_hash, code_ciphertext, expires_at) VALUES (?, ?, ?)")
      .bind(await hashInviteCode(code), await encryptInviteCode(code), expiresAt).run();
    return jsonNoStore({ invites: await readInvites() }, { status: 201 });
  } catch {
    return jsonNoStore({ error: "A new invitation code could not be generated." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!await requireOwner()) return jsonNoStore({ error: "Only the owner can revoke invitation codes." }, { status: 403 });
  if (!isSameOriginRequest(request)) return jsonNoStore({ error: "That request was not accepted." }, { status: 403 });
  try {
    await initializeAccess();
    const payload = await request.json() as { id?: number; action?: string };
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1 || payload.action !== "revoke") {
      return jsonNoStore({ error: "Choose a valid invitation." }, { status: 400 });
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE invite_codes SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'revoked'").bind(id),
      env.DB.prepare("UPDATE access_grants SET active = 0, revoked_at = CURRENT_TIMESTAMP WHERE invite_code_id = ?").bind(id),
    ]);
    return jsonNoStore({ invites: await readInvites() });
  } catch {
    return jsonNoStore({ error: "That invitation could not be revoked." }, { status: 500 });
  }
}
