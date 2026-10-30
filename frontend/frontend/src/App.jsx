import { useState } from "react";
import "./App.css";

// Where your Flask backend lives. For deployment we'll set VITE_API_URL.
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

// Small helper that talks to the backend and turns errors into messages
async function api(path, options) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The backend sends either a list of "problems" or a single "error"
    const detail = data.problems ? data.problems.join(" ") : data.error;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

// Format numbers like 258,000
const fmt = (n) =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const EXAMPLE =
  "Pay Wanjiru $40 for logo design and Brian $120 for the website";

export default function App() {
  // ---- State: the data the screen remembers ----
  const [text, setText] = useState("");        // what the user typed
  const [plan, setPlan] = useState([]);        // the AI's plan (preview)
  const [planId, setPlanId] = useState("");    // unique ID, stops double payments
  const [receipts, setReceipts] = useState([]); // results after confirming
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ---- Step 1: ask the AI to build a plan (no money moves) ----
  async function handlePlan() {
    setError("");
    setReceipts([]);
    setLoading(true);
    try {
      const data = await api("/api/plan", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setPlan(data.plan);
      // A fresh ID for every new preview. The backend refuses repeats.
      setPlanId(crypto.randomUUID());
    } catch (e) {
      setPlan([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Let the user type a missing account into the preview
  function updateAccount(index, value) {
    setPlan(plan.map((p, i) => (i === index ? { ...p, account: value } : p)));
  }

  // Confirm is only allowed when every payment has an account
  const canConfirm =
    plan.length > 0 && plan.every((p) => p.account.trim() !== "");

  // ---- Step 2: run the confirmed plan (real PayPal sandbox payouts) ----
  async function handleConfirm() {
    setError("");
    setLoading(true);
    try {
      const data = await api("/api/execute", {
        method: "POST",
        body: JSON.stringify({
          plan_id: planId,
          // Send only what the backend needs; it recomputes the money math
          plan: plan.map((p) => ({
            name: p.name,
            account: p.account,
            amount_usd: p.amount_usd,
            rail: p.rail,
            receipt_narrative: p.receipt_narrative,
          })),
        }),
      });
      setReceipts(data.receipts);
      setPlan([]); // the plan is used up
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Ask the backend for the latest status of each receipt
  async function refreshStatus() {
    try {
      const updated = await Promise.all(
        receipts.map((r) =>
          r.id ? api(`/api/payouts/${r.id}`).catch(() => r) : r
        )
      );
      setReceipts(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  function startOver() {
    setText("");
    setPlan([]);
    setReceipts([]);
    setError("");
  }

  return (
    <main className="page">
      <header>
        <h1>PayBridge</h1>
        <p className="tagline">
          Pay international workers in Kenya shillings, from a plain-English request.
        </p>
        <p className="banner">
          Sandbox demo: PayPal payouts use test money, and the local M-PESA/bank
          delivery is <strong>simulated</strong>.
        </p>
      </header>

      {/* ---- The request box ---- */}
      <section className="card">
        <label htmlFor="request">What do you want to pay?</label>
        <textarea
          id="request"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
        />
        <div className="row">
          <button onClick={handlePlan} disabled={loading || !text.trim()}>
            {loading && plan.length === 0 ? "Thinking..." : "Preview plan"}
          </button>
          <button className="link" onClick={() => setText(EXAMPLE)}>
            Use an example
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {/* ---- The plan preview ---- */}
      {plan.length > 0 && (
        <section className="card">
          <h2>Review the plan</h2>
          <p className="muted">No money has moved yet.</p>

          {plan.map((p, i) => (
            <div className="payment" key={i}>
              <div className="payment-top">
                <strong>{p.name}</strong>
                <span className={`pill ${p.rail}`}>
                  {p.rail === "mpesa" ? "M-PESA" : "Bank"}
                </span>
              </div>
              <div className="amounts">
                <span>${fmt(p.amount_usd)}</span>
                <span>→ KSh {fmt(p.amount_kes)}</span>
                <span className="muted">fee KSh {fmt(p.fee_kes)}</span>
                <span className="muted">
                  they receive KSh {fmt(p.net_kes)}
                </span>
              </div>
              <p className="muted small">{p.reason}</p>
              <p className="muted small">Receipt: {p.receipt_narrative}</p>

              <input
                className={p.account.trim() === "" ? "needs" : ""}
                placeholder={
                  p.rail === "mpesa"
                    ? "Phone number, e.g. 254712345678"
                    : "Bank account number"
                }
                value={p.account}
                onChange={(e) => updateAccount(i, e.target.value)}
              />
              {p.from_saved_recipient && (
                <p className="small saved">Using saved recipient details</p>
              )}
            </div>
          ))}

          <div className="row">
            <button onClick={handleConfirm} disabled={!canConfirm || loading}>
              {loading ? "Sending..." : "Confirm and send"}
            </button>
            <button className="link" onClick={startOver}>Cancel</button>
          </div>
          {!canConfirm && (
            <p className="muted small">Fill in every account to continue.</p>
          )}
        </section>
      )}

      {/* ---- Receipts after confirming ---- */}
      {receipts.length > 0 && (
        <section className="card">
          <h2>Receipts</h2>
          {receipts.map((r, i) => (
            <div className="payment" key={r.id || i}>
              {r.error ? (
                <p className="error">{r.name}: {r.error}</p>
              ) : (
                <>
                  <div className="payment-top">
                    <strong>{r.name}</strong>
                    <span className={`status ${r.status}`}>{r.status}</span>
                  </div>
                  <div className="amounts">
                    <span>${fmt(r.amount_usd)}</span>
                    <span>→ KSh {fmt(r.amount_kes)}</span>
                    <span className="muted">via {r.rail}</span>
                  </div>
                  <p className="muted small">{r.receipt_narrative}</p>
                  <p className="muted small">
                    PayPal batch {r.paypal_batch_id} · {r.id}
                    {r.simulated && " · simulated local delivery"}
                  </p>
                </>
              )}
            </div>
          ))}
          <div className="row">
            <button onClick={refreshStatus}>Refresh status</button>
            <button className="link" onClick={startOver}>New payment</button>
          </div>
        </section>
      )}
    </main>
  );
}
