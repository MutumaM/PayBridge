import os
import json
import requests

from rails import RAIL_FEES_KES

# PASTE a current model name from AI Studio's model list here
MODEL = "gemini-3.1-flash-lite"

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
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": user_text}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }
    response = None
    # Try up to 2 times, since free-tier calls can be slow
    for attempt in range(2):
        try:
            response = requests.post(
                url,
                headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
                json=body,
                timeout=60,  # was 30
            )
            break
        except requests.exceptions.Timeout:
            if attempt == 1:
                raise RuntimeError("Gemini timed out twice. Try again shortly.")
    if not response.ok:
        raise RuntimeError(f"Gemini error {response.status_code}: {response.text}")

    # The answer is JSON text inside the first candidate
    text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)["payments"]


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
    """Extract payments with the AI, then add rail, fee and KES math."""
    plan = []
    for item in extract_payments(user_text):
        amount_kes = round(item["amount_usd"] * USD_TO_KES, 2)
        rail, reason = choose_rail(amount_kes, item["rail_preference"])
        fee = RAIL_FEES_KES[rail]
        plan.append({
            "name": item["name"],
            "account": item["account"],
            "amount_usd": item["amount_usd"],
            "amount_kes": amount_kes,
            "rail": rail,
            "fee_kes": fee,
            "net_kes": round(amount_kes - fee, 2),
            "reason": reason,
            "receipt_narrative": item["receipt_narrative"],
        })
    return plan