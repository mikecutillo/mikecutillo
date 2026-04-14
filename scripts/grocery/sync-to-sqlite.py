#!/usr/bin/env python3
"""
Grocery Price Tracker — Notion → SQLite Sync

Pulls all rows from the Notion "Grocery Price Checks" database and syncs them
into a local SQLite database for fast analytics queries (price comparisons,
trend detection, spending insights).

Usage:
    python scripts/grocery/sync-to-sqlite.py

Requires:
    - NOTION_TOKEN env var (Notion integration API key)
    - requests library (pip install requests)

Data flow:
    Notion "Grocery Price Checks" DB → data/groceries.db
"""

import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Run: pip install requests")
    sys.exit(1)

# --- Config ---
DB_PATH = Path(__file__).resolve().parents[2] / "data" / "groceries.db"
NOTION_DB_ID = "340b4eed-30a2-812f-b7b4-c7b2f37433bb"
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


def init_db(conn: sqlite3.Connection):
    """Create tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS price_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notion_page_id TEXT UNIQUE,
            item_name TEXT NOT NULL,
            store TEXT NOT NULL,
            price REAL,
            unit TEXT,
            price_per_unit REAL,
            category TEXT,
            date_checked TEXT,
            best_deal INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item TEXT NOT NULL,
            matched_db_item TEXT,
            store TEXT NOT NULL,
            deal_price REAL,
            regular_price REAL,
            savings REAL,
            savings_pct REAL,
            unit TEXT,
            valid_from TEXT,
            valid_to TEXT,
            source TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS shopping_trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store TEXT NOT NULL,
            date TEXT NOT NULL,
            total REAL,
            item_count INTEGER,
            receipt_source TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_obs_item ON price_observations(item_name);
        CREATE INDEX IF NOT EXISTS idx_obs_store ON price_observations(store);
        CREATE INDEX IF NOT EXISTS idx_obs_date ON price_observations(date_checked);
    """)


def fetch_notion_pages() -> list[dict]:
    """Query all pages from the Grocery Price Checks database."""
    if not NOTION_TOKEN:
        print("WARNING: NOTION_TOKEN not set. Skipping Notion fetch.")
        return []

    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }

    pages = []
    has_more = True
    start_cursor = None

    while has_more:
        payload: dict = {"page_size": 100}
        if start_cursor:
            payload["start_cursor"] = start_cursor

        resp = requests.post(
            f"{NOTION_API}/databases/{NOTION_DB_ID}/query",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

        pages.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    return pages


def extract_text(prop: dict) -> str:
    """Extract plain text from a Notion rich_text or title property."""
    items = prop.get("title") or prop.get("rich_text") or []
    return "".join(t.get("plain_text", "") for t in items)


def extract_number(prop: dict) -> float | None:
    """Extract number from a Notion number property."""
    return prop.get("number")


def extract_select(prop: dict) -> str | None:
    """Extract name from a Notion select property."""
    sel = prop.get("select")
    return sel.get("name") if sel else None


def extract_checkbox(prop: dict) -> bool:
    """Extract value from a Notion checkbox property."""
    return prop.get("checkbox", False)


def extract_date(prop: dict) -> str | None:
    """Extract start date from a Notion date property."""
    d = prop.get("date")
    return d.get("start") if d else None


def sync_pages(conn: sqlite3.Connection, pages: list[dict]):
    """Upsert Notion pages into SQLite."""
    cursor = conn.cursor()
    synced = 0

    for page in pages:
        props = page.get("properties", {})
        page_id = page["id"]

        item_name = extract_text(props.get("Item Name", {}))
        store = extract_select(props.get("Store", {}))
        price = extract_number(props.get("Price", {}))
        unit = extract_select(props.get("Unit", {}))
        ppu = extract_number(props.get("Price Per Unit", {}))
        category = extract_select(props.get("Category", {}))
        date_checked = extract_date(props.get("Date Checked", {}))
        best_deal = 1 if extract_checkbox(props.get("Best Deal", {})) else 0
        notes = extract_text(props.get("Notes", {}))

        if not item_name:
            continue

        cursor.execute("""
            INSERT INTO price_observations
                (notion_page_id, item_name, store, price, unit, price_per_unit,
                 category, date_checked, best_deal, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(notion_page_id) DO UPDATE SET
                item_name = excluded.item_name,
                store = excluded.store,
                price = excluded.price,
                unit = excluded.unit,
                price_per_unit = excluded.price_per_unit,
                category = excluded.category,
                date_checked = excluded.date_checked,
                best_deal = excluded.best_deal,
                notes = excluded.notes
        """, (page_id, item_name, store, price, unit, ppu,
              category, date_checked, best_deal, notes))
        synced += 1

    conn.commit()
    return synced


def sync_deals(conn: sqlite3.Connection):
    """Sync deals from grocery-deals.json into SQLite."""
    deals_path = Path(__file__).resolve().parents[2] / "mission-control" / "data" / "grocery-deals.json"
    if not deals_path.exists():
        return 0

    with open(deals_path) as f:
        data = json.load(f)

    cursor = conn.cursor()
    count = 0
    for deal in data.get("deals", []):
        cursor.execute("""
            INSERT OR IGNORE INTO deals
                (item, matched_db_item, store, deal_price, regular_price,
                 savings, savings_pct, unit, valid_from, valid_to, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            deal.get("item"), deal.get("matched_db_item"), deal.get("store"),
            deal.get("deal_price"), deal.get("regular_price"),
            deal.get("savings"), deal.get("savings_pct"), deal.get("unit"),
            data.get("valid_from"), data.get("valid_to"), data.get("scan_source"),
        ))
        count += 1

    conn.commit()
    return count


def print_summary(conn: sqlite3.Connection):
    """Print a quick summary of what's in the database."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM price_observations")
    obs_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT item_name) FROM price_observations")
    item_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT store) FROM price_observations WHERE store IS NOT NULL")
    store_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM deals")
    deal_count = cursor.fetchone()[0]

    print(f"\n--- Grocery DB Summary ---")
    print(f"Price observations: {obs_count}")
    print(f"Unique items:       {item_count}")
    print(f"Stores tracked:     {store_count}")
    print(f"Active deals:       {deal_count}")
    print(f"Database:           {DB_PATH}")


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    init_db(conn)

    # Sync from Notion
    print("Fetching pages from Notion...")
    pages = fetch_notion_pages()
    if pages:
        synced = sync_pages(conn, pages)
        print(f"Synced {synced} price observations from Notion.")
    else:
        print("No Notion pages fetched (token may not be set).")

    # Sync deals from JSON
    deal_count = sync_deals(conn)
    if deal_count:
        print(f"Synced {deal_count} deals from grocery-deals.json.")

    print_summary(conn)
    conn.close()


if __name__ == "__main__":
    main()
