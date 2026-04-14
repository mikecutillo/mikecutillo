# Family Intel — Unified Cross-Platform Event Timeline
## Capabilities Report & Setup Guide

**Version:** 1.0.0  
**Built:** 2026-04-12  
**Location:** Mission Control → Cutillo Cloud → Family Intel (`/family-intel`)

---

## What This System Does

Family Intel is a unified event timeline that aggregates activity signals from three distinct layers of your home tech stack:

1. **Network Layer** — Pi-hole DNS query log (what every device on your network is doing)
2. **Microsoft Platform** — Outlook Calendar, OneDrive, Azure AD sign-ins, Microsoft Defender
3. **Google Platform** — Google Calendar, Google Drive, Gmail for Mike and Erin

Each source provides a different slice of the story. Together they let you see patterns that none of them can show alone.

---

## The "Whole Story" Principle

Router/DNS gives you **what** (network traffic, blocked sites, device activity).  
Platform signals give you **context** (what was scheduled, what was created, who signed in).

**Example correlations the system enables:**

| Router sees | Platform sees | Combined insight |
|---|---|---|
| Liam's iPad → roblox.com at 10:47pm | Calendar: Liam's bedtime = 9:30pm | Gaming past bedtime → alert |
| Clara's iPad → youtube.com 18× between 8am–3pm | — | Device active during school hours → flag |
| Unknown device → TikTok (blocked) 4× in 10 min | — | Repeated policy bypass attempt → warning |
| Erin's phone → gmail.com | Google Calendar: dentist appointment today at 2pm | Erin is checking in — context |
| Mike's PC → xboxlive.com | MS Sign-in: Mike authenticated from 192.168.1.100 | Mike gaming at home — routine |
| All devices offline for 4 hours | Calendar: Family vacation this week | Expected quiet period — no alerts needed |

---

## Source 1: Pi-hole DNS Polling

### How it works
Pi-hole logs every DNS query on your network. The poller calls `/api/family-intel/ingest/pihole` (GET or POST), fetches all queries since the last poll, and saves interesting ones as events.

### What you get
- **Blocked domain attempts** — every time a device tries to reach a site on your blocklist
- **Domain category intelligence** — gaming, streaming, social media, educational, chat
- **Per-device attribution** — IP → person mapping via `data/family-intel-devices.json`
- **Activity timing** — exactly when each device was active and what it was doing

### Domain categories tracked
| Category | Examples |
|---|---|
| Gaming | Roblox, Minecraft, Xbox Live, PlayStation, Steam, Fortnite, Epic Games |
| Streaming | Netflix, YouTube, Twitch, Hulu, Disney+, Prime Video |
| Social | TikTok, Instagram, Snapchat, Twitter/X, Facebook |
| Communication | Discord |
| Educational | Khan Academy, Duolingo, Google Classroom, Quizlet |

### Limitations
- Only sees DNS queries — not the content of traffic
- VPN usage on a device bypasses Pi-hole entirely
- DNS-over-HTTPS (DoH) on a device can bypass Pi-hole (disable in router if needed)
- IP-to-person mapping requires keeping `data/family-intel-devices.json` up to date

### Setup
Pi-hole is already configured. No additional setup needed.

**To start collecting:** Click "Poll Pi-hole" in the Family Intel UI, or call `GET /api/family-intel/ingest/pihole`.

**Device map:** Edit `data/family-intel-devices.json` to map your home devices to family members. Get device IPs from the Pi-hole admin or your router's client list.

---

## Source 2: Microsoft Graph Webhooks

### How it works
You register subscriptions with Microsoft Graph pointing to this server's webhook URL. When a subscribed resource changes (calendar event created, file modified, sign-in detected), Microsoft POSTs a notification to `/api/family-intel/ingest/microsoft`. The receiver validates the secret, normalizes the notification, and saves it as an event.

### What you get
| Resource | Change Types | What you see |
|---|---|---|
| `/users/{id}/events` | created, updated, deleted | Outlook calendar event activity |
| `/users/{id}/drive/root` | updated | OneDrive file create/modify/delete |
| `auditLogs/signIns` | created | Who signed in, from what app, from what IP |
| `security/alerts_v2` | created, updated | Microsoft Defender security alerts |

