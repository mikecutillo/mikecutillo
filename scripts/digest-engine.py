#!/usr/bin/env python3
"""
digest-engine.py — Household Email Digest Pipeline

Fetches emails from Mike + Erin's Gmail accounts, classifies them via Claude,
writes structured JSON to mission-control/data/email-digest.json, and
optionally delivers to Slack and/or sends a summary email.

Config (edit these freely — no other code changes needed):
"""

import base64
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from pathlib import Path

import anthropic

# ── Paths ─────────────────────────────────────────────────────────────────────
WORKSPACE = Path("/Users/mikecutillo/.openclaw/workspace-shared")
sys.path.insert(0, str(WORKSPACE / "shared"))
from google_api import gmail_list_messages, gmail_get_message, gmail_service  # noqa: E402

OUTPUT_PATH = WORKSPACE / "mission-control/data/email-digest.json"
LOG_PATH    = WORKSPACE / "logs/digest.log"

# ── User-editable config ───────────────────────────────────────────────────────

ACCOUNTS = [
    "cutillo@gmail.com",
    "erincutillo@gmail.com",
    "erinrameyallen@gmail.com",
]

ACCOUNT_LABELS = {
    "cutillo@gmail.com":        "Mike",
    "erincutillo@gmail.com":    "Erin",
    "erinrameyallen@gmail.com": "Erin",
}

LOOKBACK_HOURS = 24
MAX_EMAILS_PER_ACCOUNT = 50

# Gmail search queries per category (Gmail search syntax — edit freely)
CATEGORY_QUERIES = {
    "action_items": "is:unread -category:promotions -category:social -category:updates",
    "bills":        "(subject:(invoice OR receipt OR renewal OR bill OR payment OR \"amount due\" OR \"payment due\" OR \"your statement\") OR from:(chase OR bankofamerica OR verizon OR comcast OR pseg OR amex OR discover OR synchrony OR navient OR salliemae OR \"american express\"))",
    "family":       "(from:(school OR holmdel OR liam OR clara OR nurse OR principal OR teacher) OR subject:(liam OR clara OR school OR pickup OR dismissal OR appointment))",
    "financial":    "(subject:(\"payment due\" OR \"amount due\" OR \"statement ready\" OR \"your bill\" OR \"invoice\" OR \"payment received\" OR \"payment confirmed\" OR \"direct deposit\" OR \"paycheck\" OR \"refund\") OR from:(paypal OR venmo OR zelle OR chase OR bankofamerica OR amex OR discover))",
}

# Financial keywords for extraction
FINANCIAL_KEYWORDS = [
    "amount due", "payment due", "invoice", "receipt", "bill", "statement",
    "payment received", "payment confirmed", "direct deposit", "paycheck",
    "refund", "credit", "charge", "subscription", "renewal"
]

DISCORD_WEBHOOK = os.environ.get("DISCORD_DIGEST_WEBHOOK", "")
DIGEST_EMAIL_TO = os.environ.get("DIGEST_EMAIL_TO", "cutillo@gmail.com")

# Channel-specific Discord webhooks (Cutillo HQ server)
DISCORD_CHANNELS = {
    "bills":       os.environ.get("DISCORD_WH_BILLS", ""),
    "cash-flow":   os.environ.get("DISCORD_WH_CASH_FLOW", ""),
    "school":      os.environ.get("DISCORD_WH_SCHOOL", ""),
    "announce":    os.environ.get("DISCORD_WH_ANNOUNCEMENTS", ""),
    "misc":        os.environ.get("DISCORD_WH_MISC", ""),
}
ANTHROPIC_API_KEY = os.environ.get("OPENAI_API_KEY", "")  # falls back gracefully

