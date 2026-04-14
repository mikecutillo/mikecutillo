#!/usr/bin/env python3
"""
notion-sync.py — Sync Mission Control data to Notion

Syncs any of the following data sources to Notion databases:
  - financial-ledger  (default — Household Financial Ledger)
  - job-pipeline      (Job Hunt Pipeline)
  - news-intel        (News & Intel Briefs)
  - content-hub       (Content Hub Posts)
  - subscriptions     (Cloud Subscriptions)

Usage:
    python3 scripts/notion-sync.py                         # financial-ledger (default)
    python3 scripts/notion-sync.py --source job-pipeline
    python3 scripts/notion-sync.py --source all

Setup:
    1. Create a Notion integration at https://www.notion.so/my-integrations
    2. Create a page in Notion called "TurboDot Hub" (or any name)
    3. Share that page with your integration (click ••• → Connections → your integration)
    4. Copy the page ID from the URL and set NOTION_PARENT_PAGE_ID in .env.local
       The page ID is the 32-char hex string at the end of the page URL.
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

WORKSPACE = Path("/Users/mikecutillo/.openclaw/workspace-shared")
MC_DATA = WORKSPACE / "mission-control/data"
LOG_PATH = WORKSPACE / "logs/notion-sync.log"

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

ALL_SOURCES = ["financial-ledger", "job-pipeline", "news-intel", "content-hub", "subscriptions"]


# ── Logging ──────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


# ── Auth ─────────────────────────────────────────────────────────────────────

def get_env(key: str) -> str:
    """Read an env var, falling back to .env.local."""
    val = os.environ.get(key, "")
    if val:
        return val
    env_path = WORKSPACE / "mission-control/.env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    return ""


def get_api_key() -> str:
    key = get_env("NOTION_API_KEY")
    if key:
        return key
    # Fallback: check Claude settings for MCP integration
    settings = Path.home() / ".claude/settings.json"
    if settings.exists():
        data = json.loads(settings.read_text())
        notion_cfg = data.get("mcpServers", {}).get("notion", {})
        headers_str = notion_cfg.get("env", {}).get("OPENAPI_MCP_HEADERS", "")
        if headers_str:
            try:
                hdrs = json.loads(headers_str)
                bearer = hdrs.get("Authorization", "")
                if bearer.startswith("Bearer "):
                    return bearer[7:]
            except json.JSONDecodeError:
                pass
    return ""


def hdrs(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


# ── Database Discovery / Creation ────────────────────────────────────────────

def find_database(api_key: str, title: str) -> str | None:
    """Search for existing database by title."""
    resp = requests.post(
        f"{NOTION_API}/search",
        headers=hdrs(api_key),
        json={"query": title, "filter": {"value": "database", "property": "object"}},
    )
    if resp.status_code != 200:
        log(f"Search failed: {resp.status_code} {resp.text[:200]}")
        return None
    for result in resp.json().get("results", []):
        db_title = "".join(t.get("plain_text", "") for t in result.get("title", []))
        if db_title == title:
            return result["id"]
    return None


def get_parent_page_id(api_key: str) -> str:
    """Get the parent page ID for creating databases."""
    # 1. Check env var
    pid = get_env("NOTION_PARENT_PAGE_ID")
    if pid:
        # Clean up — accept URLs or raw IDs
        pid = pid.strip().split("/")[-1].split("?")[0].split("-")[-1]
        if len(pid) == 32:
            pid = f"{pid[:8]}-{pid[8:12]}-{pid[12:16]}-{pid[16:20]}-{pid[20:]}"
        return pid

    # 2. Try to find an existing "TurboDot Hub" page
    resp = requests.post(
        f"{NOTION_API}/search",
        headers=hdrs(api_key),
        json={"query": "TurboDot Hub", "filter": {"value": "page", "property": "object"}},
    )
    if resp.status_code == 200:
        for result in resp.json().get("results", []):
            title = "".join(t.get("plain_text", "") for t in result.get("properties", {}).get("title", {}).get("title", []))
            if "turbodot" in title.lower():
                pid = result["id"]
                log(f"Found existing TurboDot Hub page: {pid}")
                return pid

    # 3. Not found — give clear instructions
    raise RuntimeError(
        "NOTION_PARENT_PAGE_ID not set. To fix:\n"
        "  1. Create a page in Notion (e.g. 'TurboDot Hub')\n"
        "  2. Share it with your integration (••• → Connections)\n"
        "  3. Copy the page ID from the URL\n"
        "  4. Add to .env.local: NOTION_PARENT_PAGE_ID=<your-page-id>"
    )


def create_database(api_key: str, parent_page_id: str, title: str, properties: dict) -> str:
    """Create a Notion database under the given parent page."""
    resp = requests.post(
        f"{NOTION_API}/databases",
        headers=hdrs(api_key),
        json={
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"text": {"content": title}}],
            "properties": properties,
        },
    )
    if resp.status_code != 200:
        log(f"Failed to create database '{title}': {resp.status_code} {resp.text[:300]}")
        raise RuntimeError(f"Notion database creation failed: {resp.text[:200]}")
    db_id = resp.json()["id"]
    log(f"Created database '{title}': {db_id}")
    return db_id


# ── Generic Upsert ───────────────────────────────────────────────────────────

def find_page_by_id_field(api_key: str, db_id: str, field_name: str, field_value: str) -> str | None:
    resp = requests.post(
        f"{NOTION_API}/databases/{db_id}/query",
        headers=hdrs(api_key),
        json={"filter": {"property": field_name, "rich_text": {"equals": field_value}}},
    )
    if resp.status_code == 200:
        results = resp.json().get("results", [])
        if results:
            return results[0]["id"]
    return None


def upsert_page(api_key: str, db_id: str, props: dict,
                id_field: str, id_value: str, existing_notion_id: str | None = None) -> str:
    """Create or update a Notion page. Returns page ID."""
    existing = existing_notion_id or find_page_by_id_field(api_key, db_id, id_field, id_value)
    if existing:
        resp = requests.patch(
            f"{NOTION_API}/pages/{existing}",
            headers=hdrs(api_key),
            json={"properties": props},
        )
        if resp.status_code == 200:
            return existing
        log(f"  Update failed ({id_value}): {resp.status_code}")
    # Create new
    resp = requests.post(
        f"{NOTION_API}/pages",
        headers=hdrs(api_key),
        json={"parent": {"database_id": db_id}, "properties": props},
    )
    if resp.status_code == 200:
        return resp.json()["id"]
    log(f"  Create failed ({id_value}): {resp.status_code} {resp.text[:200]}")
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# SOURCE: Financial Ledger
# ══════════════════════════════════════════════════════════════════════════════

FINANCIAL_LEDGER_SCHEMA = {
    "Vendor":         {"title": {}},
    "Amount":         {"number": {"format": "dollar"}},
    "Category":       {"select": {"options": [
        {"name": "recurring_fixed", "color": "red"},
        {"name": "recurring_variable", "color": "orange"},
        {"name": "subscription", "color": "blue"},
        {"name": "one_time", "color": "gray"},
    ]}},
    "Sub-Category":   {"select": {"options": [
        {"name": "mortgage"}, {"name": "auto_loan"}, {"name": "insurance"},
        {"name": "utility"}, {"name": "internet"}, {"name": "phone"},
        {"name": "streaming"}, {"name": "ai_tools"}, {"name": "food_delivery"},
        {"name": "groceries"}, {"name": "shopping"}, {"name": "transfer"},
        {"name": "credit_card"}, {"name": "banking"}, {"name": "toll"},
        {"name": "tax"}, {"name": "other"},
    ]}},
    "Status":         {"select": {"options": [
        {"name": "auto_pay", "color": "green"}, {"name": "due_soon", "color": "yellow"},
        {"name": "paid", "color": "green"}, {"name": "overdue", "color": "red"},
        {"name": "pending", "color": "orange"}, {"name": "cancelled", "color": "gray"},
        {"name": "unknown", "color": "default"},
    ]}},
    "Owner":          {"select": {"options": [
        {"name": "mike", "color": "blue"}, {"name": "erin", "color": "pink"},
        {"name": "shared", "color": "purple"}, {"name": "kids", "color": "green"},
        {"name": "bmo", "color": "yellow"},
    ]}},
    "Due Date":       {"date": {}},
    "Last Paid":      {"date": {}},
    "Last Amount":    {"number": {"format": "dollar"}},
    "Billing Cycle":  {"select": {"options": [
        {"name": "monthly"}, {"name": "quarterly"},
        {"name": "annual"}, {"name": "one_time"}, {"name": "unknown"},
    ]}},
    "Payment Method": {"rich_text": {}},
    "Source Account":  {"multi_select": {"options": [
        {"name": "cutillo@gmail.com"},
        {"name": "erincutillo@gmail.com"},
        {"name": "erinrameyallen@gmail.com"},
    ]}},
    "Confidence":     {"select": {"options": [
        {"name": "confirmed", "color": "green"},
        {"name": "likely", "color": "yellow"},
        {"name": "unverified", "color": "gray"},
    ]}},
    "Notes":          {"rich_text": {}},
    "Ledger ID":      {"rich_text": {}},
}


def build_ledger_props(item: dict) -> dict:
    props: dict = {
        "Vendor": {"title": [{"text": {"content": item.get("vendor", "Unknown")}}]},
        "Ledger ID": {"rich_text": [{"text": {"content": item.get("id", "")}}]},
    }
    if item.get("amount"):
        props["Amount"] = {"number": item["amount"]}
    if item.get("last_paid_amount"):
        props["Last Amount"] = {"number": item["last_paid_amount"]}
    if item.get("monthly_estimate"):
        props["Amount"] = {"number": item["monthly_estimate"]}
    for field, prop in [("category", "Category"), ("sub_category", "Sub-Category"),
                        ("status", "Status"), ("owner", "Owner"),
                        ("billing_cycle", "Billing Cycle"), ("confidence", "Confidence")]:
        val = item.get(field)
        if val and val != "unknown" and val != "other":
            props[prop] = {"select": {"name": val}}
    if item.get("due_date"):
        props["Due Date"] = {"date": {"start": item["due_date"]}}
    if item.get("last_paid_date"):
        props["Last Paid"] = {"date": {"start": item["last_paid_date"]}}
    if item.get("payment_method") and item["payment_method"] != "unknown":
        props["Payment Method"] = {"rich_text": [{"text": {"content": item["payment_method"]}}]}
    if item.get("source_accounts"):
        props["Source Account"] = {"multi_select": [{"name": a} for a in item["source_accounts"]]}
    if item.get("notes"):
        props["Notes"] = {"rich_text": [{"text": {"content": item["notes"][:2000]}}]}
    return props


def sync_financial_ledger(api_key: str, parent_page_id: str) -> dict:
    ledger_path = MC_DATA / "financial-ledger.json"
    if not ledger_path.exists():
        return {"status": "error", "message": "financial-ledger.json not found"}

    ledger = json.loads(ledger_path.read_text())
    items = ledger.get("items", [])
    log(f"[financial-ledger] Loaded {len(items)} items")

    db_id = find_database(api_key, "Household Financial Ledger")
    if not db_id:
        db_id = create_database(api_key, parent_page_id, "Household Financial Ledger", FINANCIAL_LEDGER_SCHEMA)

    updated = 0
    for i, item in enumerate(items):
        props = build_ledger_props(item)
        page_id = upsert_page(api_key, db_id, props, "Ledger ID", item.get("id", ""), item.get("notion_page_id"))
        if page_id:
            item["notion_page_id"] = page_id
            updated += 1
        if (i + 1) % 10 == 0:
            log(f"  Progress: {i + 1}/{len(items)}")

    ledger_path.write_text(json.dumps(ledger, indent=2))
    log(f"[financial-ledger] Synced {updated}/{len(items)}")
    return {"status": "ok", "synced": updated, "total": len(items), "database_id": db_id}


# ══════════════════════════════════════════════════════════════════════════════
# SOURCE: Job Pipeline
# ══════════════════════════════════════════════════════════════════════════════

JOB_PIPELINE_SCHEMA = {
    "Title":       {"title": {}},
    "Company":     {"rich_text": {}},
    "Status":      {"select": {"options": [
        {"name": "found", "color": "default"}, {"name": "sourced", "color": "blue"},
        {"name": "applied", "color": "purple"}, {"name": "interviewing", "color": "yellow"},
        {"name": "offer", "color": "green"}, {"name": "rejected", "color": "red"},
        {"name": "withdrawn", "color": "gray"},
    ]}},
    "Priority":    {"select": {"options": [
        {"name": "hot", "color": "red"}, {"name": "good", "color": "green"},
        {"name": "maybe", "color": "yellow"}, {"name": "archived", "color": "gray"},
    ]}},
    "Lane":        {"select": {"options": [
        {"name": "A", "color": "red"}, {"name": "B", "color": "orange"}, {"name": "C", "color": "blue"},
    ]}},
    "Location":    {"rich_text": {}},
    "Remote":      {"checkbox": {}},
    "URL":         {"url": {}},
    "Match Score": {"number": {"format": "number"}},
    "Easy Apply":  {"checkbox": {}},
    "Notes":       {"rich_text": {}},
    "Tags":        {"multi_select": {}},
    "Created":     {"date": {}},
    "Pipeline ID": {"rich_text": {}},
}


def build_job_props(item: dict) -> dict:
    title = item.get("title", "Untitled Role")
    company = item.get("company", "")
    # Build a useful title
    display = f"{title} @ {company}" if company and company != "linkedin.com" else title

    props: dict = {
        "Title": {"title": [{"text": {"content": display[:200]}}]},
        "Pipeline ID": {"rich_text": [{"text": {"content": item.get("id", "")}}]},
    }
    if company:
        props["Company"] = {"rich_text": [{"text": {"content": company[:200]}}]}
    if item.get("status"):
        props["Status"] = {"select": {"name": item["status"]}}
    if item.get("priority"):
        props["Priority"] = {"select": {"name": item["priority"]}}
    if item.get("lane"):
        props["Lane"] = {"select": {"name": item["lane"]}}
    if item.get("location"):
        props["Location"] = {"rich_text": [{"text": {"content": item["location"][:200]}}]}
    props["Remote"] = {"checkbox": bool(item.get("remote"))}
    if item.get("url"):
        props["URL"] = {"url": item["url"][:2000]}
    if item.get("matchScore"):
        props["Match Score"] = {"number": item["matchScore"]}
    props["Easy Apply"] = {"checkbox": bool(item.get("easyApply"))}
    if item.get("notes"):
        props["Notes"] = {"rich_text": [{"text": {"content": item["notes"][:2000]}}]}
    if item.get("tags"):
        props["Tags"] = {"multi_select": [{"name": t} for t in item["tags"][:10]]}
    if item.get("createdAt"):
        props["Created"] = {"date": {"start": item["createdAt"][:10]}}
    return props


def sync_job_pipeline(api_key: str, parent_page_id: str) -> dict:
    pipeline_path = MC_DATA / "job-pipeline.json"
    if not pipeline_path.exists():
        return {"status": "error", "message": "job-pipeline.json not found"}

    items = json.loads(pipeline_path.read_text())
    if isinstance(items, dict):
        items = items.get("items", items.get("jobs", []))
    log(f"[job-pipeline] Loaded {len(items)} items")

    db_id = find_database(api_key, "Job Hunt Pipeline")
    if not db_id:
        db_id = create_database(api_key, parent_page_id, "Job Hunt Pipeline", JOB_PIPELINE_SCHEMA)

    updated = 0
    for i, item in enumerate(items):
        props = build_job_props(item)
        page_id = upsert_page(api_key, db_id, props, "Pipeline ID", item.get("id", ""), item.get("notion_page_id"))
        if page_id:
            item["notion_page_id"] = page_id
            updated += 1
        if (i + 1) % 10 == 0:
            log(f"  Progress: {i + 1}/{len(items)}")

    pipeline_path.write_text(json.dumps(items, indent=2))
    log(f"[job-pipeline] Synced {updated}/{len(items)}")
    return {"status": "ok", "synced": updated, "total": len(items), "database_id": db_id}


# ══════════════════════════════════════════════════════════════════════════════
# SOURCE: News Intel
# ══════════════════════════════════════════════════════════════════════════════

NEWS_INTEL_SCHEMA = {
    "Title":      {"title": {}},
    "Topic":      {"select": {}},
    "Bucket":     {"select": {"options": [
        {"name": "top", "color": "red"}, {"name": "mid", "color": "yellow"},
        {"name": "low", "color": "gray"},
    ]}},
    "Score":      {"number": {"format": "number"}},
    "Overview":   {"rich_text": {}},
    "Suggestion": {"rich_text": {}},
    "Source":     {"rich_text": {}},
    "Source URL": {"url": {}},
    "Entities":   {"multi_select": {}},
    "Created":    {"date": {}},
    "Brief ID":   {"rich_text": {}},
}


def build_news_props(item: dict) -> dict:
    props: dict = {
        "Title": {"title": [{"text": {"content": item.get("title", "Untitled")[:200]}}]},
        "Brief ID": {"rich_text": [{"text": {"content": item.get("id", "")}}]},
    }
    if item.get("topic"):
        props["Topic"] = {"select": {"name": item["topic"][:100]}}
    if item.get("bucket"):
        props["Bucket"] = {"select": {"name": item["bucket"]}}
    if item.get("score") is not None:
        props["Score"] = {"number": item["score"]}
    overview = item.get("overview", [])
    if overview:
        text = overview[0] if isinstance(overview, list) else str(overview)
        props["Overview"] = {"rich_text": [{"text": {"content": str(text)[:2000]}}]}
    if item.get("suggestion"):
        props["Suggestion"] = {"rich_text": [{"text": {"content": item["suggestion"][:2000]}}]}
    media = item.get("media", [])
    if media:
        props["Source"] = {"rich_text": [{"text": {"content": media[0].get("source", "")[:200]}}]}
        if media[0].get("url"):
            props["Source URL"] = {"url": media[0]["url"][:2000]}
    if item.get("entities"):
        props["Entities"] = {"multi_select": [{"name": e[:100]} for e in item["entities"][:10]]}
    if item.get("createdAt"):
        props["Created"] = {"date": {"start": item["createdAt"][:10]}}
    return props


def sync_news_intel(api_key: str, parent_page_id: str) -> dict:
    news_path = MC_DATA / "news-intel.json"
    if not news_path.exists():
        return {"status": "error", "message": "news-intel.json not found"}

    data = json.loads(news_path.read_text())
    items = data.get("briefs", data) if isinstance(data, dict) else data
    log(f"[news-intel] Loaded {len(items)} briefs")

    db_id = find_database(api_key, "News & Intel Briefs")
    if not db_id:
        db_id = create_database(api_key, parent_page_id, "News & Intel Briefs", NEWS_INTEL_SCHEMA)

    updated = 0
    for i, item in enumerate(items):
        props = build_news_props(item)
        page_id = upsert_page(api_key, db_id, props, "Brief ID", item.get("id", ""), item.get("notion_page_id"))
        if page_id:
            item["notion_page_id"] = page_id
            updated += 1
        if (i + 1) % 10 == 0:
            log(f"  Progress: {i + 1}/{len(items)}")

    if isinstance(data, dict) and "briefs" in data:
        data["briefs"] = items
    else:
        data = items
    news_path.write_text(json.dumps(data, indent=2))
    log(f"[news-intel] Synced {updated}/{len(items)}")
    return {"status": "ok", "synced": updated, "total": len(items), "database_id": db_id}


# ══════════════════════════════════════════════════════════════════════════════
# SOURCE: Content Hub
# ══════════════════════════════════════════════════════════════════════════════

CONTENT_HUB_SCHEMA = {
    "Content":     {"title": {}},
    "Platform":    {"select": {"options": [
        {"name": "linkedin", "color": "blue"}, {"name": "twitter", "color": "default"},
        {"name": "instagram", "color": "pink"}, {"name": "facebook", "color": "blue"},
    ]}},
    "Status":      {"select": {"options": [
        {"name": "draft", "color": "gray"}, {"name": "scheduled", "color": "yellow"},
        {"name": "published", "color": "green"}, {"name": "failed", "color": "red"},
    ]}},
    "Persona":     {"select": {}},
    "Scheduled":   {"date": {}},
    "Published":   {"date": {}},
    "Likes":       {"number": {"format": "number"}},
    "Comments":    {"number": {"format": "number"}},
    "Impressions": {"number": {"format": "number"}},
    "Post ID":     {"rich_text": {}},
}


def build_content_props(item: dict) -> dict:
    text = item.get("text", "")[:200]
    props: dict = {
        "Content": {"title": [{"text": {"content": text or "Untitled Post"}}]},
        "Post ID": {"rich_text": [{"text": {"content": item.get("id", "")}}]},
    }
    if item.get("platform"):
        props["Platform"] = {"select": {"name": item["platform"]}}
    if item.get("status"):
        props["Status"] = {"select": {"name": item["status"]}}
    if item.get("personaId"):
        props["Persona"] = {"select": {"name": item["personaId"]}}
    if item.get("scheduledAt"):
        props["Scheduled"] = {"date": {"start": item["scheduledAt"][:10]}}
    if item.get("publishedAt"):
        props["Published"] = {"date": {"start": item["publishedAt"][:10]}}
    metrics = item.get("metrics", {})
    if metrics.get("likes"):
        props["Likes"] = {"number": metrics["likes"]}
    if metrics.get("comments"):
        props["Comments"] = {"number": metrics["comments"]}
    if metrics.get("impressions"):
        props["Impressions"] = {"number": metrics["impressions"]}
    return props


def sync_content_hub(api_key: str, parent_page_id: str) -> dict:
    posts_path = MC_DATA / "contenthub-posts.json"
    if not posts_path.exists():
        return {"status": "error", "message": "contenthub-posts.json not found"}

    items = json.loads(posts_path.read_text())
    if isinstance(items, dict):
        items = items.get("posts", [])
    log(f"[content-hub] Loaded {len(items)} posts")

    db_id = find_database(api_key, "Content Hub Posts")
    if not db_id:
        db_id = create_database(api_key, parent_page_id, "Content Hub Posts", CONTENT_HUB_SCHEMA)

    updated = 0
    for i, item in enumerate(items):
        props = build_content_props(item)
        page_id = upsert_page(api_key, db_id, props, "Post ID", item.get("id", ""), item.get("notion_page_id"))
        if page_id:
            item["notion_page_id"] = page_id
            updated += 1
        if (i + 1) % 10 == 0:
            log(f"  Progress: {i + 1}/{len(items)}")

    posts_path.write_text(json.dumps(items, indent=2))
    log(f"[content-hub] Synced {updated}/{len(items)}")
    return {"status": "ok", "synced": updated, "total": len(items), "database_id": db_id}


# ══════════════════════════════════════════════════════════════════════════════
# SOURCE: Cloud Subscriptions
# ══════════════════════════════════════════════════════════════════════════════

SUBSCRIPTIONS_SCHEMA = {
    "Name":         {"title": {}},
    "Brand":        {"select": {}},
    "Category":     {"select": {"options": [
        {"name": "AI", "color": "purple"}, {"name": "Gaming", "color": "green"},
        {"name": "Food", "color": "orange"}, {"name": "Streaming", "color": "red"},
        {"name": "Productivity", "color": "blue"}, {"name": "Finance", "color": "yellow"},
        {"name": "Other", "color": "gray"},
    ]}},
    "Monthly Cost": {"number": {"format": "dollar"}},
    "Billing Day":  {"number": {"format": "number"}},
    "Status":       {"select": {"options": [
        {"name": "active", "color": "green"}, {"name": "cancelled", "color": "red"},
        {"name": "paused", "color": "yellow"}, {"name": "unknown", "color": "gray"},
    ]}},
    "Notes":        {"rich_text": {}},
    "Sub ID":       {"rich_text": {}},
}


def build_sub_props(item: dict) -> dict:
    props: dict = {
        "Name": {"title": [{"text": {"content": item.get("name", "Unknown")[:200]}}]},
        "Sub ID": {"rich_text": [{"text": {"content": item.get("id", item.get("name", ""))[:200]}}]},
    }
    if item.get("brand"):
        props["Brand"] = {"select": {"name": item["brand"][:100]}}
    if item.get("category"):
        props["Category"] = {"select": {"name": item["category"][:100]}}
    if item.get("cost_monthly") is not None:
        props["Monthly Cost"] = {"number": item["cost_monthly"]}
    if item.get("billing_day") is not None:
        props["Billing Day"] = {"number": item["billing_day"]}
    if item.get("status"):
        props["Status"] = {"select": {"name": item["status"]}}
    if item.get("notes"):
        props["Notes"] = {"rich_text": [{"text": {"content": item["notes"][:2000]}}]}
    return props


def sync_subscriptions(api_key: str, parent_page_id: str) -> dict:
    subs_path = MC_DATA / "cloud-subscriptions.json"
    if not subs_path.exists():
        return {"status": "error", "message": "cloud-subscriptions.json not found"}

    data = json.loads(subs_path.read_text())
    items = data.get("subscriptions", data) if isinstance(data, dict) else data
    log(f"[subscriptions] Loaded {len(items)} subscriptions")

    db_id = find_database(api_key, "Cloud Subscriptions")
    if not db_id:
        db_id = create_database(api_key, parent_page_id, "Cloud Subscriptions", SUBSCRIPTIONS_SCHEMA)

    updated = 0
    for i, item in enumerate(items):
        props = build_sub_props(item)
        id_val = item.get("id", item.get("name", ""))
        page_id = upsert_page(api_key, db_id, props, "Sub ID", id_val, item.get("notion_page_id"))
        if page_id:
            item["notion_page_id"] = page_id
            updated += 1
        if (i + 1) % 10 == 0:
            log(f"  Progress: {i + 1}/{len(items)}")

    if isinstance(data, dict) and "subscriptions" in data:
        data["subscriptions"] = items
    else:
        data = items
    subs_path.write_text(json.dumps(data, indent=2))
    log(f"[subscriptions] Synced {updated}/{len(items)}")
    return {"status": "ok", "synced": updated, "total": len(items), "database_id": db_id}


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

SYNC_FUNCTIONS = {
    "financial-ledger": sync_financial_ledger,
    "job-pipeline": sync_job_pipeline,
    "news-intel": sync_news_intel,
    "content-hub": sync_content_hub,
    "subscriptions": sync_subscriptions,
}


def main():
    parser = argparse.ArgumentParser(description="Sync Mission Control data to Notion")
    parser.add_argument("--source", default="financial-ledger",
                        choices=ALL_SOURCES + ["all"],
                        help="Which data source to sync (default: financial-ledger)")
    args = parser.parse_args()

    log("=" * 60)
    log(f"Starting Notion sync — source: {args.source}")

    api_key = get_api_key()
    if not api_key:
        log("ERROR: No Notion API key found. Set NOTION_API_KEY in .env.local")
        print(json.dumps({"status": "error", "message": "No Notion API key found"}))
        sys.exit(1)

    try:
        parent_page_id = get_parent_page_id(api_key)
        log(f"Using parent page: {parent_page_id}")
    except RuntimeError as e:
        log(f"ERROR: {e}")
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

    sources = ALL_SOURCES if args.source == "all" else [args.source]
    results = {}

    for source in sources:
        log(f"\n--- Syncing {source} ---")
        try:
            results[source] = SYNC_FUNCTIONS[source](api_key, parent_page_id)
        except Exception as e:
            log(f"ERROR syncing {source}: {e}")
            results[source] = {"status": "error", "message": str(e)}

    # Print summary
    total_synced = sum(r.get("synced", 0) for r in results.values())
    total_items = sum(r.get("total", 0) for r in results.values())
    errors = [s for s, r in results.items() if r.get("status") == "error"]

    log(f"\nSync complete: {total_synced}/{total_items} items across {len(sources)} sources")
    if errors:
        log(f"Errors in: {', '.join(errors)}")

    print(json.dumps({"status": "ok" if not errors else "partial", "results": results,
                       "summary": {"synced": total_synced, "total": total_items, "errors": errors}}))


if __name__ == "__main__":
    main()