### Limitations
- Cannot read email body content (only that email activity occurred)
- File content is not included — only file names and timestamps
- Sign-in log covers Azure AD authentications only — not all browser logins
- Subscriptions expire: calendar/drive = ~3 days; sign-in = 60 minutes
- Requires Azure App Registration (free, takes ~15 minutes to set up)
- Requires a publicly reachable URL (ngrok, Cloudflare Tunnel, or a deployed server)
- Personal Microsoft accounts (not Azure AD) have limited Graph API access

### Setup Steps

**Step 1 — Create Azure App Registration**
1. Go to [portal.azure.com](https://portal.azure.com) and sign in with your Microsoft account
2. Navigate to: Azure Active Directory → App Registrations → New Registration
3. Name it `Family Intel` (or anything), select "Accounts in this organizational directory only"
4. No redirect URI needed — click Register

**Step 2 — Add API Permissions**
In your app registration, go to API Permissions → Add a permission → Microsoft Graph → Application permissions:
- `Calendars.Read`
- `Files.Read.All`
- `AuditLog.Read.All`
- `User.Read.All`
- `SecurityEvents.Read.All`

Then click **Grant admin consent**.

**Step 3 — Create Client Secret**
Go to Certificates & Secrets → New client secret → 24 months. Copy the secret value immediately.

**Step 4 — Get User IDs**
With your credentials, call: `GET https://graph.microsoft.com/v1.0/users` to list users and get their object IDs. Or use Graph Explorer at [developer.microsoft.com/graph/graph-explorer](https://developer.microsoft.com/graph/graph-explorer).

**Step 5 — Configure .env.local**
```env
MS_TENANT_ID=your-tenant-id
MS_CLIENT_ID=your-client-id
MS_CLIENT_SECRET=your-secret-value
MS_MIKE_USER_ID=mike-azure-object-id
MS_ERIN_USER_ID=erin-azure-object-id
MS_WEBHOOK_SECRET=family-intel-2026
```

**Step 6 — Expose locally**
```bash
# Option A: ngrok (free tier works)
npx ngrok http 3333

# Option B: Cloudflare Tunnel (free, more stable)
cloudflared tunnel --url http://localhost:3333
```
Add the public URL to `.env.local`:
```env
WEBHOOK_BASE_URL=https://xxxx.ngrok-free.app
```

**Step 7 — Create subscriptions**
```bash
POST /api/family-intel/setup
{ "source": "microsoft" }
```
Or click "Setup Microsoft" in the Family Intel UI.

### Subscription Renewal
Subscriptions must be renewed before expiry. Recommended: run `POST /api/family-intel/setup { "source": "microsoft" }` on a cron job every 2 days.

---

## Source 3: Google Push Notifications

### How it works
Google Calendar and Drive support "watch channels" — you register a channel pointing to this server, and Google POSTs a notification whenever the watched resource changes. Google does NOT include the changed data in the notification — it only signals "something changed." The receiver then fetches the actual changed items via the Google API.

The Google OAuth credentials are already configured (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and refresh tokens for Mike + Erin).

### What you get
| Resource | What you see |
|---|---|
| Google Calendar (Mike) | Event create/update/delete with title, time, attendees |
| Google Calendar (Erin) | Same — both Google accounts wired |
| Google Drive (Mike) | File modified — name, type, timestamp |
| Google Drive (Erin) | Same |
| Gmail (future) | Inbox change signal (requires additional Pub/Sub setup) |

### Limitations
- Google only tells you "something changed" — we have to fetch to find out what
- Watch channels expire after 7 days maximum — must be renewed
- Kids' accounts (Liam/Clara) don't have Google refresh tokens configured
- Gmail push requires Cloud Pub/Sub (GCP) — more complex setup, not wired yet
- Drive watch tells you files changed but not the file content

### Setup Steps

**Step 1 — Add webhook secret to .env.local**
```env
GOOGLE_WEBHOOK_SECRET=family-intel-google-2026
```

**Step 2 — Expose locally** (same as Microsoft — set `WEBHOOK_BASE_URL`)

**Step 3 — Create watch channels**
```bash
POST /api/family-intel/setup
{ "source": "google" }
```
Or click "Setup Google" in the Family Intel UI.

This creates Calendar + Drive watch channels for Mike and Erin.

### Channel Renewal
Watch channels expire after 7 days. Run `POST /api/family-intel/setup { "source": "google" }` every 6 days to renew.

---

## API Reference

### Events
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/family-intel/events` | Get events (filters: `person`, `source`, `category`, `severity`, `since`, `limit`) |
| `POST` | `/api/family-intel/events` | Add a manual event |
| `DELETE` | `/api/family-intel/events?all=true` | Clear all events |
| `DELETE` | `/api/family-intel/events?id=xxx` | Delete one event |

### Ingestion
| Method | Endpoint | Description |
|---|---|---|
| `GET/POST` | `/api/family-intel/ingest/pihole` | Poll Pi-hole and create events |
| `GET` | `/api/family-intel/ingest/pihole?reset=1` | Reset cursor to re-scan all history |
| `GET/POST` | `/api/family-intel/ingest/microsoft` | Microsoft Graph webhook receiver |
| `POST` | `/api/family-intel/ingest/google` | Google push notification receiver |

### Setup & Status
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/family-intel/setup` | Status of all sources and subscriptions |
| `POST` | `/api/family-intel/setup` | Create/renew subscriptions (`{ "source": "microsoft"|"google"|"all" }`) |
| `DELETE` | `/api/family-intel/setup?id=xxx` | Cancel a subscription |

### Report
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/family-intel/report` | Full structured capability report with event stats |

---

## Data Files

| File | Purpose |
|---|---|
| `data/family-intel-events.json` | Unified event store (up to 10,000 events) |
| `data/family-intel-devices.json` | IP → person device map (edit this to add your devices) |
| `data/family-intel-subscriptions.json` | Active MS/Google webhook subscriptions |
| `data/family-intel-pihole-cursor.json` | Timestamp cursor for Pi-hole polling |

---

## Environment Variables

```env
# Required for Microsoft Graph
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_MIKE_USER_ID=
MS_ERIN_USER_ID=            # optional
MS_WEBHOOK_SECRET=family-intel-2026

# Required for Google push (credentials already set; just add these)
GOOGLE_WEBHOOK_SECRET=family-intel-google-2026

# Required for both Microsoft + Google webhooks
WEBHOOK_BASE_URL=           # e.g. https://xxxx.ngrok-free.app

# Already configured — Pi-hole works immediately
PIHOLE_HOST=192.168.1.46
PIHOLE_PORT=8090
PIHOLE_PASS=cutillo1
```

---

## What You Cannot Do (Honest Assessment)

| Capability | Why Not |
|---|---|
| Read email body/subject | Microsoft + Google protect email content — only activity signals |
| See inside HTTPS traffic | TLS encryption — DNS layer only sees the domain |
| Apple Family Link controls | No public API. Apple provides zero programmatic access to Screen Time or Family Link. MDM enrollment is the only path. |
| Real-time alerts/push to Discord | Not built yet — add a Discord webhook call to `appendEvents()` for high-severity events |
| Kids' Google accounts (Liam/Clara) | No refresh tokens configured — add if they have Google accounts |
| Detect VPN bypass | If a device uses a VPN, Pi-hole doesn't see its traffic |
| iCloud calendar for Erin/Liam/Clara | iCloud CalDAV credentials not configured in .env.local |

---

## What's Next (Future Enhancements)

1. **Discord alerts** — POST to `DISCORD_WH_SCREEN_TIME` when a blocked domain is hit or severity=alert
2. **Bedtime enforcement** — cross-reference Pi-hole activity time vs. calendar "bedtime" events
3. **Weekly summary report** — aggregate stats for the week, posted to Discord Monday morning
4. **iCloud CalDAV** — already partially wired in household-calendar; extend to Family Intel
5. **Gmail push via Pub/Sub** — complete the Gmail watch setup using GCP Cloud Pub/Sub
6. **MDM enrollment** — for real Screen Time data from Apple devices (biggest unlock)
7. **Auto-renewal cron** — scheduled task to renew expiring subscriptions automatically
8. **Anomaly detection** — flag when a device is active during school/sleep hours

---

*Generated by Family Intel v1.0.0 — Mission Control, Cutillo AI OS*
