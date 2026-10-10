"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TRACKER_CONFIG, progressPercent } from "./tracker-config";
import { InviteAdmin } from "./invite-admin";

type PaymentStatus = "pending" | "approved" | "rejected";

type Payment = {
  id: number;
  amountCents: number;
  paidOn: string;
  note: string;
  status: PaymentStatus;
  submittedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
};

type Viewer = { displayName: string; isOwner: boolean };

type TrackerData = {
  configured: boolean;
  installmentCents: number;
  totalCents: number;
  nextPaymentCents: number;
  nextPaymentDate: string | null;
  payments: Payment[];
  entries: Payment[];
  viewer: Pick<Viewer, "isOwner">;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthOnly = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthShortYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLongYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const EASTER_EGG_PHRASE = "Coachella bitches!";
const FERRIS_LIGHTS = ["#ff5f56", "#ffbd2e", "#27c9a5", "#38bdf8", "#a78bfa", "#f472b6"];
const JAW_ENVELOPE_STEP = 0.06;
const JAW_ENVELOPE = [0,0,.04,.03,.06,.09,.06,.62,.84,1,1,.91,.63,.78,.98,.85,.97,.71,.24,.24,.67,.93,.97,.87,.66,.14,.02,.05,.02,0,.04,.83,.89,.81,.8,.62,.18,.28,.13,.11,.67,.96,.86,.96,.58,.32,.61,.87,.78,.87,.85,.44,.28,.12,.06,.11,.11,.07,.63,.77,.8,.87,.78,.34,.65,.64,.43,.25,.08,.08,.08,.05,.12,.07,.07,.04,.06,.05,.11,.07,.06,.06,.1,.07,.14,.1,.09,.11,.06,.27,.95,.62,.63,.93,.9,.7,.82,.22,.71,.45,.53,.69,.64,.52,.56,.25,.04,.1,.06,0,.11,.02,.02,.04,0];
type EasterEggPhase = "idle" | "wheel" | "face" | "typing" | "voice" | "hold" | "closing";

function asDate(value: string) { return new Date(`${value}T12:00:00Z`); }
function firstName(value: string) { return value.includes("@") ? value.split("@")[0] : value.split(" ")[0]; }

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 4l12 12M16 4 4 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>;
}

function useScrollReveals(changeKey: string) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("motion-ready");
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-visible)"));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || !("IntersectionObserver" in window)) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -10% 0px" });

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [changeKey]);
}

function useInViewOnce<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setIsVisible(true);
      observer.disconnect();
    }, { threshold: 0.28 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return isVisible;
}

function useAnimatedNumber(target: number, active: boolean, duration = 900) {
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => {
        currentRef.current = target;
        setDisplay(target);
        hasAnimated.current = true;
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const from = hasAnimated.current ? currentRef.current : 0;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      const next = Math.round(from + (target - from) * eased);
      currentRef.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else hasAnimated.current = true;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, duration, target]);

  return display;
}

