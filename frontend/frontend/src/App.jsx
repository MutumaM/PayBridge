import { useEffect, useState } from "react";
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

const TABS = [
  { id: "pay", label: "New payment" },
  { id: "payouts", label: "Payouts" },
  { id: "recipients", label: "Recipients" },
];

// Colours for the little icon tiles in the side panel
const TILE_COLOURS = ["#C73A52", "#5B2A86", "#E5566D", "#8A4FBF", "#D9822B"];

export default function App() {
  // ---- Which tab is open ----
  const [tab, setTab] = useState("pay");

  // ---- "New payment" state ----
  const [text, setText] = useState("");
  const [plan, setPlan] = useState([]);
  const [planId, setPlanId] = useState("");
  const [limits, setLimits] = useState({ mpesa_max_kes: 150000, fees_kes: {} });
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ---- Data for the other tabs ----
  const [recipients, setRecipients] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [form, setForm] = useState({ name: "", rail: "mpesa", account: "" });
  const [notice, setNotice] = useState("");

  // ---- Loading saved recipients and payouts ----
  async function loadRecipients() {
    try {
      setRecipients(await api("/api/recipients"));
    } catch (e) {
      /* the side panel just stays empty if the backend is down */
    }
  }

  async function loadPayouts() {
    try {
      setPayouts(await api("/api/payouts"));
    } catch (e) {
      setError(e.message);
    }
  }

  // Load recipients once when the page opens
  useEffect(() => {
    loadRecipients();
  }, []);

  // Load payouts every time the Payouts tab is opened
  useEffect(() => {
    if (tab === "payouts") loadPayouts();
  }, [tab]);

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
      // One "accounts" box per rail, so switching rails keeps what was typed
      setPlan(
        data.plan.map((p) => ({
          ...p,
          accounts: {
            mpesa: p.rail === "mpesa" ? p.account : "",
            bank: p.rail === "bank" ? p.account : "",
          },
          saved_rail: p.from_saved_recipient ? p.rail : null,
        }))
      );
      setPlanId(crypto.randomUUID()); // fresh ID stops double payments
    } catch (e) {
      setPlan([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

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

  function updateAccount(index, value) {
    setPlan(
      plan.map((p, i) =>
        i === index
          ? { ...p, accounts: { ...p.accounts, [p.rail]: value } }
          : p
      )
    );
  }

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

  // ---- Saving a new recipient ----
  async function saveRecipient(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      await api("/api/recipients", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setNotice(`Saved ${form.name}.`);
      setForm({ name: "", rail: "mpesa", account: "" });
      loadRecipients();
    } catch (err) {
      setError(err.message);
    }
  }

  // Clicking a recipient in the side panel starts a payment request
  function quickPay(name) {
    setTab("pay");
    setText(`Pay ${name} $`);
  }

  return (
    <div className="app">
      {/* ---- Dark top bar ---- */}
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">PayBridge</span>
          <span className="badge">Sandbox</span>
        </div>
      </header>

      {/* ---- Gradient banner ---- */}
      <section className="hero">
        <div className="hero-inner">
          <h1>Pay your team in Kenya shillings</h1>
          <p>Describe the payments in plain English. We build the plan, you approve it.</p>
        </div>
      </section>

      {/* ---- Floating pill tabs ---- */}
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => {
              setTab(t.id);
              setError("");
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="layout">
        <main>
          {error && <p className="error">{error}</p>}

          {/* ================= NEW PAYMENT ================= */}
          {tab === "pay" && (
            <>
              <p className="notice">
                Sandbox demo: PayPal payouts use test money, and the local
                M-PESA/bank delivery is <strong>simulated</strong>.
              </p>

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

              {plan.length > 0 && (
                <section className="card">
                  <h2>Review the plan</h2>
                  <p className="muted">
                    No money has moved yet. Choose how each person is paid.
                  </p>

                  {plan.map((p, i) => (
                    <div className="payment" key={i}>
                      <div className="payment-top">
                        <strong>{p.name}</strong>
                      </div>

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
                          Above the M-PESA limit (KSh {fmt(limits.mpesa_max_kes)}),
                          so this payment goes to the bank.
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
            </>
          )}

          {/* ================= PAYOUTS ================= */}
          {tab === "payouts" && (
            <section className="card">
              <h2>Payout history</h2>
              <p className="muted small">The AG Grid table will replace this one.</p>
              {payouts.length === 0 ? (
                <p className="muted">No payouts yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Recipient</th>
                        <th>Via</th>
                        <th>USD</th>
                        <th>KES</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((p) => (
                        <tr key={p.id}>
                          <td>{new Date(p.created_at * 1000).toLocaleString()}</td>
                          <td>{p.name}</td>
                          <td>{RAIL_LABEL[p.rail] || p.rail}</td>
                          <td>{p.amount_usd != null ? fmt(p.amount_usd) : "-"}</td>
                          <td>{fmt(p.amount_kes)}</td>
                          <td><span className={`status ${p.status}`}>{p.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row">
                <button onClick={loadPayouts}>Refresh</button>
              </div>
            </section>
          )}

          {/* ================= RECIPIENTS ================= */}
          {tab === "recipients" && (
            <>
              <section className="card">
                <h2>Save a recipient</h2>
                <p className="muted small">
                  Saved people are filled in automatically when you type their name.
                </p>
                <form onSubmit={saveRecipient} className="form-grid">
                  <input
                    placeholder="Name, e.g. Wanjiru"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                  <select
                    value={form.rail}
                    onChange={(e) => setForm({ ...form, rail: e.target.value })}
                  >
                    <option value="mpesa">M-PESA</option>
                    <option value="bank">Bank</option>
                  </select>
                  <input
                    placeholder={
                      form.rail === "mpesa" ? "Phone, e.g. 254712345678" : "Bank account number"
                    }
                    value={form.account}
                    onChange={(e) => setForm({ ...form, account: e.target.value })}
                    required
                  />
                  <button type="submit">Save</button>
                </form>
                {notice && <p className="saved small">{notice}</p>}
              </section>

              <section className="card">
                <h2>Saved recipients</h2>
                {recipients.length === 0 ? (
                  <p className="muted">Nobody saved yet.</p>
                ) : (
                  recipients.map((r) => (
                    <div className="payment" key={r.id}>
                      <div className="payment-top">
                        <strong>{r.name}</strong>
                        <span className="pill">{RAIL_LABEL[r.rail] || r.rail}</span>
                      </div>
                      <p className="muted small">{r.account}</p>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </main>

        {/* ---- Side panel: quick links ---- */}
        <aside className="side">
          <h2>Quick pay</h2>
          {recipients.length === 0 ? (
            <p className="muted small">Saved recipients show up here.</p>
          ) : (
            recipients.map((r, i) => (
              <button className="quick" key={r.id} onClick={() => quickPay(r.name)}>
                <span
                  className="tile"
                  style={{ background: TILE_COLOURS[i % TILE_COLOURS.length] }}
                >
                  {r.name.charAt(0).toUpperCase()}
                </span>
                <span className="quick-text">
                  <strong>{r.name}</strong>
                  <span className="muted small">{RAIL_LABEL[r.rail] || r.rail}</span>
                </span>
              </button>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
