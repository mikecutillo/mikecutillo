"""
shared/google_api.py — OpenClaw shared Google API helper
Handles OAuth auth for multiple accounts + Gmail + Drive operations.

Auth tokens stored per-account at:
  ~/.openclaw/credentials/gmail-tokens/{slug}.json

OAuth client secret at:
  ~/.openclaw/credentials/google-oauth-client.json

Usage:
    from google_api import gmail_service, drive_service
    svc = gmail_service("cutillo@gmail.com")
    svc.users().messages().list(userId='me', q='...').execute()
"""

import json
import sys
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ── Paths ─────────────────────────────────────────────────────────────────────
CRED_DIR      = Path("/Users/mikecutillo/.openclaw/credentials")
CLIENT_SECRET = CRED_DIR / "google-oauth-client.json"
TOKEN_DIR     = CRED_DIR / "gmail-tokens"

# ── Scopes ────────────────────────────────────────────────────────────────────
SCOPES = [
    "https://mail.google.com/",                       # Full Gmail access
    "https://www.googleapis.com/auth/gmail.settings.basic",  # Gmail filters/settings
    "https://www.googleapis.com/auth/drive",           # Full Drive access
    "https://www.googleapis.com/auth/calendar",          # Full Calendar access
]

CLASSROOM_SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
]

# ── Known accounts ────────────────────────────────────────────────────────────
ACCOUNTS = {
    "cutillo@gmail.com":             "cutillo",
    "erincutillo@gmail.com":         "erincutillo",
    "erinrameyallen@gmail.com":      "erinrameyallen",
    "2030Cutillol@holmdelschools.org": "cutillol-school",
}

CLASSROOM_ACCOUNTS = {
    "2030Cutillol@holmdelschools.org": "cutillol-school",
}


def _token_path(email: str, classroom: bool = False) -> Path:
    slug = ACCOUNTS.get(email, email.split("@")[0])
    suffix = "-classroom" if classroom else ""
    return TOKEN_DIR / f"{slug}{suffix}.json"


def _load_creds(email: str, scopes: list[str] | None = None) -> Credentials | None:
    classroom = scopes == CLASSROOM_SCOPES
    path = _token_path(email, classroom=classroom)
    if not path.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(path), scopes or SCOPES)
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            path.write_text(creds.to_json())
        except Exception as e:
            print(f"Token refresh failed for {email}: {e}", file=sys.stderr)
            return None
    return creds if creds.valid else None


def authorize(email: str, scopes: list[str] | None = None, use_console: bool = False) -> Credentials:
    """Run OAuth flow for email. Opens browser. Saves token. Returns creds."""
    if not CLIENT_SECRET.exists():
        raise FileNotFoundError(f"OAuth client secret not found at {CLIENT_SECRET}")
    if use_console:
        raise NotImplementedError("Console OAuth flow is not available in this installed google auth library version")
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    _scopes = scopes or SCOPES
    classroom = _scopes == CLASSROOM_SCOPES
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), _scopes)
    creds = flow.run_local_server(port=0, open_browser=True)
    _token_path(email, classroom=classroom).write_text(creds.to_json())
    print(f"Token saved for {email}")
    return creds


def get_creds(email: str, scopes: list[str] | None = None) -> Credentials:
    creds = _load_creds(email, scopes)
    if not creds:
        raise RuntimeError(
            f"No valid token for {email}. Run gmail-auth.py first:\n"
            f"  python3 ~/.openclaw/scripts/gmail-auth.py {email}"
        )
    return creds


def is_authorized(email: str) -> bool:
    try:
        return _load_creds(email) is not None
    except Exception:
        return False


def is_classroom_authorized(email: str) -> bool:
    try:
        return _load_creds(email, CLASSROOM_SCOPES) is not None
    except Exception:
        return False


# ── Service builders ──────────────────────────────────────────────────────────

def gmail_service(email: str):
    return build("gmail", "v1", credentials=get_creds(email), cache_discovery=False)


def classroom_service(email: str):
    return build("classroom", "v1", credentials=get_creds(email, CLASSROOM_SCOPES), cache_discovery=False)


def drive_service(email: str):
    return build("drive", "v3", credentials=get_creds(email), cache_discovery=False)


def calendar_service(email: str):
    return build("calendar", "v3", credentials=get_creds(email), cache_discovery=False)


# ── Gmail helpers ─────────────────────────────────────────────────────────────

def gmail_profile(email: str) -> dict:
    return gmail_service(email).users().getProfile(userId="me").execute()


