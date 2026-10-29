import os
import json
import time
import requests

from db import get_recipient
from rails import RAIL_FEES_KES

# Models to try, in order. If one is busy or out of quota, the next is used.
MODELS = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite"]

# PLACEHOLDERS: replace with real published limits before submitting
MPESA_MAX_KES = 150000
USD_TO_KES = 129.0

SYSTEM_PROMPT = (
    "You extract payment instructions from a user's message. "
    "Never invent people, amounts or account numbers. "
    "If an account is missing, use an empty string. "
    "Use rail_preference 'none' unless the user explicitly asks for "
    "M-PESA (mpesa) or a bank (bank). "
    "Write each receipt_narrative as a short, neutral business description."
)

# This describes the exact shape of the answer we want back
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "payments": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "amount_usd": {"type": "NUMBER"},
                    "account": {"type": "STRING"},
                    "rail_preference": {
                        "type": "STRING",
                        "enum": ["mpesa", "bank", "none"],
                    },
                    "receipt_narrative": {"type": "STRING"},
                },
                "required": [
                    "name", "amount_usd", "account",
                    "rail_preference", "receipt_narrative",
                ],
            },
        }
    },
    "required": ["payments"],
}


def extract_payments(user_text):
    """Ask Gemini (over plain HTTP) to turn text into a list of payments."""
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": user_text}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }
    last_error = "unknown error"

    for model in MODELS:                      # try each model in turn
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        for attempt in range(3):              # up to 3 tries per model
            try:
                response = requests.post(
                    url,
                    headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
                    json=body,
                    timeout=60,
                )
            except requests.exceptions.Timeout:
                last_error = f"{model} timed out"
                continue

            if response.ok:
                text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)["payments"]

            # 503 = overloaded: wait a little, then retry the same model
            if response.status_code == 503:
                last_error = f"{model} busy (503)"
                time.sleep(2 * (attempt + 1))
                continue

            # 429 = quota or rate limit: retrying won't help, try the next model
            if response.status_code == 429:
                last_error = f"{model} quota or rate limit (429)"
                break

            # Any other error is a real problem, so show it right away
            raise RuntimeError(f"Gemini error {response.status_code}: {response.text}")

    raise RuntimeError(f"All models were busy. Last problem: {last_error}")


def choose_rail(amount_kes, preference):
    """Plain Python decides the rail, so the numbers are always reliable."""
    if preference in ("mpesa", "bank"):
        # Respect the user's choice, unless M-PESA can't take the amount
        if preference == "mpesa" and amount_kes > MPESA_MAX_KES:
            return "bank", "Amount is above the M-PESA limit, so bank was used."
        return preference, "You asked for this rail."
    # No preference: pick the cheaper rail that can take the amount
    if amount_kes <= MPESA_MAX_KES:
        return "mpesa", "M-PESA has the lower fee for this amount."
    return "bank", "Amount is above the M-PESA limit, so bank was used."


def build_plan(user_text):
    """Extract payments with the AI, fill in saved recipient details,
    then add rail, fee and KES math."""
    plan = []
    for item in extract_payments(user_text):
        amount_kes = round(item["amount_usd"] * USD_TO_KES, 2)
        account = item["account"].strip()
        preference = item["rail_preference"]

        # Look the person up in our saved recipients
        saved = get_recipient(item["name"])
        account_from_saved = False
        preference_from_saved = False
        if saved:
            if not account:
                account = saved["account"]
                account_from_saved = True
            if preference == "none":
                preference = saved["rail"]
                preference_from_saved = True

        rail, reason = choose_rail(amount_kes, preference)

        # Better wording when the rail came from the saved details
        if preference_from_saved and rail == preference:
            reason = "Using this recipient's saved rail."

        # SAFETY: a saved phone number can't be used for a bank payment
        # (and the other way round), so ask for the right account instead.
        if account_from_saved and rail != saved["rail"]:
            account = ""
            reason += " Saved details are for a different rail, so enter the account."
            account_from_saved = False

        fee = RAIL_FEES_KES[rail]
        plan.append({
            "name": item["name"],
            "account": account,
            "needs_account": account == "",  # the app can highlight this
            "from_saved_recipient": account_from_saved,
            "amount_usd": item["amount_usd"],
            "amount_kes": amount_kes,
            "rail": rail,
            "fee_kes": fee,
            "net_kes": round(amount_kes - fee, 2),
            "reason": reason,
            "receipt_narrative": item["receipt_narrative"],
        })
    return plan
