import time
import uuid

from db import save_payout, get_payout, list_payouts

# PLACEHOLDER fees (flat, in KES). Replace with real published fees later.
RAIL_FEES_KES = {
    "mpesa": 30,
    "bank": 50,
}

# How many seconds a simulated payout takes to "arrive"
DELIVERY_SECONDS = {
    "mpesa": 5,
    "bank": 10,
}


class MockRail:
    """A fake payment rail. A real provider would offer the same methods."""

    def send_payout(self, rail, amount_kes, name, account, **extra):
        """Create a simulated payout and save it to the database.
        extra can hold: amount_usd, paypal_batch_id, receipt_narrative, rail_reason"""
        if rail not in RAIL_FEES_KES:
            raise ValueError("Unknown rail. Use 'mpesa' or 'bank'.")
        if amount_kes <= 0:
            raise ValueError("Amount must be greater than zero.")

        record = {
            "id": "MOCK-" + uuid.uuid4().hex[:8].upper(),
            "rail": rail,
            "name": name,
            "account": account,
            "amount_kes": amount_kes,
            "fee_kes": RAIL_FEES_KES[rail],
            "created_at": time.time(),
        }
        record.update(extra)  # add the optional extras
        save_payout(record)
        return self._with_status(get_payout(record["id"]))

    def _with_status(self, payout):
        """Work out the status from how much time has passed."""
        elapsed = time.time() - payout["created_at"]
        if elapsed < 1:
            payout["status"] = "initiated"
        elif elapsed < DELIVERY_SECONDS[payout["rail"]]:
            payout["status"] = "processing"
        else:
            payout["status"] = "delivered"
        return payout

    def get_status(self, payout_id):
        payout = get_payout(payout_id)
        return self._with_status(payout) if payout else None

    def list_payouts(self):
        return [self._with_status(p) for p in list_payouts()]