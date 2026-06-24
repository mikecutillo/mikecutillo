# Office Hours Recap mailer

Semi-automated mailer for the **iCIMS Office Hours with Velocity HCM** (Tuesdays 4 PM) Teams recap.

It drives **Outlook on the web** through your **already-signed-in Microsoft Edge** using Playwright.
You do the three quick Teams clicks by hand; the script does the tedious, error-prone part —
the subject, the recipient, and Bcc-ing all ~95 people from the distribution list — then sends.

## Why it's split this way

Logging a cloud robot into your corporate Microsoft tenant isn't possible (password + MFA +
conditional access). So instead this runs **on your machine**, attaching to a real Edge window
where **you** are already signed in. And rather than fight the fragile Teams "recap" UI, the
script only takes over once Outlook's compose window is open — those fields have stable
accessibility labels, so automation there is reliable.

```
You (manual, ~5s):  Teams -> View recap -> Share v -> Send to email
Script (automated):  Outlook compose -> Subject + To + Bcc(95) -> Send
```

## One-time setup (Windows + Edge)

1. **Install Node.js** (https://nodejs.org, LTS). Verify in a terminal: `node -v`.
2. In this folder, install deps:
   ```
   npm install
   ```
   (Playwright is used only to *attach* to your Edge — it does not download a separate browser
   for this flow.)
3. **Launch the automation Edge** by double-clicking **`start-edge-debug.bat`**.
   - This opens a separate Edge profile (`%USERPROFILE%\EdgeAutomationProfile`) with the debug
     port enabled. It does **not** disturb your normal Edge.
   - **Sign into Teams and Outlook** in this window (do MFA once). You stay signed in for future weeks.

## Weekly run

1. Make sure the **automation Edge** (from `start-edge-debug.bat`) is open and signed in.
2. In it: open the **iCIMS Office Hours** channel → click the meeting → **View recap** →
   click the **caret (˅) next to Share** → **Send to email**.
   An **Outlook compose tab** opens with the recap content in the body.
3. In a terminal in this folder, run one of:

   ```bat
   :: TEST — To = you only, NO bcc, fills but does NOT send (review it yourself)
   node send-recap.js --test --date 06/23/2026

   :: TEST + actually send it (still only to mcutillo@velocityhcm.com)
   node send-recap.js --test --date 06/23/2026 --send

   :: LIVE — To = you, Bcc = full list, and send
   node send-recap.js --date 06/23/2026 --send
   ```

If you omit `--date`, it uses the **most recent Tuesday** automatically, so a normal Wednesday
run is just `node send-recap.js --send`.

## Flags

| Flag | Meaning |
|------|---------|
| `--test` | To = `mcutillo@velocityhcm.com` only, **Bcc skipped**. Use this first. |
| `--send` | Actually click **Send**. Without it, the script fills the email and stops so you can eyeball it. |
| `--date MM/DD/YYYY` | Date in the subject. Default = most recent Tuesday. |
| `--to <email>` | Override the To recipient. |
| `--port <n>` | CDP port (default `9222`, matches the .bat). |
| `--bcc-file <path>` | Path to the raw Bcc list (default `office-hours-bcc-raw.txt`). |
| `--keep-open` | Stay attached after finishing. |

## What gets produced

- **Subject:** `Office Hours | MM/DD/YYYY Recap w/ recording`
- **To:** `mcutillo@velocityhcm.com`
- **Bcc:** every email parsed from `office-hours-bcc-raw.txt` (deduped) — skipped in `--test`
- **Body:** whatever Teams' "Send to email" pre-populated (the recap + recording link) — left untouched.

## The Bcc list

`office-hours-bcc-raw.txt` holds the raw `Name <addr>; ...` distribution list. The script
extracts and de-duplicates the email addresses at runtime, so you can paste an updated list in
without reformatting. To preview what it will parse:

```
node -e "const f=require('./send-recap.js')" 2>NUL & node -e "console.log(require('fs').readFileSync('office-hours-bcc-raw.txt','utf8').match(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g).length+' emails')"
```

## Troubleshooting

- **"Could not attach to Edge on port 9222"** — the automation Edge isn't running. Launch
  `start-edge-debug.bat` first. If you changed the port, pass `--port`.
- **"No Outlook compose window found"** — you haven't opened the recap email yet. Do the Teams
  steps (Share ˅ → Send to email) so the Outlook compose tab is open, then re-run.
- **"Could not locate the To/Bcc field"** — Outlook's layout changed. The recipient pills can be
  added by hand; or update the selectors in `fillRecipients()` (they key off the field's
  accessible name, e.g. `To` / `Bcc`).
- **MFA keeps prompting** — make sure you launched via the .bat (dedicated persistent profile).
  A fresh profile each time would re-prompt.
- **Subject didn't clear** — `setSubject()` clears the field first; if Outlook re-populates it,
  re-run after the body finishes loading.

## Notes / limits

- This automates *your* authenticated browser; it is not headless and not unattended. For a fully
  hands-off weekly send you'd want Microsoft Graph (`OnlineMeetingRecording.Read`,
  `OnlineMeetingTranscript.Read`, `Mail.Send`) + a scheduled job — that needs tenant/admin consent,
  which is out of scope here.
- The script never closes your Edge; it only detaches when done (unless `--keep-open`).
- It does not modify the email body, so the recording link / AI recap that Teams inserts is preserved.