export function Tracker({ currentUser, easterEggEnabled = false }: { currentUser: Viewer; easterEggEnabled?: boolean }) {
  const fallbackData: TrackerData = { ...DEFAULT_TRACKER_CONFIG, configured: false, nextPaymentCents: 0, nextPaymentDate: null, payments: [], entries: [], viewer: currentUser };
  const [data, setData] = useState<TrackerData>(fallbackData);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [pinnedMonth, setPinnedMonth] = useState<string | null>(null);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [easterEggPhase, setEasterEggPhase] = useState<EasterEggPhase>("idle");
  const [easterEggText, setEasterEggText] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const paymentsSectionRef = useRef<HTMLElement>(null);
  const easterEggStickerRef = useRef<HTMLDivElement>(null);
  const easterEggAudioRef = useRef<HTMLAudioElement>(null);
  const jawAnimationFrameRef = useRef(0);
  const easterEggTimersRef = useRef<number[]>([]);

  useScrollReveals(`${data.payments.length}:${data.entries.length}`);
  const progressVisible = useInViewOnce(progressRef);

  useEffect(() => {
    const updateHeader = () => setIsHeaderCompact(window.scrollY > 32);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);

  useEffect(() => {
    const section = paymentsSectionRef.current;
    if (!section) return;

    let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      document.head.appendChild(themeMeta);
    }

    const root = document.documentElement;
    const updateViewportTheme = () => {
      const bounds = section.getBoundingClientRect();
      const isInInkSection = bounds.top <= 1 && bounds.bottom > 1;
      root.classList.toggle("viewport-ink", isInInkSection);
      themeMeta!.content = isInInkSection ? "#1d1c1a" : "#f5efe3";
    };

    updateViewportTheme();
    window.addEventListener("scroll", updateViewportTheme, { passive: true });
    window.addEventListener("resize", updateViewportTheme);
    window.visualViewport?.addEventListener("scroll", updateViewportTheme, { passive: true });
    window.visualViewport?.addEventListener("resize", updateViewportTheme);
    return () => {
      window.removeEventListener("scroll", updateViewportTheme);
      window.removeEventListener("resize", updateViewportTheme);
      window.visualViewport?.removeEventListener("scroll", updateViewportTheme);
      window.visualViewport?.removeEventListener("resize", updateViewportTheme);
      root.classList.remove("viewport-ink");
      themeMeta!.content = "#f5efe3";
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => () => {
    easterEggTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    window.cancelAnimationFrame(jawAnimationFrameRef.current);
    easterEggAudioRef.current?.pause();
  }, []);

  async function refresh(response: Response) {
    const payload = await response.json() as TrackerData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "The payment data could not be updated.");
    setData(payload);
    return payload;
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments")
      .then(async (response) => {
        const payload = await response.json() as TrackerData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Saved payments are temporarily unavailable.");
        if (!cancelled) setData(payload);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Saved payments are temporarily unavailable."); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const paidCents = data.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const remainingCents = Math.max(data.totalCents - paidCents, 0);
  const percent = progressPercent(paidCents, data.totalCents);
  const circumference = 2 * Math.PI * 180;
  const progressOffset = circumference * (1 - percent / 100);
  const monthlyPayments = useMemo(() => {
    const months = new Map<string, { key: string; date: string; amountCents: number; count: number }>();
    data.payments.forEach((payment) => {
      const key = payment.paidOn.slice(0, 7);
      const current = months.get(key);
      if (current) {
        current.amountCents += payment.amountCents;
        current.count += 1;
      } else {
        months.set(key, { key, date: `${key}-01`, amountCents: payment.amountCents, count: 1 });
      }
    });
    return Array.from(months.values());
  }, [data.payments]);
  const maxMonthlyPayment = Math.max(...monthlyPayments.map((month) => month.amountCents), 1);
  const selectedMonth = monthlyPayments.find((month) => month.key === (hoveredMonth ?? pinnedMonth)) ?? null;
  const pendingCount = data.entries.filter((entry) => entry.status === "pending").length;
  const cumulative = useMemo(() => {
    return data.payments.reduce<{ total: number; rows: Array<Payment & { runningTotal: number }> }>((current, payment) => {
      const runningTotal = current.total + payment.amountCents;
      return { total: runningTotal, rows: [...current.rows, { ...payment, runningTotal }] };
    }, { total: 0, rows: [] }).rows;
  }, [data.payments]);
  const animatedPercent = useAnimatedNumber(percent, progressVisible, 1050);
  const animatedPaidCents = useAnimatedNumber(paidCents, progressVisible, 1000);
  const animatedRemainingCents = useAnimatedNumber(remainingCents, progressVisible, 1000);

  function scheduleEasterEgg(action: () => void, delay: number) {
    const timer = window.setTimeout(action, delay);
    easterEggTimersRef.current.push(timer);
  }

  function clearEasterEggTimers() {
    easterEggTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    easterEggTimersRef.current = [];
  }

  function stopJawSync() {
    window.cancelAnimationFrame(jawAnimationFrameRef.current);
    jawAnimationFrameRef.current = 0;
    easterEggStickerRef.current?.style.setProperty("--jaw-drop", "0%");
  }

  function startJawSync() {
    stopJawSync();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const updateJaw = () => {
      const audio = easterEggAudioRef.current;
      const sticker = easterEggStickerRef.current;
      if (!audio || !sticker || audio.paused || audio.ended) {
        stopJawSync();
        return;
      }
      const envelopeIndex = Math.min(Math.floor(audio.currentTime / JAW_ENVELOPE_STEP), JAW_ENVELOPE.length - 1);
      const openness = Math.max(0, JAW_ENVELOPE[envelopeIndex] - .06) / .94;
      sticker.style.setProperty("--jaw-drop", `${(openness * 8.5).toFixed(2)}%`);
      jawAnimationFrameRef.current = window.requestAnimationFrame(updateJaw);
    };

    jawAnimationFrameRef.current = window.requestAnimationFrame(updateJaw);
  }

  function resetEasterEgg() {
    clearEasterEggTimers();
    stopJawSync();
    const audio = easterEggAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
    }
    setEasterEggText("");
    setEasterEggPhase("idle");
  }

  function fadeOutThenReset() {
    setEasterEggPhase("closing");
    scheduleEasterEgg(resetEasterEgg, 600);
  }

  function holdThenReset() {
    setEasterEggPhase("hold");
    scheduleEasterEgg(fadeOutThenReset, 2500);
  }

  function playEasterEggAudio() {
    const audio = easterEggAudioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = 1;
    audio.currentTime = 0;
    const playback = audio.play();
    playback?.catch(() => scheduleEasterEgg(holdThenReset, 3600));
  }

  function activateEasterEgg() {
    if (easterEggPhase !== "idle") return;
    clearEasterEggTimers();
    setEasterEggText("");

    // iOS only guarantees media playback from the original tap. Start the
    // recording once here instead of playing it silently and restarting it.
    playEasterEggAudio();
    scheduleEasterEgg(fadeOutThenReset, 13400);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEasterEggText(EASTER_EGG_PHRASE);
      setEasterEggPhase("voice");
      return;
    }

    setEasterEggPhase("wheel");
    scheduleEasterEgg(() => setEasterEggPhase("face"), 320);
    scheduleEasterEgg(() => {
      setEasterEggPhase("typing");
      Array.from(EASTER_EGG_PHRASE).reverse().forEach((character, index, characters) => {
        scheduleEasterEgg(() => {
          setEasterEggText((current) => character + current);
          if (index === characters.length - 1) {
            setEasterEggPhase("voice");
          }
        }, index * 105);
      });
    }, 680);
  }

  function handleEasterEggAudioEnded() {
    stopJawSync();
    if (easterEggPhase !== "idle" && easterEggPhase !== "hold") holdThenReset();
  }

  function openCreate() {
    if (!data.configured || isLoading) return;
    setEditing(null);
    setError("");
    dialogRef.current?.showModal();
  }

  function openEdit(payment: Payment) {
    if (!data.configured || isLoading) return;
    setEditing(payment);
    setError("");
    dialogRef.current?.showModal();
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const paymentForm = event.currentTarget;
    setIsSaving(true);
    setError("");
    setNotice("");
    const form = new FormData(paymentForm);
    const values = { amount: Number(form.get("amount")), paidOn: String(form.get("paidOn")), note: String(form.get("note") ?? "") };
    try {
      if (editing) {
        await refresh(await fetch("/api/payments", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, action: "update", ...values }) }));
        setNotice("Payment updated.");
      } else {
        await refresh(await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }));
        setNotice(currentUser.isOwner ? "Payment added and approved." : "Payment submitted for approval.");
      }
      dialogRef.current?.close();
      setEditing(null);
      paymentForm.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That payment could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function manage(id: number, action: "approve" | "reject") {
    setError("");
    setNotice("");
    try {
      await refresh(await fetch("/api/payments", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) }));
      setNotice(action === "approve" ? "Payment approved and added to progress." : "Payment rejected.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That payment could not be updated.");
    }
  }

  async function remove(payment: Payment) {
    const amount = money.format(payment.amountCents / 100);
    const date = shortDate.format(asDate(payment.paidOn));
    if (!window.confirm(`Delete this payment permanently?\n\n${amount} · ${date}`)) return;
    setError("");
    setNotice("");
    try {
      await refresh(await fetch(`/api/payments?id=${payment.id}`, { method: "DELETE" }));
      setNotice("Payment deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That payment could not be deleted.");
    }
  }

  return (
    <main>
      <header className={`site-header ${isHeaderCompact ? "is-compact" : ""}`}>
        <a className="brand" href="#top" aria-label="Road to the Desert home"><span className="brand-mark" aria-hidden="true" /><span>RTTD / 27</span></a>
        <div className="header-actions">
          {currentUser.isOwner && <a className="manage-link" href="#manage">Manage {pendingCount > 0 && <span>{pendingCount}</span>}</a>}
          <button className="add-button" type="button" disabled={!data.configured || isLoading} onClick={openCreate}>{currentUser.isOwner ? "Add payment" : "Submit payment"} <ArrowIcon /></button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy" data-reveal="hero-copy">
          <p className="eyebrow">Coachella 2027 · Ticket repayment</p>
          <h1><span>Road to</span><span>the Desert</span></h1>
          <p className="intro">One ticket, one promise, and a little closer to the polo fields with every approved payment.</p>
          <div className="next-payment">
            {!data.configured ? <div role="status"><span className="label">Configuration required</span><strong>Set your total, installment, and anchor date in the runtime environment.</strong></div> : data.nextPaymentDate ? <>
            <time dateTime={data.nextPaymentDate} className="date-tile"><strong>{String(asDate(data.nextPaymentDate).getUTCDate()).padStart(2, "0")}</strong><span>{monthOnly.format(asDate(data.nextPaymentDate))}</span></time>
            <div><span className="label">Next payment</span><strong>{money.format(data.nextPaymentCents / 100)} · {shortDate.format(asDate(data.nextPaymentDate))}</strong></div>
            </> : <div><span className="label">Paid in full</span><strong>No remaining payments</strong></div>}
          </div>
        </div>

        <div className="progress-reveal" ref={progressRef} aria-label={`${percent}% complete, ${money.format(remainingCents / 100)} remaining`}>
          <div className={`progress-stage egg-${easterEggPhase} ${easterEggPhase !== "idle" ? "egg-active" : ""}`}>
            <div className="progress-chart" aria-hidden={easterEggPhase !== "idle"}>
              <div className="remaining-note"><span className="label">Remaining</span><strong>{money.format(animatedRemainingCents / 100)}</strong></div>
              <svg className="progress-ring" viewBox="0 0 420 420" role="img" aria-labelledby="progress-title progress-desc">
                <title id="progress-title">Approved ticket repayment progress</title><desc id="progress-desc">{money.format(paidCents / 100)} of {money.format(data.totalCents / 100)} has been approved as paid.</desc>
                <circle className="ring-track" cx="210" cy="210" r="180" /><circle className="ring-value" cx="210" cy="210" r="180" style={{ strokeDasharray: circumference, "--ring-length": circumference, "--progress-offset": progressVisible ? progressOffset : circumference } as React.CSSProperties} />
              </svg>
              <div className="progress-copy"><strong>{animatedPercent}%</strong><span className="label">Approved</span><p><b>{money.format(animatedPaidCents / 100)}</b> of {money.format(data.totalCents / 100)} paid</p></div>
            </div>
            {easterEggEnabled && <>
            <div className="festival-wheel" aria-hidden="true">
              <div className="wheel-rotor">
                {Array.from({ length: 12 }, (_, index) => <span className="wheel-spoke" key={`spoke-${index}`} style={{ "--wheel-angle": `${index * 30}deg`, "--spoke-color": FERRIS_LIGHTS[index % FERRIS_LIGHTS.length] } as React.CSSProperties} />)}
                {Array.from({ length: 12 }, (_, index) => (
                  <span className="wheel-cabin" key={`cabin-${index}`} style={{ "--wheel-angle": `${index * 30}deg`, "--cabin-counter-angle": `${index * -30}deg`, "--cabin-color": FERRIS_LIGHTS[index % FERRIS_LIGHTS.length], "--cabin-delay": `${index * -0.13}s` } as React.CSSProperties}>
                    <span className="cabin-hanger"><span className="cabin-car" /></span>
                  </span>
                ))}
              </div>
              <div className="easter-egg-sticker" ref={easterEggStickerRef}>
                {/* Direct images keep this private, authenticated asset out of the public image-optimization cache. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="easter-egg-face" src="/api/media/easter-egg-face" alt="" />
                <span className="easter-egg-mouth-void" aria-hidden="true" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="easter-egg-jaw" src="/api/media/easter-egg-face" alt="" />
              </div>
              <div className="easter-egg-phrase">
                {Array.from(easterEggText).map((character, index) => <span className="easter-egg-letter" key={`${easterEggText.length}-${index}`}>{character === " " ? "\u00a0" : character}</span>)}
              </div>
            </div>
            <button className="sun-dot" type="button" aria-label="Activate the red sun surprise" disabled={easterEggPhase !== "idle"} onClick={activateEasterEgg} />
            <span className="visually-hidden" aria-live="polite">{easterEggText === EASTER_EGG_PHRASE ? EASTER_EGG_PHRASE : ""}</span>
            <audio ref={easterEggAudioRef} src="/api/media/easter-egg-audio" preload="auto" onPlay={startJawSync} onPause={stopJawSync} onEnded={handleEasterEggAudioEnded} />
            </>}
          </div>
        </div>
      </section>

      <section className="payments-section" ref={paymentsSectionRef} aria-labelledby="payments-title">
        <div className="payments-inner">
        <div className="section-heading" data-reveal="section-heading">
          <div><p className="eyebrow">Approved payment rhythm</p><h2 id="payments-title">Every step counts.</h2></div>
          <p>{data.payments.length} approved payments<br />tracked with a clear audit trail</p>
        </div>

        <div className="chart-layout" data-reveal="charts">
          <div className="bar-chart" role="group" aria-label="Interactive approved payment amounts by month">
            <div className="chart-scale" aria-hidden="true"><span>{money.format(maxMonthlyPayment / 100)}</span><span>$0</span></div>
            <div className="bars">
              {monthlyPayments.length === 0 && <div className="empty-chart">No approved payments yet.</div>}
              {monthlyPayments.map((month, index) => (
                <button className={`bar-item ${pinnedMonth === month.key ? "is-selected" : ""}`} key={month.key} type="button" onMouseEnter={() => setHoveredMonth(month.key)} onMouseLeave={() => setHoveredMonth(null)} onFocus={() => setHoveredMonth(month.key)} onBlur={() => setHoveredMonth(null)} onClick={() => setPinnedMonth((current) => current === month.key ? null : month.key)} aria-pressed={pinnedMonth === month.key} aria-label={`${monthLongYear.format(asDate(month.date))}: ${month.count} ${month.count === 1 ? "payment" : "payments"}, ${money.format(month.amountCents / 100)} total`}>
                  <span className="bar-value">{money.format(month.amountCents / 100)}</span><span className="bar-track"><span className="bar-fill" style={{ "--bar-height": `${Math.max((month.amountCents / maxMonthlyPayment) * 100, 8)}%`, "--delay": `${index * 90}ms` } as React.CSSProperties} /></span><span className="bar-month">{monthShortYear.format(asDate(month.date))}</span>
                </button>
              ))}
            </div>
            <div className={`chart-detail ${selectedMonth ? "is-visible" : ""}`} aria-live="polite">{selectedMonth ? `${monthLongYear.format(asDate(selectedMonth.date))} · ${selectedMonth.count} ${selectedMonth.count === 1 ? "payment" : "payments"} · ${money.format(selectedMonth.amountCents / 100)} total` : "Hover, focus, or tap a month to see its total."}</div>
          </div>

          <div className="journey-panel">
            <span className="label">Cumulative journey</span>
            <div className="journey-line" aria-label="Cumulative total across approved payments">
              {cumulative.length === 0 && <span className="journey-empty">No approved journey yet.</span>}
              {cumulative.map((payment, index) => {
                const ratio = paidCents ? payment.runningTotal / paidCents : 0;
                const next = cumulative[index + 1];
                const nextRatio = next && paidCents ? next.runningTotal / paidCents : ratio;
                const level = 12 + ratio * 72;
                const rise = Math.max((nextRatio - ratio) * 72, 0);
                const showValue = index === 0 || index === cumulative.length - 1;
                return (
                  <div className="journey-step" key={payment.id} aria-label={`${shortDate.format(asDate(payment.paidOn))}: ${money.format(payment.runningTotal / 100)} cumulative`} style={{ "--level": `${level}%`, "--rise": `${rise}%`, "--delay": `${index * 100}ms` } as React.CSSProperties}>
                    <span className="journey-level" aria-hidden="true" />
                    {next && <span className="journey-connector" aria-hidden="true" />}
                    {showValue && <span className={`journey-value ${index === 0 ? "is-first" : "is-last"}`}>{money.format(payment.runningTotal / 100)}</span>}
                  </div>
                );
              })}
            </div>
            <p>Only owner-approved payments move the progress forward.</p>
            <button className="text-button" type="button" disabled={!data.configured || isLoading} onClick={openCreate}>{currentUser.isOwner ? "Log a payment" : "Submit the next one"} <ArrowIcon /></button>
          </div>
        </div>

        <div className="management-console" id="manage" data-reveal="management">
          {currentUser.isOwner && <InviteAdmin />}
          <div className="management-heading">
            <div><p className="eyebrow">{currentUser.isOwner ? "Owner control" : "Your submissions"}</p><h3>{currentUser.isOwner ? "Payment management" : "Approval status"}</h3></div>
            <p>{currentUser.isOwner ? "Approve, edit, reject, or delete every entry." : "You can submit payments. Only the owner can approve or change them."}</p>
          </div>

          <div className="entry-list">
            {data.entries.length === 0 && <div className="empty-entry">No payment submissions yet.</div>}
            {data.entries.map((entry, index) => (
              <article className="entry-row" key={entry.id} data-reveal="entry" style={{ "--reveal-delay": `${Math.min(index * 65, 390)}ms` } as React.CSSProperties}>
                <div className="entry-amount"><strong>{money.format(entry.amountCents / 100)}</strong><span>{shortDate.format(asDate(entry.paidOn))}</span></div>
                <div className="entry-note"><strong>{entry.note || "Payment"}</strong>{currentUser.isOwner && <span>{entry.submittedBy ? `Submitted by ${entry.submittedBy}` : "Imported payment"}</span>}</div>
                <span className={`status-badge status-${entry.status}`}>{entry.status}</span>
                {currentUser.isOwner && data.configured && <div className="entry-actions">
                  {entry.status === "pending" && <><button type="button" onClick={() => manage(entry.id, "approve")}>Approve</button><button type="button" onClick={() => manage(entry.id, "reject")}>Reject</button></>}
                  <button type="button" onClick={() => openEdit(entry)}>Edit</button>
                  <button className="danger-action" type="button" onClick={() => remove(entry)}>Delete</button>
                </div>}
              </article>
            ))}
          </div>
        </div>
        </div>
      </section>

      <footer data-reveal="footer"><span>Signed in as {firstName(currentUser.displayName)} · {currentUser.isOwner ? "Owner" : "Submitter"}</span><a href="/signout-with-chatgpt?return_to=/">Sign out</a></footer>

      <dialog className="payment-dialog" ref={dialogRef} onClose={() => setEditing(null)} onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}>
        <form className="payment-form" onSubmit={savePayment}>
          <div className="dialog-heading"><div><p className="eyebrow">{editing ? "Owner control" : currentUser.isOwner ? "Add directly" : "Send for review"}</p><h2>{editing ? "Edit payment" : currentUser.isOwner ? "Add a payment" : "Submit payment"}</h2></div><button className="close-button" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}><CloseIcon /></button></div>
          <p className="dialog-explainer">{editing || currentUser.isOwner ? "Changes update the official payment record." : "Your submission stays pending until the owner approves it."}</p>
          <label>Amount <span>USD</span><input name="amount" key={`amount-${editing?.id ?? "new"}`} type="number" min="0.01" max={data.totalCents / 100} step="0.01" defaultValue={editing ? editing.amountCents / 100 : ""} placeholder="Amount" required /></label>
          <label>Date <input name="paidOn" key={`date-${editing?.id ?? "new"}`} type="date" defaultValue={editing?.paidOn ?? new Date().toISOString().slice(0, 10)} required /></label>
          <label>Note <span>Optional</span><input name="note" key={`note-${editing?.id ?? "new"}`} type="text" maxLength={80} defaultValue={editing?.note ?? ""} placeholder="Payment note" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="save-button" type="submit" disabled={isSaving || !data.configured}>{isSaving ? "Saving…" : editing ? "Save changes" : currentUser.isOwner ? "Add approved payment" : "Submit for approval"}<ArrowIcon /></button>
        </form>
      </dialog>

      {isLoading && <div className="loading-line" role="status"><span /> Loading saved payments…</div>}
      {!isLoading && (notice || error) && <div className={`toast ${error ? "toast-error" : ""}`} role="status">{error || notice}</div>}
    </main>
  );
}
