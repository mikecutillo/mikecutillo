#!/usr/bin/env python3
"""
financial-scan.py — Household Financial Ledger Scanner

Deep-scans Gmail across all household accounts, classifies bills/payments
via Claude, and writes a unified financial ledger JSON.

Usage:
    python3 scripts/financial-scan.py              # 90-day scan, all accounts
    python3 scripts/financial-scan.py --days 365   # full year
    python3 scripts/financial-scan.py --dry-run    # scan + classify, don't write
    python3 scripts/financial-scan.py --merge      # merge with existing ledger
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic

# ── Paths ─────────────────────────────────────────────────────────────────────
WORKSPACE = Path("/Users/mikecutillo/.openclaw/workspace-shared")
sys.path.insert(0, str(WORKSPACE / "shared"))
from google_api import gmail_list_messages, gmail_get_message  # noqa: E402

OUTPUT_PATH      = WORKSPACE / "mission-control/data/financial-ledger.json"
LEGACY_BILLS     = WORKSPACE / "mission-control/data/accounts-bills.json"
LEGACY_NORM      = WORKSPACE / "mission-control/data/accounts-bills-normalized.json"
LOG_PATH         = WORKSPACE / "logs/financial-scan.log"

# ── Accounts ──────────────────────────────────────────────────────────────────
ACCOUNTS = [
    "cutillo@gmail.com",
    "erincutillo@gmail.com",
    "erinrameyallen@gmail.com",
]

ACCOUNT_OWNERS = {
    "cutillo@gmail.com":        "mike",
    "erincutillo@gmail.com":    "erin",
    "erinrameyallen@gmail.com": "erin",
}

# ── Gmail queries — wide net ──────────────────────────────────────────────────
SCAN_QUERIES = {
    "bills_statements": (
        'subject:(invoice OR receipt OR "payment due" OR "amount due" OR '
        'statement OR autopay OR "auto pay" OR "auto-pay" OR '
        '"your bill" OR "bill is ready" OR "payment reminder")'
    ),
    "vendor_targeted": (
        'from:(chase OR amex OR "american express" OR discover OR '
        'verizon OR xfinity OR comcast OR pseg OR "progressive" OR '
        '"td auto" OR tdautofinance OR navient OR synchrony OR '
        '"bank of america" OR bankofamerica OR citi OR citicards OR '
        'netflix OR spotify OR youtube OR hulu OR apple OR '
        'anthropic OR openai OR njng OR "e-zpass" OR ezpass OR '
        'turbotax OR intuit OR geico OR allstate OR usaa OR '
        '"us bank" OR usbank OR paypal OR "credit karma")'
    ),
    "payment_confirms": (
        'subject:("payment received" OR "payment confirmed" OR '
        '"we received your payment" OR "payment processed" OR '
        '"thanks for your payment" OR "payment was received")'
    ),
    "subscriptions": (
        'subject:(subscription OR membership OR "your plan" OR renewal OR '
        '"has been charged" OR "recurring payment" OR "subscription confirmed" OR '
        '"your receipt")'
    ),
    "transfers": (
        '(from:(paypal OR venmo OR zelle) subject:(sent OR received OR transfer)) OR '
        'subject:("zelle payment" OR "venmo payment")'
    ),
}

# ── Vendor normalization map ──────────────────────────────────────────────────
VENDOR_ALIASES = {
    "no_reply@email.apple.com": "Apple",
    "apple.com":                "Apple",
    "no.reply.alerts@chase.com": "Chase",
    "chase.com":                "Chase",
    "bankofamerica.com":        "Bank of America",
    "ealerts.bankofamerica.com": "Bank of America",
    "billpay.bankofamerica.com": "Bank of America",
    "info6.citi.com":           "Citi",
    "citicards":                "Citi",
    "noreplies@td.com":         "TD Auto Finance",
    "tdautofinance.com":        "TD Auto Finance",
    "verizonwireless.com":      "Verizon Wireless",
    "xfinity.com":              "Xfinity",
    "account.xfinity.com":      "Xfinity",
    "progressive.com":          "Progressive",
    "americanexpress.com":      "American Express",
    "mail.anthropic.com":       "Anthropic",
    "njng.com":                 "NJNG",
    "netflix.com":              "Netflix",
    "spotify.com":              "Spotify",
    "no-reply@youtube.com":     "YouTube",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def make_id(vendor: str, account: str) -> str:
    h = hashlib.md5(f"{vendor}:{account}".encode()).hexdigest()[:8]
    slug = re.sub(r'[^a-z0-9]', '', vendor.lower())[:20]
    return f"fin_{slug}_{h}"


def extract_amounts(text: str) -> list[str]:
    return re.findall(r'\$[\d,]+\.?\d{0,2}', text)


def normalize_vendor(from_addr: str, subject: str) -> str:
    from_lower = from_addr.lower()
    for pattern, name in VENDOR_ALIASES.items():
        if pattern in from_lower:
            return name
    # Extract name from "Name <email>" format
    match = re.match(r'^"?([^"<]+)"?\s*<', from_addr)
    if match:
        name = match.group(1).strip()
        # Clean up common suffixes
        for suffix in [" Card", " Alerts", " Wireless"]:
            if name.endswith(suffix) and len(name) > len(suffix) + 3:
                pass  # keep it, it's informative
        return name
    return from_addr.split("@")[0].replace(".", " ").title()


def get_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key and key.startswith("sk-ant-"):
        return key
    env_path = WORKSPACE / "mission-control/.env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY=") and "sk-ant-" in line:
                return line.split("=", 1)[1].strip()
    return ""


# ── Gmail fetching ────────────────────────────────────────────────────────────

def fetch_all_financial_emails(account: str, days: int) -> list[dict]:
    cutoff = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    time_filter = f"after:{cutoff}"
    seen_ids: set[str] = set()
    emails: list[dict] = []

    for query_name, query in SCAN_QUERIES.items():
        full_q = f"{query} {time_filter}"
        try:
            msgs = gmail_list_messages(account, q=full_q, max_results=200)
            log(f"    {query_name}: {len(msgs)} messages")
        except Exception as e:
            log(f"    {query_name}: ERROR {e}")
            continue

        for m in msgs:
            mid = m["id"]
            if mid in seen_ids:
                continue
            seen_ids.add(mid)
            try:
                full = gmail_get_message(account, mid, fmt="metadata",
                                         headers=["From", "Subject", "Date"])
                hdrs = {h["name"].lower(): h["value"]
                        for h in full.get("payload", {}).get("headers", [])}
                snippet = full.get("snippet", "")
                emails.append({
                    "gmail_id": mid,
                    "account":  account,
                    "from":     hdrs.get("from", ""),
                    "subject":  hdrs.get("subject", "(no subject)"),
                    "date":     hdrs.get("date", ""),
                    "snippet":  snippet,
                    "amounts":  extract_amounts(f"{hdrs.get('subject', '')} {snippet}"),
                })
            except Exception as e:
                log(f"    Could not fetch {mid}: {e}")

        # Rate limit between queries
        time.sleep(0.5)

    log(f"  Total unique: {len(emails)} emails from {account}")
    return emails


# ── Claude classification ─────────────────────────────────────────────────────

CLASSIFY_PROMPT = """You are a financial email classifier for a household ledger.

