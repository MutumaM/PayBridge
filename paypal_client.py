import os
import uuid
import requests

# Sandbox only: no real money moves here
BASE = "https://api-m.sandbox.paypal.com"


def get_token():
    """Ask PayPal for a temporary access token using our keys."""
    response = requests.post(
        f"{BASE}/v1/oauth2/token",
        auth=(os.environ["PAYPAL_CLIENT_ID"], os.environ["PAYPAL_SECRET"]),
        data={"grant_type": "client_credentials"},  # sent as a form
        timeout=15,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def send_paypal_payout(amount_usd, note):
    """Send a USD payout through PayPal. Returns the batch ID."""
    token = get_token()
    body = {
        "sender_batch_header": {
            # PayPal rejects repeated batch IDs, so we make a unique one
            "sender_batch_id": "pb-" + uuid.uuid4().hex[:12],
            "email_subject": "PayBridge settlement",
        },
        "items": [{
            "recipient_type": "EMAIL",
            "amount": {"value": f"{amount_usd:.2f}", "currency": "USD"},
            "receiver": os.environ["PAYPAL_RECEIVER_EMAIL"],
            "note": note,
        }],
    }
    response = requests.post(
        f"{BASE}/v1/payments/payouts",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
        timeout=15,
    )
    if not response.ok:
        # Show PayPal's own error text so we can debug it
        raise RuntimeError(f"PayPal error {response.status_code}: {response.text}")
    return response.json()["batch_header"]["payout_batch_id"]