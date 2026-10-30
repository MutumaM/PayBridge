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

const RAIL_LABEL = { mpesa: "M-PESA", bank: "Bank" };

export default function App() {
  // ---- State: the data the screen remembers ----
  const [text, setText] = useState("");
  const [plan, setPlan] = useState([]);
  const [planId, setPlanId] = useState("");
  // The M-PESA limit and the fees, sent by the backend with every plan
  const [limits, setLimits] = useState({ mpesa_max_kes: 150000, fees_kes: {} });
  const [receipts, setReceipts] = useState([]);
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
      setLimits(data.limits);
      // Give each payment an "accounts" box per rail, so switching rails
      // doesn't lose what the user typed.
      setPlan(
        data.plan.map((p) => ({
          ...p,
          accounts: {
            mpesa: p.rail === "mpesa" ? p.account : "",
            bank: p.rail === "bank" ? p.account : "",
          },
          // Saved details only apply to the rail they were saved for
          saved_rail: p.from_saved_recipient ? p.rail : null,
        }))
      );
      setPlanId(crypto.randomUUID());
    } catch (e) {
      setPlan([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Is this amount too big for M-PESA?
  const overMpesa = (p) => p.amount_kes > limits.mpesa_max_kes;

  // User clicks M-PESA or Bank on a payment
  function chooseRail(index, rail) {
    setPlan(
      plan.map((p, i) => {
        if (i !== index) return p;
        if (rail === "mpesa" && overMpesa(p)) return p; // not allowed
        const fee = limits.fees_kes[rail] ?? p.fee_kes;
        return {
          ...p,
          rail,
          fee_kes: fee,
          net_kes: Math.round((p.amount_kes - fee) * 100) / 100,
          reason: "You chose this rail.",
        };
      })
    );
  }

  // Type an account number for the currently selected rail
  function updateAccount(index, value) {
    setPlan(
      plan.map((p, i) =>
        i === index
          ? { ...p, accounts: { ...p.accounts, [p.rail]: value } }
          : p
      )
    );
  }

  // Confirm is only allowed when every payment has an account for its rail
  const canConfirm =
    plan.length > 0 && plan.every((p) => p.accounts[p.rail].trim() !== "");

  // ---- Step 2: run the confirmed plan (real PayPal sandbox payouts) ----
  async function handleConfirm() {
    setError("");
    setLoading(true);
    try {
      const data = await api("/api/execute", {
        method: "POST",
        body: JSON.stringify({
          plan_id: planId,
          plan: plan.map((p) => ({
            name: p.name,
            account: p.accounts[p.rail],
            amount_usd: p.amount_usd,
            rail: p.rail,
            receipt_narrative: p.receipt_narrative,
          })),
        }),
      });
      setReceipts(data.receipts);
      setPlan([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

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

      {plan.length > 0 && (
        <section className="card">
          <h2>Review the plan</h2>
          <p className="muted">No money has moved yet. Choose how each person is paid.</p>

          {plan.map((p, i) => (
            <div className="payment" key={i}>
              <div className="payment-top">
                <strong>{p.name}</strong>
              </div>

              {/* ---- The rail picker ---- */}
              <div className="rail-toggle" role="group" aria-label={`Payment method for ${p.name}`}>
                {["mpesa", "bank"].map((rail) => {
                  const blocked = rail === "mpesa" && overMpesa(p);
                  return (
                    <button
                      key={rail}
                      type="button"
                      className={`rail-btn ${p.rail === rail ? "active" : ""}`}
                      disabled={blocked}
                      aria-pressed={p.rail === rail}
                      onClick={() => chooseRail(i, rail)}
                    >
                      {RAIL_LABEL[rail]}
                    </button>
                  );
                })}
              </div>
              {overMpesa(p) && (
                <p className="small warn">
                  Above the M-PESA limit (KSh {fmt(limits.mpesa_max_kes)}), so
                  this payment goes to the bank.
                </p>
              )}

              <div className="amounts">
                <span>${fmt(p.amount_usd)}</span>
                <span>→ KSh {fmt(p.amount_kes)}</span>
                <span className="muted">fee KSh {fmt(p.fee_kes)}</span>
                <span className="muted">they receive KSh {fmt(p.net_kes)}</span>
              </div>
              <p className="muted small">{p.reason}</p>
              <p className="muted small">Receipt: {p.receipt_narrative}</p>

              <input
                className={p.accounts[p.rail].trim() === "" ? "needs" : ""}
                placeholder={
                  p.rail === "mpesa"
                    ? "Phone number, e.g. 254712345678"
                    : "Bank account number"
                }
                value={p.accounts[p.rail]}
                onChange={(e) => updateAccount(i, e.target.value)}
              />
              {p.saved_rail === p.rail && (
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
                    <span className="muted">via {RAIL_LABEL[r.rail] || r.rail}</span>
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