# ── Helpers ────────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def get_lookback_query() -> str:
    """Return Gmail 'after:' filter for the configured lookback window."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    epoch  = int(cutoff.timestamp())
    return f"after:{epoch}"


def decode_body(payload: dict) -> str:
    """Extract plain-text body from a Gmail message payload."""
    mime_type = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if mime_type == "text/plain" and body_data:
        return base64.urlsafe_b64decode(body_data).decode("utf-8", errors="replace")

    if mime_type.startswith("multipart/"):
        for part in payload.get("parts", []):
            text = decode_body(part)
            if text:
                return text

    return ""


def extract_headers(msg: dict) -> dict:
    headers = {h["name"].lower(): h["value"]
               for h in msg.get("payload", {}).get("headers", [])}
    return {
        "from":    headers.get("from", ""),
        "to":      headers.get("to", ""),
        "subject": headers.get("subject", "(no subject)"),
        "date":    headers.get("date", ""),
    }


def fetch_emails_for_account(email: str, lookback_q: str) -> list[dict]:
    """Fetch up to MAX_EMAILS_PER_ACCOUNT emails across all categories for one account."""
    seen_ids: set[str] = set()
    emails: list[dict] = []

    # Fetch from each category query
    for cat, q in CATEGORY_QUERIES.items():
        full_q = f"{q} {lookback_q}"
        try:
            msgs = gmail_list_messages(email, q=full_q, max_results=20)
        except Exception as e:
            log(f"  ⚠ Query '{cat}' failed for {email}: {e}")
            continue

        for m in msgs:
            mid = m["id"]
            if mid in seen_ids:
                continue
            seen_ids.add(mid)
            try:
                full = gmail_get_message(email, mid, fmt="full")
                hdrs = extract_headers(full)
                body = decode_body(full.get("payload", {}))
                emails.append({
                    "id":      mid,
                    "account": email,
                    "from":    hdrs["from"],
                    "subject": hdrs["subject"],
                    "date":    hdrs["date"],
                    "snippet": full.get("snippet", ""),
                    "body":    body[:2000],          # cap at 2k chars for Claude
                    "hint_category": cat,
                })
            except Exception as e:
                log(f"  ⚠ Could not fetch message {mid}: {e}")

        if len(emails) >= MAX_EMAILS_PER_ACCOUNT:
            break

    return emails[:MAX_EMAILS_PER_ACCOUNT]


# ── Claude classification ──────────────────────────────────────────────────────

CLASSIFY_PROMPT = """You are an email classifier for a household digest system.

Classify each email and extract financial data when present.

For EACH email, return a JSON object with:
- id: the message id (from input)
- categories: list of 1-3 categories from: ["action_items", "bills", "family", "digest", "financial"]
  - action_items: needs a reply or follow-up action
  - bills: invoice, receipt, payment reminder, subscription renewal
  - family: school, kids, appointments, household coordination
  - financial: money movement — deposits, paychecks, refunds, charges, bank alerts
  - digest: general info / FYI only
- summary: 1 concise sentence describing what the email is about
- urgency: "high" | "medium" | "low"
- financial: null OR { payee, amount (number or null), due_date (YYYY-MM-DD or null), type ("bill_due"|"payment_received"|"income"|"charge"|"refund") }

Return a JSON array. No markdown, no explanation — just the array.

