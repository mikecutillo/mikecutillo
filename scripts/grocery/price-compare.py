#!/usr/bin/env python3
"""
Grocery Price Tracker — Costco vs Regular Store Comparison

Queries the SQLite grocery database and generates a report showing items
where Costco is NOT the cheapest option (regular stores beat Costco on
unit price).

Usage:
    python scripts/grocery/price-compare.py

Output:
    Prints comparison report and saves to data/costco-comparison.json
"""

import json
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "groceries.db"
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "data" / "costco-comparison.json"


def run_comparison(conn: sqlite3.Connection) -> list[dict]:
    """Find items where a regular store beats Costco on unit price."""
    cursor = conn.cursor()

    # Get all items that have both a Costco price and at least one other store price
    cursor.execute("""
        SELECT DISTINCT item_name
        FROM price_observations
        WHERE store = 'Costco' AND price_per_unit IS NOT NULL AND price_per_unit > 0
    """)
    costco_items = [row[0] for row in cursor.fetchall()]

    results = []
    for item in costco_items:
        # Get Costco price
        cursor.execute("""
            SELECT price, price_per_unit, unit, notes
            FROM price_observations
            WHERE item_name = ? AND store = 'Costco'
            ORDER BY date_checked DESC LIMIT 1
        """, (item,))
        costco = cursor.fetchone()
        if not costco:
            continue

        costco_price, costco_ppu, costco_unit, costco_notes = costco

        # Get best regular store price
        cursor.execute("""
            SELECT store, price, price_per_unit, unit, notes
            FROM price_observations
            WHERE item_name = ? AND store != 'Costco'
              AND price_per_unit IS NOT NULL AND price_per_unit > 0
            ORDER BY price_per_unit ASC LIMIT 1
        """, (item,))
        best_regular = cursor.fetchone()
        if not best_regular:
            continue

        reg_store, reg_price, reg_ppu, reg_unit, reg_notes = best_regular

        # Compare
        if costco_ppu and reg_ppu:
            savings_pct = round((costco_ppu - reg_ppu) / costco_ppu * 100, 1) if costco_ppu > reg_ppu else 0
            costco_wins = costco_ppu <= reg_ppu

            results.append({
                "item": item,
                "costco_price": costco_price,
                "costco_ppu": costco_ppu,
                "costco_notes": costco_notes,
                "best_regular_store": reg_store,
                "regular_price": reg_price,
                "regular_ppu": reg_ppu,
                "regular_notes": reg_notes,
                "unit": costco_unit or reg_unit,
                "costco_wins": costco_wins,
                "ppu_difference": round(abs(costco_ppu - reg_ppu), 2),
                "savings_pct": savings_pct if not costco_wins else 0,
            })

    # Sort: items where regular stores win, sorted by savings percentage
    results.sort(key=lambda x: (x["costco_wins"], -x.get("savings_pct", 0)))
    return results


def print_report(results: list[dict]):
    """Print a formatted comparison report."""
    regular_wins = [r for r in results if not r["costco_wins"]]
    costco_wins = [r for r in results if r["costco_wins"]]

    print("\n" + "=" * 70)
    print("  COSTCO vs REGULAR STORES — Price Comparison Report")
    print("=" * 70)

    if regular_wins:
        print(f"\n--- Items CHEAPER at Regular Stores ({len(regular_wins)}) ---\n")
        for r in regular_wins:
            print(f"  {r['item']}")
            print(f"    Costco:     ${r['costco_ppu']:.2f}/{r['unit']}  (${r['costco_price']:.2f} total)")
            print(f"    {r['best_regular_store']:12s}: ${r['regular_ppu']:.2f}/{r['unit']}  (${r['regular_price']:.2f} total)")
            print(f"    You save {r['savings_pct']}% buying at {r['best_regular_store']}")
            print()

    if costco_wins:
        print(f"\n--- Items CHEAPER at Costco ({len(costco_wins)}) ---\n")
        for r in costco_wins:
            diff_pct = round((r["regular_ppu"] - r["costco_ppu"]) / r["regular_ppu"] * 100, 1) if r["regular_ppu"] > 0 else 0
            print(f"  {r['item']}")
            print(f"    Costco:     ${r['costco_ppu']:.2f}/{r['unit']}")
            print(f"    {r['best_regular_store']:12s}: ${r['regular_ppu']:.2f}/{r['unit']}")
            print(f"    Costco saves you {diff_pct}%")
            print()

    print(f"\nTotal items compared: {len(results)}")
    print(f"Costco wins: {len(costco_wins)} | Regular stores win: {len(regular_wins)}")


def main():
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        print("Run sync-to-sqlite.py first to populate the database.")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    results = run_comparison(conn)

    if not results:
        print("No comparison data available. Ensure prices are synced.")
        conn.close()
        return

    print_report(results)

    # Save to JSON for API/dashboard consumption
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump({
            "generated_at": __import__("datetime").datetime.now().isoformat(),
            "total_compared": len(results),
            "costco_wins": len([r for r in results if r["costco_wins"]]),
            "regular_wins": len([r for r in results if not r["costco_wins"]]),
            "comparisons": results,
        }, f, indent=2)

    print(f"\nReport saved to: {OUTPUT_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
