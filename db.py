import sqlite3
import time

# The database is a single file, created automatically in your folder
DB_PATH = "paybridge.db"


def get_connection():
    """Open the database. Rows come back like dictionaries."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the tables if they don't exist yet. Safe to run every start."""
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS payouts (
            id TEXT PRIMARY KEY,
            rail TEXT NOT NULL,
            name TEXT NOT NULL,
            account TEXT NOT NULL,
            amount_kes REAL NOT NULL,
            amount_usd REAL,
            fee_kes REAL NOT NULL,
            paypal_batch_id TEXT,
            receipt_narrative TEXT,
            rail_reason TEXT,
            created_at REAL NOT NULL,
            simulated INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            rail TEXT NOT NULL,
            account TEXT NOT NULL,
            created_at REAL NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def _row_to_dict(row):
    """Turn a database row into a normal dictionary."""
    if row is None:
        return None
    data = dict(row)
    if "simulated" in data:
        data["simulated"] = bool(data["simulated"])  # 1 becomes True
    return data


# ---------- payouts ----------

def save_payout(p):
    """Save one payout (a dictionary) to the database."""
    conn = get_connection()
    conn.execute(
        """INSERT INTO payouts
           (id, rail, name, account, amount_kes, amount_usd, fee_kes,
            paypal_batch_id, receipt_narrative, rail_reason, created_at, simulated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            p["id"], p["rail"], p["name"], p["account"],
            p["amount_kes"], p.get("amount_usd"), p["fee_kes"],
            p.get("paypal_batch_id"), p.get("receipt_narrative"),
            p.get("rail_reason"), p["created_at"], 1,
        ),
    )
    conn.commit()
    conn.close()


def get_payout(payout_id):
    conn = get_connection()
    row = conn.execute("SELECT * FROM payouts WHERE id = ?", (payout_id,)).fetchone()
    conn.close()
    return _row_to_dict(row)


def list_payouts():
    """All payouts, newest first."""
    conn = get_connection()
    rows = conn.execute("SELECT * FROM payouts ORDER BY created_at DESC").fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


# ---------- recipients ----------

def save_recipient(name, rail, account):
    """Add a recipient, or update them if the name already exists."""
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO recipients (name, rail, account, created_at) "
        "VALUES (?, ?, ?, ?)",
        (name, rail, account, time.time()),
    )
    conn.commit()
    conn.close()


def list_recipients():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM recipients ORDER BY name").fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]