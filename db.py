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

def get_recipient(name):
    """Find a saved recipient by name (not case-sensitive).
    Tries an exact match first, then a single unique 'starts with' match
    (so "Wanjiru" can find "Wanjiru Kamau"). Returns None if not found."""
    name = name.strip()
    if not name:
        return None
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM recipients WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if row is None:
        rows = conn.execute(
            "SELECT * FROM recipients WHERE name LIKE ? COLLATE NOCASE",
            (name + "%",),
        ).fetchall()
        # Only accept it if exactly one person matches, to avoid mix-ups
        row = rows[0] if len(rows) == 1 else None
    conn.close()
    return _row_to_dict(row)

# ---------- executed plans (stops the same plan running twice) ----------

def init_plan_table():
    """Create the table that remembers which plan IDs have been run."""
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS executed_plans (
            plan_id TEXT PRIMARY KEY,
            created_at REAL NOT NULL,
            receipts_json TEXT
        )
    """)
    conn.commit()
    conn.close()


def claim_plan(plan_id):
    """Try to claim a plan ID. Returns True if it is new, False if
    it was already used. The PRIMARY KEY makes this safe even if two
    clicks arrive at the same moment."""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO executed_plans (plan_id, created_at) VALUES (?, ?)",
            (plan_id, time.time()),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def finish_plan(plan_id, receipts):
    """Store the receipts once the plan has finished running."""
    import json
    conn = get_connection()
    conn.execute(
        "UPDATE executed_plans SET receipts_json = ? WHERE plan_id = ?",
        (json.dumps(receipts), plan_id),
    )
    conn.commit()
    conn.close()


def get_plan_result(plan_id):
    """Return the saved receipts for a plan, or None if it is still running."""
    import json
    conn = get_connection()
    row = conn.execute(
        "SELECT receipts_json FROM executed_plans WHERE plan_id = ?", (plan_id,)
    ).fetchone()
    conn.close()
    if row is None or row["receipts_json"] is None:
        return None
    return json.loads(row["receipts_json"])