Emails to classify:
"""


def classify_emails(emails: list[dict]) -> list[dict]:
    if not emails:
        return []

    # Try to get API key from env
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    # Check if it's an Anthropic key
    if not api_key or not api_key.startswith("sk-ant-"):
        # Try to read from .env.local
        env_path = WORKSPACE / "mission-control/.env.local"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    api_key = line.split("=", 1)[1].strip()
                    break

    if not api_key or not api_key.startswith("sk-ant-"):
        log("⚠ No Anthropic API key found — using snippet-only classification")
        return _fallback_classify(emails)

    client = anthropic.Anthropic(api_key=api_key)

    # Build input for Claude — keep it lean
    batch_input = []
    for e in emails:
        batch_input.append({
            "id":      e["id"],
            "from":    e["from"],
            "subject": e["subject"],
            "snippet": e["snippet"],
            "body":    e["body"][:800],
            "hint":    e.get("hint_category", ""),
        })

    prompt = CLASSIFY_PROMPT + json.dumps(batch_input, indent=2)

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        # Strip any accidental markdown fences
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as e:
        log(f"⚠ Claude classification failed: {e}")
        return _fallback_classify(emails)


def _fallback_classify(emails: list[dict]) -> list[dict]:
    """Simple keyword fallback when Claude is unavailable."""
    results = []
    for e in emails:
        cats = [e.get("hint_category", "digest")]
        text = (e["subject"] + " " + e["snippet"]).lower()
        if any(k in text for k in ["due", "invoice", "receipt", "payment", "bill"]):
            if "bills" not in cats:
                cats.append("bills")
        if any(k in text for k in ["school", "liam", "clara", "pickup", "nurse"]):
            if "family" not in cats:
                cats.append("family")
        results.append({
            "id": e["id"],
            "categories": cats,
            "summary": e["snippet"][:120],
            "urgency": "medium",
            "financial": None,
        })
    return results


# ── Financial summary builder ──────────────────────────────────────────────────

def build_financials(classified: list[dict], email_map: dict[str, dict]) -> dict:
    bills_due: list[dict] = []
    recent_charges: list[dict] = []
    income: list[dict] = []
    total_in = 0.0
    total_out = 0.0
    due_soon = 0.0
    today = datetime.now(timezone.utc).date()

    for c in classified:
        fin = c.get("financial")
        if not fin:
            continue
        raw = email_map.get(c["id"], {})
        entry = {
            "payee":   fin.get("payee", "Unknown"),
            "amount":  fin.get("amount"),
            "due_date":fin.get("due_date"),
            "type":    fin.get("type", "charge"),
            "account": raw.get("account", ""),
            "subject": raw.get("subject", ""),
            "summary": c.get("summary", ""),
        }
        ftype = fin.get("type", "charge")
        amt   = fin.get("amount") or 0

        if ftype == "bill_due":
            # Check urgency
            paid = False
            urgency = "normal"
            if fin.get("due_date"):
                try:
                    due = datetime.strptime(fin["due_date"], "%Y-%m-%d").date()
                    days = (due - today).days
                    if days < 0:
                        urgency = "overdue"
                    elif days <= 3:
                        urgency = "urgent"
                    elif days <= 7:
                        urgency = "soon"
                except Exception:
                    pass
            entry["urgency"] = urgency
            entry["paid"] = paid
            bills_due.append(entry)
            total_out += amt
            if urgency in ("overdue", "urgent", "soon"):
                due_soon += amt

        elif ftype in ("charge", "refund"):
            if ftype == "refund":
                total_in += amt
                income.append({**entry, "direction": "in"})
            else:
                total_out += amt
                recent_charges.append(entry)

        elif ftype in ("income", "payment_received"):
            total_in += amt
            income.append({**entry, "direction": "in"})

    # Sort bills by urgency
    urgency_order = {"overdue": 0, "urgent": 1, "soon": 2, "normal": 3}
    bills_due.sort(key=lambda x: urgency_order.get(x.get("urgency", "normal"), 3))

    return {
        "bills_due":       bills_due,
        "recent_charges":  recent_charges,
        "income":          income,
        "month_summary": {
            "in":       round(total_in, 2),
            "out":      round(total_out, 2),
            "due_soon": round(due_soon, 2),
        },
    }


# ── Delivery: Discord ─────────────────────────────────────────────────────────

def _send_webhook(url: str, payload: dict, label: str = ""):
    """Send a single webhook payload. Returns True on success."""
    import urllib.request
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data,
                                headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
        if label:
            log(f"  ✓ Discord → #{label}")
        return True
    except Exception as e:
        if label:
            log(f"  ⚠ Discord → #{label} failed: {e}")
        return False


def post_to_discord(data: dict):
    """Dispatch digest data to channel-specific webhooks + combined digest."""
    import urllib.request

    has_any = DISCORD_WEBHOOK or any(DISCORD_CHANNELS.values())
    if not has_any:
        log("Discord webhooks not configured — skipping")
        return

    cats = data["categories"]
    fin  = data.get("financials", {})
    ms   = fin.get("month_summary", {})
    bills = fin.get("bills_due", [])
    date_str = data["generated_at"][:10]
    sent = 0

    # ── Channel: #bills-due ──
    if bills and DISCORD_CHANNELS.get("bills"):
        bill_lines = "\n".join(
            f"• **{b['payee']}** ${b.get('amount') or '?'} — due {b.get('due_date','?')} [{b.get('urgency','').upper()}]"
            for b in bills[:8]
        )
        _send_webhook(DISCORD_CHANNELS["bills"], {"embeds": [{
            "title": f"Bills Due — {date_str}",
            "color": 0xF5A623,
            "description": bill_lines,
            "footer": {"text": "Mission Control — Financial Ledger"},
        }]}, "bills-due")
        sent += 1

    # ── Channel: #cash-flow ──
    if (ms.get("in", 0) > 0 or ms.get("out", 0) > 0) and DISCORD_CHANNELS.get("cash-flow"):
        _send_webhook(DISCORD_CHANNELS["cash-flow"], {"embeds": [{
            "title": f"Cash Flow — {date_str}",
            "color": 0xF5A623,
            "fields": [
                {"name": "Income", "value": f"${ms.get('in',0):.0f}", "inline": True},
                {"name": "Expenses", "value": f"${ms.get('out',0):.0f}", "inline": True},
                {"name": "Due Soon", "value": f"${ms.get('due_soon',0):.0f}", "inline": True},
            ],
            "footer": {"text": "Mission Control — Financial Ledger"},
        }]}, "cash-flow")
        sent += 1

    # ── Channel: #school ──
    family_items = cats.get("family", [])[:5]
    if family_items and DISCORD_CHANNELS.get("school"):
        lines = "\n".join(
            f"• [{i['account_label']}] **{i['subject']}**\n  {i['summary']}"
            for i in family_items
        )
        _send_webhook(DISCORD_CHANNELS["school"], {"embeds": [{
            "title": f"School & Family — {date_str}",
            "color": 0x26C26E,
            "description": lines,
            "footer": {"text": "Mission Control — Email Digest"},
        }]}, "school")
        sent += 1

    # ── Channel: #announcements (high-urgency action items only) ──
    action_items = cats.get("action_items", [])[:3]
    urgent = [a for a in action_items if a.get("urgency") in ("high", "critical")]
    if urgent and DISCORD_CHANNELS.get("announce"):
        lines = "\n".join(
            f"• [{i['account_label']}] **{i['subject']}** — {i['summary']}"
            for i in urgent
        )
        _send_webhook(DISCORD_CHANNELS["announce"], {"embeds": [{
            "title": f"Action Required — {date_str}",
            "color": 0xE05C5C,
            "description": lines,
            "footer": {"text": "Mission Control — Urgent"},
        }]}, "announcements")
        sent += 1

    # ── Channel: #misc-updates (uncategorized digest items) ──
    digest_items = cats.get("digest", [])[:5]
    if digest_items and DISCORD_CHANNELS.get("misc"):
        lines = "\n".join(
            f"• [{i['account_label']}] **{i['subject']}** — {i['summary']}"
            for i in digest_items
        )
        _send_webhook(DISCORD_CHANNELS["misc"], {"embeds": [{
            "title": f"Misc Updates — {date_str}",
            "color": 0x7C8CFF,
            "description": lines,
            "footer": {"text": "Mission Control — Email Digest"},
        }]}, "misc-updates")
        sent += 1

    # ── Combined digest → #financial-digest (original behavior) ──
    if DISCORD_WEBHOOK:
        fields = []
        if ms.get("due_soon", 0) > 0 or ms.get("out", 0) > 0:
            fields.append({
                "name":   "Cash Flow",
                "value":  f"In: **${ms.get('in',0):.0f}** | Out: **${ms.get('out',0):.0f}** | Due Soon: **${ms.get('due_soon',0):.0f}**",
                "inline": False,
            })
        if bills:
            bill_lines = "\n".join(
                f"• **{b['payee']}** ${b.get('amount') or '?'} — due {b.get('due_date','?')} [{b.get('urgency','').upper()}]"
                for b in bills[:5]
            )
            fields.append({"name": "Bills Due", "value": bill_lines, "inline": False})
        for cat, label, emoji in [
            ("action_items", "Action Items", ""),
            ("family",       "Family",       ""),
        ]:
            items = cats.get(cat, [])[:3]
            if items:
                lines = "\n".join(f"• [{i['account_label']}] **{i['subject']}** — {i['summary']}" for i in items)
                fields.append({"name": label, "value": lines, "inline": False})

        _send_webhook(DISCORD_WEBHOOK, {"embeds": [{
            "title":  f"Household Email Digest — {date_str}",
            "color":  0x5E6AD2,
            "fields": fields,
            "footer": {"text": f"{data['stats']['total_fetched']} emails scanned · Mission Control"},
        }]}, "financial-digest")
        sent += 1

    log(f"✓ Discord delivery complete ({sent} channels)")


# ── Delivery: Gmail summary email ──────────────────────────────────────────────

def send_summary_email(data: dict):
    if not DIGEST_EMAIL_TO:
        return
    import email.mime.text as mt
    import base64

    cats = data["categories"]
    fin  = data.get("financials", {})
    ms   = fin.get("month_summary", {})
    bills = fin.get("bills_due", [])

    lines = [
        f"<h2>Household Email Digest — {data['generated_at'][:10]}</h2>",
        f"<p>📊 ↑ In: <b>${ms.get('in',0):.0f}</b> &nbsp;|&nbsp; "
        f"↓ Out: <b>${ms.get('out',0):.0f}</b> &nbsp;|&nbsp; "
        f"⚠ Due Soon: <b>${ms.get('due_soon',0):.0f}</b></p>",
    ]

    if bills:
        lines.append("<h3>Bills Due</h3><ul>")
        for b in bills[:5]:
            color = {"overdue": "#ef4444", "urgent": "#f59e0b", "soon": "#f59e0b"}.get(b.get("urgency",""), "#6b7280")
            lines.append(f'<li><span style="color:{color}">[{b.get("urgency","").upper() or "UPCOMING"}]</span> '
                         f'<b>{b["payee"]}</b> — ${b.get("amount") or "?"} due {b.get("due_date","?")} ({b["account"]})</li>')
        lines.append("</ul>")

    for cat, label, emoji in [
        ("action_items", "Action Items", "🔴"),
        ("family",       "Family",       "🏠"),
        ("digest",       "General",      "📬"),
    ]:
        items = cats.get(cat, [])[:5]
        if items:
            lines.append(f"<h3>{emoji} {label}</h3><ul>")
            for item in items:
                urg = {"high": "🔴 ", "medium": "🟡 ", "low": ""}.get(item.get("urgency",""), "")
                lines.append(f"<li>{urg}<b>[{item['account_label']}]</b> {item['subject']}<br>"
                             f"<small>{item['summary']}</small></li>")
            lines.append("</ul>")

    html = "\n".join(lines)
    msg  = mt.MIMEText(html, "html")
    msg["Subject"] = f"Household Digest — {data['generated_at'][:10]}"
    msg["From"]    = "cutillo@gmail.com"
    msg["To"]      = DIGEST_EMAIL_TO

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        svc = gmail_service("cutillo@gmail.com")
        svc.users().messages().send(userId="me", body={"raw": raw}).execute()
        log(f"✓ Summary email sent to {DIGEST_EMAIL_TO}")
    except Exception as e:
        log(f"⚠ Email delivery failed: {e}")


# ── Main pipeline ──────────────────────────────────────────────────────────────

def run():
    log("=" * 60)
    log("Starting household email digest")
    lookback_q = get_lookback_query()

    # 1. Fetch emails from all accounts
    all_emails: list[dict] = []
    for account in ACCOUNTS:
        log(f"Fetching from {account}...")
        try:
            emails = fetch_emails_for_account(account, lookback_q)
            log(f"  → {len(emails)} emails fetched")
            all_emails.extend(emails)
        except Exception as e:
            log(f"  ⚠ Failed to fetch from {account}: {e}")

    log(f"Total emails to classify: {len(all_emails)}")

    # 2. Classify with Claude
    log("Classifying with Claude...")
    classified = classify_emails(all_emails)
    log(f"  → {len(classified)} emails classified")

    # Build lookup map: id → raw email
    email_map = {e["id"]: e for e in all_emails}

    # 3. Bucket into categories
    buckets: dict[str, list] = {
        "action_items": [],
        "bills":        [],
        "family":       [],
        "financial":    [],
        "digest":       [],
    }

    for c in classified:
        raw  = email_map.get(c["id"], {})
        acct = raw.get("account", "")
        item = {
            "id":            c["id"],
            "account":       acct,
            "account_label": ACCOUNT_LABELS.get(acct, acct),
            "from":          raw.get("from", ""),
            "subject":       raw.get("subject", ""),
            "date":          raw.get("date", ""),
            "summary":       c.get("summary", raw.get("snippet", "")),
            "urgency":       c.get("urgency", "medium"),
            "categories":    c.get("categories", []),
            "financial":     c.get("financial"),
        }
        placed = False
        for cat in ["action_items", "bills", "family", "financial"]:
            if cat in c.get("categories", []):
                buckets[cat].append(item)
                placed = True
                break
        if not placed:
            buckets["digest"].append(item)

    # 4. Build financials summary
    financials = build_financials(classified, email_map)

    # 5. Assemble output
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "lookback_hours": LOOKBACK_HOURS,
        "accounts": ACCOUNTS,
        "stats": {
            "total_fetched":    len(all_emails),
            "total_classified": len(classified),
        },
        "financials": financials,
        "categories": buckets,
    }

    # 6. Write JSON
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    log(f"✓ Digest written to {OUTPUT_PATH}")

    # 7. Deliver
    post_to_discord(output)
    send_summary_email(output)

    log("Digest complete.")
    return output


if __name__ == "__main__":
    run()
