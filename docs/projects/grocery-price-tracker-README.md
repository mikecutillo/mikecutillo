# Grocery Price Tracker — Getting Started Guide

> Last updated: 2026-04-12
> Status: **Setup phase** — database exists, automation not yet wired

---

## What This Is

A Notion-powered grocery price tracking system that will:
- Track prices you pay at **Whole Foods, ShopRite, Stop & Shop, and Costco**
- Compare unit prices across stores (is Costco actually cheaper?)
- Surface weekly deal recommendations
- Learn your shopping patterns over time
- Send alerts to Discord when deals match items you buy

---

## What Exists Today

### Notion Database: "Grocery Price Checks"
- **Location:** OneNote workspace in Notion (not yet shared with API integration)
- **Columns:** Item Name, Best Deal (checkbox), Category, Date Checked, Grocery Item, Notes, Price, Price Per Unit, Store, Unit
- **Current state:** ~25 items seeded with names and categories, but almost no prices or dates filled in. Only "Bananas - green" has a real price ($0.69 at Whole Foods).

### Connected Services
| Service | Status | What It Can Do |
|---------|--------|---------------|
| **Notion MCP** | Connected, but DB not shared with integration | Read/write/query database once shared |
| **Gmail MCP** | Connected (cutillo@gmail.com) | Search for receipts, parse emails |
| **Chrome MCP** | Available | Scrape weekly circulars from store websites |
| **Discord** | Not yet set up | Will be the alert/notification channel |

### Gmail Receipt Status
- **Costco promos:** Arriving at cutillo@gmail.com (deal alerts, member savings)
- **Grocery receipts:** NOT found in this inbox — need to identify which email/app gets them
- Possible sources: Amazon/Whole Foods app, Instacart, ShopRite app, paper receipts

---

## Setup Checklist (Do These First)

### Step 1: Share Notion DB with Your Integration
This is the #1 blocker. Without this, Claude can't read or write to the database.

1. Open the "Grocery Price Checks" database in Notion
2. Click **Share** (top right)
3. Click **Invite**
4. Search for your Notion integration (the one connected via API key)
5. Grant it **Full access**
6. Test: Ask Claude to "search Notion for Grocery Price Checks" — it should find it

### Step 2: Identify Your Receipt Sources
Figure out where your grocery receipts actually live:

- **Whole Foods/Amazon:** Do you order through the Amazon app? Receipts go to your Amazon email.
- **ShopRite:** Do you use the ShopRite app or ShopRite from Home? Check which email.
- **Stop & Shop:** Same question — app or in-store?
- **Costco:** In-store receipts are paper. Online orders email to cutillo@gmail.com.
- **Instacart:** If you use it, receipts are detailed and easy to parse.

Tell Claude which emails get grocery receipts so we can connect those Gmail accounts.

### Step 3: Create Discord Channel
1. In your Discord server, create a channel like `#grocery-deals`
2. Create a webhook for that channel (Server Settings > Integrations > Webhooks)
3. Save the webhook URL — Claude will use it to post alerts

---

## How It Will Work (Once Set Up)

### Automatic Price Ingestion
- **Email receipts:** Claude scans Gmail on a schedule, extracts item prices, logs them to Notion
- **Manual entry:** Tell Claude "bananas were $0.69/lb at Whole Foods" and it updates the DB
- **Costco deal emails:** Already flowing in — Claude will parse "Member-Only Savings" emails for relevant deals

### Weekly Circular Scraping
- Claude checks weekly flyers for ShopRite, Stop & Shop, and Whole Foods
- Matches sale items against your tracked products
- Posts to Discord: "Chicken thighs are $1.99/lb at ShopRite this week (you usually pay $3.49 at Whole Foods)"

### Costco vs. Regular Store Comparison
- Tracks unit prices (price per oz, per lb, per count) across all stores
- Weekly report: "5 items that are cheaper at your regular store than Costco this month"
- Flags when Costco bulk price actually loses vs. a sale price elsewhere

### Shopping Insights (Builds Over Time)
- Which store is cheapest for YOUR specific list?
- Seasonal price trends (produce is cheaper in summer, etc.)
- Spending patterns: weekly grocery spend, category breakdown
- "You buy X every 2 weeks — it's on sale now, stock up"

---

## Quick Commands (For Future Claude Sessions)

Once set up, you'll be able to say things like:

| Say This | Claude Does This |
|----------|-----------------|
| "Log this receipt" + paste/photo | Extracts items and prices, adds to Notion |
| "What's on sale this week?" | Checks circulars, compares to your list |
| "Is Costco cheaper for chicken?" | Pulls price history, compares unit prices |
| "Update grocery prices" | Runs the full pipeline: emails + circulars + DB update |
| "What should I buy at ShopRite this week?" | Cross-references your usual items with current ShopRite sales |
| "Grocery spending this month" | Summarizes spend by store, category, trends |

---

## Architecture (When Fully Built)

```
Gmail Receipts ──┐
                 ├──► SQLite (groceries.db) ──► Notion (display/edit)
Store Circulars ─┤         │
                 │         ├──► Discord (#grocery-deals)
Manual Entry ────┘         │
                           └──► Weekly Insights Report
```

- **SQLite** = fast analytics engine (price history, comparisons, trends)
- **Notion** = friendly UI for viewing/editing items and prices
- **Discord** = push notifications for deals and insights
- **Gmail** = automatic receipt ingestion
- **Chrome MCP** = weekly circular scraping

---

## Files & Locations

| What | Where |
|------|-------|
| This guide | `docs/projects/grocery-price-tracker-README.md` |
| Notion sync script (template) | `scripts/notion-sync.py` |
| Financial ledger (has grocery category) | `mission-control/data/financial-ledger.json` |
| Future: grocery database | `data/groceries.db` (SQLite, to be created) |
| Future: price scraper | `scripts/grocery-prices.py` (to be created) |
| Future: design spec | `docs/specs/` (to be created during design phase) |

---

## Next Steps

When you're ready to build this out, come back and say:
> "Let's set up the grocery price tracker — I've shared the Notion DB and here's where my receipts go"

Claude will pick up from there with the full design and implementation.
