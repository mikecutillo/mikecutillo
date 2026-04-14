#!/usr/bin/env python3
"""
notion-pulse-sync.py — Sync BMO Family Pulse check-ins to Notion

Creates a "Family Pulse" database in Notion and upserts all check-in
responses. Writes notion_page_id back to family-pulse.json.

Usage:
    python3 scripts/notion-pulse-sync.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

WORKSPACE = Path("/Users/mikecutillo/.openclaw/workspace-shared")
PULSE_PATH = WORKSPACE / "mission-control/data/family-pulse.json"
LOG_PATH = WORKSPACE / "logs/notion-pulse-sync.log"

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
DB_TITLE = "Family Pulse"


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def get_api_key() -> str:
    key = os.environ.get("NOTION_API_KEY", "")
    if key:
        return key
    env_path = WORKSPACE / "mission-control/.env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("NOTION_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


def hdrs(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def find_database(api_key: str) -> str | None:
    resp = requests.post(
        f"{NOTION_API}/search",
        headers=hdrs(api_key),
        json={"query": DB_TITLE, "filter": {"value": "database", "property": "object"}},
    )
    if resp.status_code != 200:
        log(f"Search failed: {resp.status_code} {resp.text[:200]}")
        return None
    for result in resp.json().get("results", []):
        title = "".join(t.get("plain_text", "") for t in result.get("title", []))
        if title == DB_TITLE:
            return result["id"]
    return None


def create_database(api_key: str) -> str:
    # Create parent page
    page_resp = requests.post(
        f"{NOTION_API}/pages",
        headers=hdrs(api_key),
        json={
            "parent": {"type": "workspace", "workspace": True},
            "properties": {
                "title": {"title": [{"text": {"content": DB_TITLE}}]}
            },
        },
    )
    if page_resp.status_code != 200:
        raise RuntimeError(f"Parent page creation failed: {page_resp.text[:200]}")

    parent_id = page_resp.json()["id"]
    log(f"Created parent page: {parent_id}")

    # Create database
    db_resp = requests.post(
        f"{NOTION_API}/databases",
        headers=hdrs(api_key),
        json={
            "parent": {"type": "page_id", "page_id": parent_id},
            "title": [{"text": {"content": DB_TITLE}}],
            "properties": {
                "Question": {"title": {}},
                "Member": {"select": {"options": [
                    {"name": "mike", "color": "blue"},
                    {"name": "erin", "color": "pink"},
                    {"name": "liam", "color": "purple"},
                    {"name": "clara", "color": "green"},
                ]}},
                "Category": {"select": {"options": [
                    {"name": "emotional", "color": "red"},
                    {"name": "gratitude", "color": "yellow"},
                    {"name": "growth-mindset", "color": "green"},
                    {"name": "connection", "color": "blue"},
                    {"name": "self-awareness", "color": "orange"},
                    {"name": "reflection", "color": "purple"},
                    {"name": "couples", "color": "pink"},
                ]}},
                "Rating": {"number": {}},
                "Response": {"rich_text": {}},
                "Emoji Rating": {"rich_text": {}},
                "Asked At": {"date": {}},
                "Responded At": {"date": {}},
                "Week": {"rich_text": {}},
                "Streak": {"number": {}},
                "Flagged": {"checkbox": {}},
                "Pulse ID": {"rich_text": {}},
            },
        },
    )
    if db_resp.status_code != 200:
        raise RuntimeError(f"Database creation failed: {db_resp.text[:200]}")

    db_id = db_resp.json()["id"]
    log(f"Created database: {db_id}")
    return db_id


def get_week_key(date_str: str) -> str:
    """Convert ISO date string to week key like '2026-W15'."""
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
    except Exception:
        return ""


def build_page_properties(checkin: dict, member_id: str, streak: int) -> dict:
    props = {
        "Question": {"title": [{"text": {"content": checkin.get("questionText", "")[:2000]}}]},
        "Member": {"select": {"name": member_id}},
        "Category": {"select": {"name": checkin.get("category", "emotional")}},
        "Pulse ID": {"rich_text": [{"text": {"content": checkin.get("id", "")}}]},
        "Flagged": {"checkbox": checkin.get("flagged", False)},
        "Streak": {"number": streak},
    }

    if checkin.get("rating") is not None:
        props["Rating"] = {"number": checkin["rating"]}

    if checkin.get("response"):
        props["Response"] = {"rich_text": [{"text": {"content": checkin["response"][:2000]}}]}

    if checkin.get("scheduledAt"):
        props["Asked At"] = {"date": {"start": checkin["scheduledAt"]}}
        props["Week"] = {"rich_text": [{"text": {"content": get_week_key(checkin["scheduledAt"])}}]}

    if checkin.get("respondedAt"):
        props["Responded At"] = {"date": {"start": checkin["respondedAt"]}}

    return props


def find_page_by_pulse_id(api_key: str, db_id: str, pulse_id: str) -> str | None:
    resp = requests.post(
        f"{NOTION_API}/databases/{db_id}/query",
        headers=hdrs(api_key),
        json={
            "filter": {
                "property": "Pulse ID",
                "rich_text": {"equals": pulse_id},
            }
        },
    )
    if resp.status_code != 200:
        return None
    results = resp.json().get("results", [])
    return results[0]["id"] if results else None


def upsert_checkin(api_key: str, db_id: str, checkin: dict, member_id: str, streak: int) -> str | None:
    pulse_id = checkin.get("id", "")
    props = build_page_properties(checkin, member_id, streak)

    # Check if page already exists
    existing_id = checkin.get("notionPageId") or find_page_by_pulse_id(api_key, db_id, pulse_id)

    if existing_id:
        # Update existing page
        resp = requests.patch(
            f"{NOTION_API}/pages/{existing_id}",
            headers=hdrs(api_key),
            json={"properties": props},
        )
        if resp.status_code == 200:
            return existing_id
        log(f"Update failed for {pulse_id}: {resp.status_code}")
        return existing_id
    else:
        # Create new page
        resp = requests.post(
            f"{NOTION_API}/pages",
            headers=hdrs(api_key),
            json={"parent": {"database_id": db_id}, "properties": props},
        )
        if resp.status_code == 200:
            page_id = resp.json()["id"]
            return page_id
        log(f"Create failed for {pulse_id}: {resp.status_code} {resp.text[:200]}")
        return None


def main():
    api_key = get_api_key()
    if not api_key:
        log("ERROR: No Notion API key found")
        sys.exit(1)

    log("Starting Family Pulse → Notion sync")

    # Load pulse data
    if not PULSE_PATH.exists():
        log("No family-pulse.json found — nothing to sync")
        sys.exit(0)

    pulse_data = json.loads(PULSE_PATH.read_text())

    # Find or create database
    db_id = find_database(api_key)
    if not db_id:
        log("Database not found — creating new one")
        db_id = create_database(api_key)
    log(f"Using database: {db_id}")

    # Sync each member's responded check-ins
    synced = 0
    updated = 0
    for member_id, member_data in pulse_data.get("members", {}).items():
        streak = member_data.get("currentStreak", 0)
        for checkin in member_data.get("checkins", []):
            # Only sync check-ins that have been responded to
            if not checkin.get("respondedAt"):
                continue

            page_id = upsert_checkin(api_key, db_id, checkin, member_id, streak)
            if page_id:
                if checkin.get("notionPageId") != page_id:
                    checkin["notionPageId"] = page_id
                    updated += 1
                synced += 1

    # Write back notion_page_ids
    if updated > 0:
        PULSE_PATH.write_text(json.dumps(pulse_data, indent=2))
        log(f"Wrote {updated} notion_page_id(s) back to family-pulse.json")

    log(f"Sync complete: {synced} check-ins synced, {updated} new page IDs written")


if __name__ == "__main__":
    main()