def gmail_list_messages(email: str, q: str = "", max_results: int = 200,
                        label_ids: list[str] | None = None) -> list[dict]:
    svc   = gmail_service(email)
    msgs  = []
    kwargs: dict[str, Any] = {"userId": "me", "maxResults": min(max_results, 500)}
    if q:           kwargs["q"]        = q
    if label_ids:   kwargs["labelIds"] = label_ids
    page_token = None
    while True:
        if page_token:
            kwargs["pageToken"] = page_token
        resp = svc.users().messages().list(**kwargs).execute()
        msgs.extend(resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token or len(msgs) >= max_results:
            break
    return msgs[:max_results]


def gmail_get_message(email: str, msg_id: str,
                      fmt: str = "metadata",
                      headers: list[str] | None = None) -> dict:
    kwargs: dict[str, Any] = {"userId": "me", "id": msg_id, "format": fmt}
    if headers:
        kwargs["metadataHeaders"] = headers
    return gmail_service(email).users().messages().get(**kwargs).execute()


def gmail_batch_delete(email: str, msg_ids: list[str]) -> None:
    """Permanently delete up to 1000 messages in one call."""
    svc = gmail_service(email)
    for i in range(0, len(msg_ids), 1000):
        svc.users().messages().batchDelete(
            userId="me",
            body={"ids": msg_ids[i:i+1000]},
        ).execute()


def gmail_count_query(email: str, q: str) -> int:
    """Return approximate count for a Gmail search query."""
    msgs = gmail_list_messages(email, q=q, max_results=500)
    return len(msgs)


def gmail_delete_query(email: str, q: str, dry_run: bool = True,
                       batch_size: int = 500) -> int:
    """Delete all messages matching query. Returns count deleted."""
    svc   = gmail_service(email)
    total = 0
    while True:
        resp = svc.users().messages().list(
            userId="me", q=q, maxResults=batch_size
        ).execute()
        msgs = resp.get("messages", [])
        if not msgs:
            break
        ids = [m["id"] for m in msgs]
        if not dry_run:
            svc.users().messages().batchDelete(
                userId="me", body={"ids": ids}
            ).execute()
        total += len(ids)
        if not resp.get("nextPageToken"):
            break
    return total


# ── Calendar helpers ──────────────────────────────────────────────────────────

def calendar_list(email: str) -> list[dict]:
    return calendar_service(email).calendarList().list().execute().get("items", [])


def calendar_events(email: str, calendar_id: str = 'primary', time_min: str | None = None,
                    time_max: str | None = None, max_results: int = 50) -> list[dict]:
    kwargs: dict[str, Any] = {
        'calendarId': calendar_id,
        'singleEvents': True,
        'orderBy': 'startTime',
        'maxResults': max_results,
    }
    if time_min:
        kwargs['timeMin'] = time_min
    if time_max:
        kwargs['timeMax'] = time_max
    return calendar_service(email).events().list(**kwargs).execute().get('items', [])


# ── Drive helpers ─────────────────────────────────────────────────────────────

def drive_about(email: str) -> dict:
    return drive_service(email).about().get(
        fields="storageQuota,user"
    ).execute()


def drive_list_files(email: str, q: str = "", page_size: int = 200,
                     fields: str = "files(id,name,size,mimeType,modifiedTime)") -> list[dict]:
    svc   = drive_service(email)
    files = []
    page_token = None
    while True:
        kwargs: dict[str, Any] = {
            "q": q or "trashed=false",
            "pageSize": min(page_size, 1000),
            "fields": f"nextPageToken,{fields}",
        }
        if page_token:
            kwargs["pageToken"] = page_token
        resp = svc.files().list(**kwargs).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token or len(files) >= page_size:
            break
    return files[:page_size]


def drive_trash_file(email: str, file_id: str) -> dict:
    return drive_service(email).files().trash(fileId=file_id).execute()


def drive_move_file(email: str, file_id: str,
                    add_parent: str, remove_parent: str) -> dict:
    return drive_service(email).files().update(
        fileId=file_id,
        addParents=add_parent,
        removeParents=remove_parent,
        fields="id,parents",
    ).execute()


# ── Gmail label / filter helpers ──────────────────────────────────────────────

def gmail_list_labels(email: str) -> list[dict]:
    return gmail_service(email).users().labels().list(userId="me").execute().get("labels", [])


def gmail_create_label(email: str, name: str) -> dict:
    return gmail_service(email).users().labels().create(
        userId="me", body={"name": name}
    ).execute()


def gmail_get_label_id(email: str, name: str) -> str | None:
    """Return label ID for name, or None if not found."""
    for lbl in gmail_list_labels(email):
        if lbl.get("name", "").lower() == name.lower():
            return lbl["id"]
    return None


def gmail_create_filter(email: str, from_addr: str,
                        add_label_names: list[str] | None = None,
                        mark_important: bool = False) -> dict:
    add_ids: list[str] = []
    if add_label_names:
        for name in add_label_names:
            lid = gmail_get_label_id(email, name)
            if lid:
                add_ids.append(lid)
    if mark_important:
        add_ids.append("IMPORTANT")
    action: dict[str, Any] = {}
    if add_ids:
        action["addLabelIds"] = add_ids
    return gmail_service(email).users().settings().filters().create(
        userId="me",
        body={"criteria": {"from": from_addr}, "action": action},
    ).execute()


# ── Google Classroom helpers ───────────────────────────────────────────────────

def classroom_list_courses(email: str) -> list[dict]:
    svc = classroom_service(email)
    courses, page_token = [], None
    while True:
        kwargs: dict[str, Any] = {"pageSize": 100, "studentId": "me"}
        if page_token:
            kwargs["pageToken"] = page_token
        resp = svc.courses().list(**kwargs).execute()
        courses.extend(resp.get("courses", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return courses


def classroom_list_coursework(email: str, course_id: str) -> list[dict]:
    svc = classroom_service(email)
    work, page_token = [], None
    while True:
        kwargs: dict[str, Any] = {"courseId": course_id, "pageSize": 100}
        if page_token:
            kwargs["pageToken"] = page_token
        resp = svc.courses().courseWork().list(**kwargs).execute()
        work.extend(resp.get("courseWork", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return work


def classroom_list_submissions(email: str, course_id: str, coursework_id: str = "-") -> list[dict]:
    svc = classroom_service(email)
    subs, page_token = [], None
    while True:
        kwargs: dict[str, Any] = {"courseId": course_id, "courseWorkId": coursework_id, "pageSize": 100}
        if page_token:
            kwargs["pageToken"] = page_token
        resp = svc.courses().courseWork().studentSubmissions().list(**kwargs).execute()
        subs.extend(resp.get("studentSubmissions", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return subs


def classroom_list_announcements(email: str, course_id: str) -> list[dict]:
    svc = classroom_service(email)
    resp = svc.courses().announcements().list(courseId=course_id, pageSize=20).execute()
    return resp.get("announcements", [])
