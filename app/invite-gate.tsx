"use client";

import { FormEvent, useState } from "react";

export function InviteGate({ displayName, ownerName = "Owner" }: { displayName?: string; ownerName?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/access/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "That invitation could not be verified.");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That invitation could not be verified.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="invite-gate">
      <div className="invite-gate-glow" aria-hidden="true" />
      <section className="invite-card" aria-labelledby="invite-title">
        <div className="invite-brand"><span aria-hidden="true" /> RTTD / 27</div>
        <p className="eyebrow">Private road · invitation only</p>
        <h1 id="invite-title">The desert is<br />just ahead.</h1>
        {displayName ? <>
          <p className="invite-intro">Hi {firstName(displayName)}. Enter the single-use invitation code {ownerName} shared with you.</p>
          <form onSubmit={redeem}>
            <label htmlFor="invite-code">Invitation code</label>
            <input id="invite-code" name="code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" autoComplete="one-time-code" spellCheck={false} maxLength={19} placeholder="RTTD-XXXX-XXXX-XXXX" required />
            {error && <p className="invite-error" role="alert">{error}</p>}
            <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Checking…" : "Enter the site"}<span aria-hidden="true">→</span></button>
          </form>
          <a className="invite-exit" href="/signout-with-chatgpt?return_to=/exit">Exit to ChatGPT</a>
        </> : <>
          <p className="invite-intro">A private road to Coachella 2027. Sign in with ChatGPT, then enter the invitation code shared with you.</p>
          <a className="invite-sign-in" href="/signin-with-chatgpt?return_to=/">Sign in with ChatGPT <span aria-hidden="true">→</span></a>
          <a className="invite-exit" href="https://chatgpt.com/">Exit to ChatGPT</a>
        </>}
      </section>
    </main>
  );
}

function firstName(value: string) {
  return value.trim().split(/[\s@]/)[0] || "there";
}
