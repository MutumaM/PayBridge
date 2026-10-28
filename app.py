from dotenv import load_dotenv
from flask import Flask, jsonify, request
from ai_planner import USD_TO_KES, choose_rail
from rails import RAIL_FEES_KES

load_dotenv()  # loads the keys from .env (must run before PayPal calls)

from paypal_client import send_paypal_payout
from rails import MockRail
from ai_planner import build_plan

app = Flask(__name__)
rail_engine = MockRail()  # later: swap for a real provider

# PLACEHOLDER exchange rate for the demo only.
# We will replace this with a real rate source later.
USD_TO_KES = 129.0


@app.route("/api/transfer", methods=["POST"])
def transfer():
    """Full flow: PayPal USD payout, then simulated KES delivery.
    Expects JSON: amount_usd, rail, name, account."""
    data = request.get_json() or {}
    try:
        amount_usd = float(data.get("amount_usd", 0))
        if amount_usd <= 0:
            return jsonify({"error": "amount_usd must be above zero"}), 400

        # Step 1: real PayPal sandbox payout
        batch_id = send_paypal_payout(amount_usd, "PayBridge settlement")

        # Step 2: convert USD to KES (placeholder rate)
        amount_kes = round(amount_usd * USD_TO_KES, 2)

        # Step 3: simulated local delivery
        payout = rail_engine.send_payout(
            rail=data.get("rail"),
            amount_kes=amount_kes,
            name=data.get("name", ""),
            account=data.get("account", ""),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502

    payout["paypal_batch_id"] = batch_id
    payout["amount_usd"] = amount_usd
    payout["fx_rate_used"] = USD_TO_KES
    return jsonify(payout), 201


@app.route("/api/payouts/<payout_id>", methods=["GET"])
def get_payout(payout_id):
    payout = rail_engine.get_status(payout_id)
    if payout is None:
        return jsonify({"error": "Payout not found"}), 404
    return jsonify(payout)


@app.route("/api/payouts", methods=["GET"])
def list_payouts():
    return jsonify(rail_engine.list_payouts())


@app.route("/api/plan", methods=["POST"])
def plan():
    """Preview only: reads a request and shows the plan. No money moves."""
    data = request.get_json() or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "Please type a payment request."}), 400
    try:
        return jsonify({"plan": build_plan(text)})
    except Exception as error:
        return jsonify({"error": f"Planning failed: {error}"}), 502


# Safety limit: no single payment above this (USD) in the demo
MAX_USD_PER_PAYMENT = 5000


@app.route("/api/execute", methods=["POST"])
def execute():
    """Run a confirmed plan. Expects JSON: {"plan": [ {name, account,
    amount_usd, rail, receipt_narrative}, ... ]}"""
    data = request.get_json() or {}
    items = data.get("plan", [])
    if not items:
        return jsonify({"error": "The plan is empty."}), 400

    # STEP 1: validate everything BEFORE any money moves
    problems = []
    for item in items:
        name = str(item.get("name", "")).strip()
        if not name:
            problems.append("A payment has no name.")
            continue
        if not str(item.get("account", "")).strip():
            problems.append(f"{name}: no phone or bank account given.")
        try:
            amount = float(item.get("amount_usd", 0))
        except (TypeError, ValueError):
            amount = 0
        if amount <= 0 or amount > MAX_USD_PER_PAYMENT:
            problems.append(f"{name}: amount must be between 0 and ${MAX_USD_PER_PAYMENT}.")
        if item.get("rail") not in RAIL_FEES_KES:
            problems.append(f"{name}: rail must be 'mpesa' or 'bank'.")
    if problems:
        return jsonify({"error": "Plan not run.", "problems": problems}), 400

    # STEP 2: run each payment. We recompute the KES amount on the server
    # so we never trust numbers sent by the browser.
    receipts = []
    for item in items:
        amount_usd = float(item["amount_usd"])
        amount_kes = round(amount_usd * USD_TO_KES, 2)
        rail, reason = choose_rail(amount_kes, item["rail"])
        try:
            batch_id = send_paypal_payout(amount_usd, f"PayBridge: {item['name']}")
            payout = rail_engine.send_payout(
                rail=rail,
                amount_kes=amount_kes,
                name=item["name"],
                account=str(item["account"]).strip(),
            )
            payout["paypal_batch_id"] = batch_id
            payout["amount_usd"] = amount_usd
            payout["receipt_narrative"] = item.get("receipt_narrative", "")
            payout["rail_reason"] = reason
            receipts.append(payout)
        except Exception as error:
            # One failure shouldn't hide the others
            receipts.append({"name": item["name"], "error": str(error)})

    return jsonify({"receipts": receipts}), 201

if __name__ == "__main__":
    app.run(port=5000, debug=True)