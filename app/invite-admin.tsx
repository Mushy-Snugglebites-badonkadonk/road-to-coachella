"use client";

import { useEffect, useState } from "react";

type Invite = {
  id: number;
  code: string | null;
  status: "active" | "redeemed" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  redeemedBy: string | null;
  redeemedName: string | null;
  redeemedAt: string | null;
};

export function InviteAdmin() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Invitation codes are temporarily unavailable.");
      setIsLoading(false);
    });
  }, []);

  async function refresh(response?: Response) {
    const result = response ?? await fetch("/api/invites", { cache: "no-store" });
    const payload = await result.json() as { invites?: Invite[]; error?: string };
    if (!result.ok) throw new Error(payload.error || "Invitation codes are temporarily unavailable.");
    setInvites(payload.invites ?? []);
    setIsLoading(false);
  }

  async function generate() {
    setIsWorking(true); setError(""); setNotice("");
    try {
      await refresh(await fetch("/api/invites", { method: "POST" }));
      setNotice("A new invitation code is ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A new code could not be generated.");
    } finally { setIsWorking(false); }
  }

  async function revoke(id: number) {
    if (!window.confirm("Revoke this invitation code and any access it granted?")) return;
    setIsWorking(true); setError(""); setNotice("");
    try {
      await refresh(await fetch("/api/invites", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "revoke" }),
      }));
      setNotice("Invitation revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That invitation could not be revoked.");
    } finally { setIsWorking(false); }
  }

  async function share(invite: Invite) {
    if (!invite.code) return;
    setError(""); setNotice("");
    const shareToken = crypto.randomUUID();
    const shareLink = `${window.location.origin}/?card=${shareToken}`;
    const message = `${shareLink}\nRoad to the Desert · Coachella 2027\nInvitation code: ${invite.code}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(invite.code);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = invite.code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    }
    setNotice(copied ? "Code copied. Opening a new message…" : "Opening a new message…");
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    window.location.href = isIOS ? `sms:&body=${encodeURIComponent(message)}` : `sms:?body=${encodeURIComponent(message)}`;
  }

  return (
    <div className="invite-console">
      <div className="management-heading invite-heading">
        <div><p className="eyebrow">Private access</p><h3>Invitation codes</h3></div>
        <div className="invite-heading-actions"><p>Generate a single-use code, then share it in a brand-new iMessage draft.</p><button type="button" onClick={generate} disabled={isWorking}>Generate code <span aria-hidden="true">＋</span></button></div>
      </div>
      {(notice || error) && <p className={`invite-admin-notice ${error ? "is-error" : ""}`} role="status">{error || notice}</p>}
      <div className="invite-ledger" aria-busy={isLoading}>
        {isLoading && <div className="empty-entry">Loading invitation codes…</div>}
        {!isLoading && invites.length === 0 && <div className="empty-entry">No invitation codes yet.</div>}
        {invites.map((invite) => (
          <article className="invite-row" key={invite.id}>
            <div className="invite-code"><strong>{invite.code ?? "Used invitation"}</strong><span>Created {formatDate(invite.createdAt)} · Expires {formatDate(invite.expiresAt)}</span></div>
            <div className="invite-recipient"><strong>{invite.redeemedName || invite.redeemedBy || "Not yet redeemed"}</strong>{invite.redeemedBy && invite.redeemedName && <span>{invite.redeemedBy}</span>}</div>
            <span className={`status-badge status-${invite.status}`}>{invite.status}</span>
            <div className="entry-actions">
              {invite.status === "active" && invite.code && <button type="button" onClick={() => share(invite)}>Share</button>}
              {invite.status !== "revoked" && <button className="danger-action" type="button" onClick={() => revoke(invite.id)} disabled={isWorking}>Revoke</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(normalized));
}
