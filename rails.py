import time
import uuid

# NOTE: these fees are PLACEHOLDERS for the demo.
# Later we will replace them with real published fee tables.
RAIL_FEES_KES = {
    "mpesa": 30,   # flat fee in KES (placeholder)
    "bank": 50,    # flat fee in KES (placeholder)
}

# How many seconds a simulated payout takes to "arrive"
DELIVERY_SECONDS = {
    "mpesa": 5,
    "bank": 10,
}

# We keep payouts in memory (a dictionary) to keep things simple.
# They disappear when the server restarts, which is fine for now.
PAYOUTS = {}


class MockRail:
    """A fake payment rail that behaves like a real one.

    Every method here is what a real provider (IntaSend, etc.)
    would also offer, so we can swap it in later without
    changing the rest of the app.
    """

    def send_payout(self, rail, amount_kes, name, account):
        # Reject rails we don't know about
        if rail not in RAIL_FEES_KES:
            raise ValueError("Unknown rail. Use 'mpesa' or 'bank'.")
        if amount_kes <= 0:
            raise ValueError("Amount must be greater than zero.")

        payout_id = "MOCK-" + uuid.uuid4().hex[:8].upper()
        PAYOUTS[payout_id] = {
            "id": payout_id,
            "rail": rail,
            "name": name,
            "account": account,
            "amount_kes": amount_kes,
            "fee_kes": RAIL_FEES_KES[rail],
            "created_at": time.time(),
            "simulated": True,  # always labelled as simulated
        }
        return self.get_status(payout_id)

    def get_status(self, payout_id):
        payout = PAYOUTS.get(payout_id)
        if payout is None:
            return None

        # Status depends on how much time has passed since creation
        elapsed = time.time() - payout["created_at"]
        if elapsed < 1:
            status = "initiated"
        elif elapsed < DELIVERY_SECONDS[payout["rail"]]:
            status = "processing"
        else:
            status = "delivered"

        # Return a copy that includes the current status
        result = dict(payout)
        result["status"] = status
        return result

    def list_payouts(self):
        return [self.get_status(pid) for pid in PAYOUTS]