For each email, extract and return a JSON object with these fields:
- id: the gmail_id from input
- vendor: normalized vendor/company name (e.g. "Chase", "Verizon", not the email address)
- amount: dollar amount as a number (null if not found)
- due_date: YYYY-MM-DD format (null if not found)
- last_paid_date: YYYY-MM-DD if this is a payment confirmation (null otherwise)
- category: one of "recurring_fixed" | "recurring_variable" | "subscription" | "one_time"
  - recurring_fixed: mortgage, auto loan, insurance — amounts rarely change
  - recurring_variable: utilities (gas, electric, water), phone — amounts vary month to month
  - subscription: streaming, software, memberships — fixed recurring digital services
  - one_time: single purchases, transfers, refunds
- sub_category: one of "mortgage" | "auto_loan" | "insurance" | "utility" | "internet" | "phone" | "streaming" | "ai_tools" | "food_delivery" | "groceries" | "shopping" | "transfer" | "credit_card" | "banking" | "toll" | "tax" | "other"
- status: one of "auto_pay" | "due_soon" | "paid" | "overdue" | "pending" | "cancelled" | "unknown"
- owner: who this bill belongs to based on the account — "mike" for cutillo@gmail.com, "erin" for erincutillo/erinrameyallen, "shared" if it appears to be a household bill
- payment_method: "bank_autopay" | "credit_card" | "manual" | "zelle" | "paypal" | "unknown"
- billing_cycle: "monthly" | "quarterly" | "annual" | "one_time" | "unknown"
- confidence: "confirmed" if amounts/dates are clear, "likely" if inferred, "unverified" if uncertain

