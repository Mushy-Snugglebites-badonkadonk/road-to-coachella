import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { hashInviteCode, hasSiteAccess, initializeAccess, isSameOriginRequest, normalizeEmail } from "../../../access";
import { isOwner } from "../../../authorization";
import { jsonNoStore } from "../../../request-security";

type AttemptRow = { attempts: number; window_started_at: string; locked_until: string | null };

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return jsonNoStore({ error: "Sign in with ChatGPT to continue." }, { status: 401 });
  if (!isSameOriginRequest(request)) return jsonNoStore({ error: "That request was not accepted." }, { status: 403 });
  if (isOwner(user.email) || await hasSiteAccess(user.email)) return jsonNoStore({ ok: true });

  try {
    await initializeAccess();
    const email = normalizeEmail(user.email);
    const attempt = await env.DB.prepare("SELECT attempts, window_started_at, locked_until FROM invite_attempts WHERE email = ?")
      .bind(email).first<AttemptRow>();
    if (attempt?.locked_until && Date.parse(`${attempt.locked_until.replace(" ", "T")}Z`) > Date.now()) {
      return jsonNoStore({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    }

    const payload = await request.json() as { code?: string };
    const submittedCode = String(payload.code ?? "");
    if (submittedCode.length > 64) {
      await recordFailedAttempt(email, attempt);
      return jsonNoStore({ error: "That invitation code is invalid, expired, or has already been used." }, { status: 400 });
    }
    const invite = await env.DB.prepare("SELECT id FROM invite_codes WHERE code_hash = ? AND status = 'active' AND expires_at > CURRENT_TIMESTAMP")
      .bind(await hashInviteCode(submittedCode)).first<{ id: number }>();
    if (!invite) {
      await recordFailedAttempt(email, attempt);
      return jsonNoStore({ error: "That invitation code is invalid, expired, or has already been used." }, { status: 400 });
    }

    // D1 batch is one transaction. changes() ties the grant to this batch's
    // immediately preceding claim, not an earlier redemption by the same email.
    // Keep these statements adjacent: a lost/expired/revoked claim writes no grant.
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE invite_codes SET status = 'redeemed', redeemed_by_email = ?, redeemed_by_name = ?, redeemed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active' AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP")
        .bind(email, user.fullName ?? user.displayName, invite.id),
      env.DB.prepare("INSERT INTO access_grants (email, display_name, invite_code_id, active, granted_at, revoked_at) SELECT ?, ?, id, 1, CURRENT_TIMESTAMP, NULL FROM invite_codes WHERE id = ? AND changes() = 1 AND status = 'redeemed' AND redeemed_by_email = ? AND revoked_at IS NULL ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, invite_code_id = excluded.invite_code_id, active = 1, granted_at = CURRENT_TIMESTAMP, revoked_at = NULL")
        .bind(email, user.fullName ?? user.displayName, invite.id, email),
      env.DB.prepare("DELETE FROM invite_attempts WHERE email = ? AND changes() = 1").bind(email),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      await recordFailedAttempt(email, attempt);
      return jsonNoStore({ error: "That invitation code is invalid, expired, or has already been used." }, { status: 400 });
    }
    return jsonNoStore({ ok: true });
  } catch {
    return jsonNoStore({ error: "That invitation could not be verified." }, { status: 500 });
  }
}

async function recordFailedAttempt(email: string, attempt: AttemptRow | null) {
  const windowStart = attempt ? Date.parse(`${attempt.window_started_at.replace(" ", "T")}Z`) : 0;
  const withinWindow = Date.now() - windowStart < 15 * 60 * 1000;
  const attempts = withinWindow ? attempt!.attempts + 1 : 1;
  const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) : null;
  await env.DB.prepare("INSERT INTO invite_attempts (email, attempts, window_started_at, locked_until) VALUES (?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(email) DO UPDATE SET attempts = ?, window_started_at = CASE WHEN ? THEN window_started_at ELSE CURRENT_TIMESTAMP END, locked_until = ?")
    .bind(email, attempts, lockedUntil, attempts, withinWindow ? 1 : 0, lockedUntil).run();
}