Return a JSON array. No markdown fences, no explanation — just the array.

Emails to classify:
"""


def classify_batch(emails: list[dict], client: anthropic.Anthropic) -> list[dict]:
    batch_input = []
    for e in emails:
        batch_input.append({
            "gmail_id": e["gmail_id"],
            "account":  e["account"],
            "from":     e["from"],
            "subject":  e["subject"],
            "date":     e["date"],
            "snippet":  e["snippet"][:300],
            "amounts":  e["amounts"],
        })

    prompt = CLASSIFY_PROMPT + json.dumps(batch_input, indent=2)

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as e:
        log(f"  Classification batch failed: {e}")
        return _fallback_classify(emails)


def _fallback_classify(emails: list[dict]) -> list[dict]:
    results = []
    for e in emails:
        vendor = normalize_vendor(e["from"], e["subject"])
        text = (e["subject"] + " " + e["snippet"]).lower()
        amounts = e.get("amounts", [])
        amount = None
        if amounts:
            try:
                amount = float(amounts[0].replace("$", "").replace(",", ""))
            except ValueError:
                pass

        # Guess category
        category = "one_time"
        if any(k in text for k in ["subscription", "renewal", "membership", "your plan"]):
            category = "subscription"
        elif any(k in text for k in ["mortgage", "auto pay", "autopay", "statement", "bill is ready"]):
            category = "recurring_fixed"
        elif any(k in text for k in ["utility", "electric", "gas bill", "water"]):
            category = "recurring_variable"

        status = "unknown"
        if any(k in text for k in ["payment received", "payment confirmed", "we received", "thank"]):
            status = "paid"
        elif any(k in text for k in ["auto pay", "autopay", "scheduled"]):
            status = "auto_pay"
        elif any(k in text for k in ["due", "amount due", "payment due"]):
            status = "due_soon"

        results.append({
            "gmail_id":       e["gmail_id"],
            "vendor":         vendor,
            "amount":         amount,
            "due_date":       None,
            "last_paid_date": None,
            "category":       category,
            "sub_category":   "other",
            "status":         status,
            "owner":          ACCOUNT_OWNERS.get(e["account"], "mike"),
            "payment_method": "unknown",
            "billing_cycle":  "unknown",
            "confidence":     "unverified",
        })
    return results


# ── Ledger builder ────────────────────────────────────────────────────────────

def build_ledger(all_classified: list[dict], email_map: dict, days: int) -> dict:
    """Merge classified emails into vendor-level ledger items."""
    vendors: dict[str, dict] = {}

    for c in all_classified:
        vendor = c.get("vendor", "Unknown")
        raw = email_map.get(c.get("gmail_id", ""), {})
        account = raw.get("account", c.get("account", ""))
        key = f"{vendor}:{account}"

        if key not in vendors:
            vid = make_id(vendor, account)
            vendors[key] = {
                "id":              vid,
                "vendor":          vendor,
                "category":        c.get("category", "one_time"),
                "sub_category":    c.get("sub_category", "other"),
                "owner":           c.get("owner", ACCOUNT_OWNERS.get(account, "mike")),
                "status":          c.get("status", "unknown"),
                "amount":          c.get("amount"),
                "billing_cycle":   c.get("billing_cycle", "unknown"),
                "billing_day":     None,
                "due_date":        c.get("due_date"),
                "last_paid_date":  c.get("last_paid_date"),
                "last_paid_amount": c.get("amount") if c.get("status") == "paid" else None,
                "monthly_estimate": None,
                "payment_method":  c.get("payment_method", "unknown"),
                "confidence":      c.get("confidence", "unverified"),
                "source_accounts": [account],
                "sender_email":    raw.get("from", ""),
                "evidence":        [],
                "receipts":        [],
                "notion_page_id":  None,
                "notes":           "",
                "tags":            [],
                "created_at":      datetime.now(timezone.utc).isoformat(),
                "updated_at":      datetime.now(timezone.utc).isoformat(),
            }
        else:
            item = vendors[key]
            # Update with latest data
            if c.get("amount") and (not item["amount"] or c.get("status") == "paid"):
                item["amount"] = c["amount"]
            if c.get("due_date") and (not item["due_date"] or c["due_date"] > (item["due_date"] or "")):
                item["due_date"] = c["due_date"]
            if c.get("last_paid_date"):
                if not item["last_paid_date"] or c["last_paid_date"] > item["last_paid_date"]:
                    item["last_paid_date"] = c["last_paid_date"]
                    item["last_paid_amount"] = c.get("amount")
            if c.get("status") in ("auto_pay", "paid") and item["status"] == "unknown":
                item["status"] = c["status"]
            if c.get("confidence") == "confirmed":
                item["confidence"] = "confirmed"
            if account not in item["source_accounts"]:
                item["source_accounts"].append(account)

        # Add evidence
        evidence = {
            "gmail_id": c.get("gmail_id", ""),
            "account":  account,
            "subject":  raw.get("subject", ""),
            "date":     raw.get("date", ""),
            "amounts_found": raw.get("amounts", []),
            "snippet":  raw.get("snippet", "")[:200],
        }
        vendors[key]["evidence"].append(evidence)

        # Add email-type receipt
        receipt = {
            "id":              f"rcpt_{c.get('gmail_id', '')[:12]}",
            "type":            "email",
            "source_platform": "gmail",
            "gmail_id":        c.get("gmail_id", ""),
            "drive_file_id":   None,
            "onedrive_item_id": None,
            "file_path":       None,
            "image_url":       None,
            "thumbnail_url":   None,
            "original_filename": None,
            "mime_type":       None,
            "captured_at":     raw.get("date", ""),
            "ocr_text":        None,
            "matched_vendor":  vendor,
            "matched_amount":  c.get("amount"),
            "match_confidence": "high" if c.get("confidence") == "confirmed" else "medium",
        }
        vendors[key]["receipts"].append(receipt)

    # Post-process: calculate monthly estimates, billing days
    items = list(vendors.values())
    for item in items:
        # Calculate monthly estimate from evidence
        amounts = [e.get("matched_amount") for r in [item] for e in item["evidence"]
                   if isinstance(e, dict)]
        paid_amounts = [r["matched_amount"] for r in item["receipts"]
                        if r.get("matched_amount")]
        if paid_amounts:
            item["monthly_estimate"] = round(sum(paid_amounts) / max(len(paid_amounts), 1), 2)
        elif item["amount"]:
            item["monthly_estimate"] = item["amount"]

        # Extract billing day from due_date
        if item.get("due_date"):
            try:
                item["billing_day"] = int(item["due_date"].split("-")[2])
            except (IndexError, ValueError):
                pass

    # Build summary
    summary = {
        "total_items": len(items),
        "confirmed_monthly": 0.0,
        "likely_monthly": 0.0,
        "by_category": {},
        "by_owner": {},
    }

    for item in items:
        cat = item["category"]
        owner = item["owner"]
        est = item.get("monthly_estimate") or 0

        if cat not in summary["by_category"]:
            summary["by_category"][cat] = {"count": 0, "monthly_total": 0.0}
        summary["by_category"][cat]["count"] += 1
        summary["by_category"][cat]["monthly_total"] += est

        if owner not in summary["by_owner"]:
            summary["by_owner"][owner] = {"count": 0, "monthly_total": 0.0}
        summary["by_owner"][owner]["count"] += 1
        summary["by_owner"][owner]["monthly_total"] += est

        if item["confidence"] == "confirmed":
            summary["confirmed_monthly"] += est
        else:
            summary["likely_monthly"] += est

    # Round totals
    summary["confirmed_monthly"] = round(summary["confirmed_monthly"], 2)
    summary["likely_monthly"] = round(summary["likely_monthly"], 2)
    for v in summary["by_category"].values():
        v["monthly_total"] = round(v["monthly_total"], 2)
    for v in summary["by_owner"].values():
        v["monthly_total"] = round(v["monthly_total"], 2)

    return {
        "version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scan_window_days": days,
        "scan_accounts": ACCOUNTS,
        "summary": summary,
        "items": sorted(items, key=lambda x: (
            {"recurring_fixed": 0, "recurring_variable": 1, "subscription": 2, "one_time": 3}.get(x["category"], 4),
            -(x.get("monthly_estimate") or 0),
        )),
    }


# ── Legacy format writers ─────────────────────────────────────────────────────

def write_legacy_formats(ledger: dict):
    """Regenerate accounts-bills.json and accounts-bills-normalized.json."""
    # accounts-bills.json format
    by_account: dict[str, list] = {}
    for item in ledger["items"]:
        for acct in item["source_accounts"]:
            if acct not in by_account:
                by_account[acct] = []
            by_account[acct].append({
                "vendor": item["vendor"],
                "sender": item["sender_email"],
                "account": acct,
                "entries": [
                    {
                        "subject": e["subject"],
                        "date": e["date"],
                        "prices": e["amounts_found"],
                        "snippet": e["snippet"],
                        "purchase_items": [],
                    }
                    for e in item["evidence"]
                    if e.get("account") == acct
                ],
            })

    legacy = {
        "generated_at": ledger["generated_at"],
        "window_days": ledger["scan_window_days"],
        "subscriptions": by_account,
    }
    LEGACY_BILLS.write_text(json.dumps(legacy, indent=2))
    log(f"Legacy bills written to {LEGACY_BILLS}")

    # accounts-bills-normalized.json format
    norm: dict[str, dict] = {}
    for item in ledger["items"]:
        for acct in item["source_accounts"]:
            if acct not in norm:
                norm[acct] = {"recurring": [], "likely_recurring": [], "one_off": []}
            entry = {
                "vendor": item["vendor"],
                "sender": item["sender_email"],
                "account": acct,
                "entries": [
                    {
                        "subject": e["subject"],
                        "date": e["date"],
                        "prices": e["amounts_found"],
                        "snippet": e["snippet"],
                        "purchase_items": [],
                    }
                    for e in item["evidence"]
                    if e.get("account") == acct
                ],
                "vendor_normalized": item["vendor"],
                "kind": "recurring" if item["category"] in ("recurring_fixed", "recurring_variable", "subscription") else "one_off",
                "ownerTag": item["owner"],
                "confirmedRecurring": item["confidence"] == "confirmed" and item["category"] != "one_time",
                "monthlyEstimate": f"${item['monthly_estimate']:.2f}" if item.get("monthly_estimate") else None,
            }
            if item["category"] in ("recurring_fixed", "subscription"):
                norm[acct]["recurring"].append(entry)
            elif item["category"] == "recurring_variable":
                norm[acct]["likely_recurring"].append(entry)
            else:
                norm[acct]["one_off"].append(entry)

    norm_out = {
        "generated_at": ledger["generated_at"],
        "window_days": ledger["scan_window_days"],
        "accounts": norm,
    }
    LEGACY_NORM.write_text(json.dumps(norm_out, indent=2))
    log(f"Legacy normalized written to {LEGACY_NORM}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Household Financial Ledger Scanner")
    parser.add_argument("--days", type=int, default=90, help="Days to scan back (default: 90)")
    parser.add_argument("--accounts", default="all", help="Comma-separated accounts or 'all'")
    parser.add_argument("--dry-run", action="store_true", help="Scan and classify but don't write")
    parser.add_argument("--merge", action="store_true", help="Merge with existing ledger")
    args = parser.parse_args()

    accounts = ACCOUNTS if args.accounts == "all" else args.accounts.split(",")

    log("=" * 60)
    log(f"Financial scan: {args.days} days, accounts: {accounts}")

    # 1. Fetch emails from all accounts
    all_emails: list[dict] = []
    for account in accounts:
        log(f"Fetching from {account}...")
        try:
            emails = fetch_all_financial_emails(account, args.days)
            all_emails.extend(emails)
        except Exception as e:
            log(f"  FAILED: {e}")
        time.sleep(1)  # Rate limit between accounts

    log(f"Total emails to classify: {len(all_emails)}")

    if not all_emails:
        log("No emails found. Exiting.")
        return

    # 2. Classify with Claude
    api_key = get_api_key()
    if api_key:
        client = anthropic.Anthropic(api_key=api_key)
        log("Classifying with Claude Haiku...")
        all_classified: list[dict] = []
        batch_size = 20
        for i in range(0, len(all_emails), batch_size):
            batch = all_emails[i:i + batch_size]
            log(f"  Batch {i // batch_size + 1}/{(len(all_emails) + batch_size - 1) // batch_size} ({len(batch)} emails)")
            classified = classify_batch(batch, client)
            all_classified.extend(classified)
            time.sleep(1)  # Rate limit between batches
    else:
        log("No Anthropic API key — using fallback classification")
        all_classified = _fallback_classify(all_emails)

    log(f"Classified: {len(all_classified)} items")

    # 3. Build email lookup map
    email_map = {e["gmail_id"]: e for e in all_emails}

    # 4. Build ledger
    ledger = build_ledger(all_classified, email_map, args.days)

    # 5. Merge with existing if requested
    if args.merge and OUTPUT_PATH.exists():
        try:
            existing = json.loads(OUTPUT_PATH.read_text())
            existing_ids = {item["id"] for item in existing.get("items", [])}
            new_items = [item for item in ledger["items"] if item["id"] not in existing_ids]
            existing["items"].extend(new_items)
            existing["generated_at"] = ledger["generated_at"]
            existing["summary"] = ledger["summary"]
            ledger = existing
            log(f"Merged {len(new_items)} new items with existing ledger")
        except Exception as e:
            log(f"Merge failed, writing fresh: {e}")

    # 6. Write output
    if args.dry_run:
        log("DRY RUN — not writing files")
        log(f"Would write {len(ledger['items'])} items to {OUTPUT_PATH}")
        print(json.dumps(ledger["summary"], indent=2))
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps(ledger, indent=2))
        log(f"Ledger written to {OUTPUT_PATH} ({len(ledger['items'])} items)")

        # Write legacy formats
        write_legacy_formats(ledger)

    log("Financial scan complete.")
    log(f"Summary: {json.dumps(ledger['summary'], indent=2)}")


if __name__ == "__main__":
    main()
