# Running this locally with Claude Code (the "Claude drives it" setup)

The cloud Claude (claude.ai/code on the web) can't reach your Teams or touch your
screen. To have **Claude itself** run the recap copy-and-send on your machine, install
**Claude Code locally on Windows** and point it at this folder. A local session can then
launch the automation, watch it work, and fix anything live.

> Important: the automation drives a **browser** (via Playwright). So use **Teams in the
> browser** — open https://teams.microsoft.com in Edge — not the desktop Teams app.
> The recap is fully available in the browser version.

---

## 1. Install Node.js
https://nodejs.org → LTS installer → click through. Verify in a terminal:
```
node -v
```

## 2. Install Claude Code
In PowerShell:
```
npm install -g @anthropic-ai/claude-code
```
Then start it once to sign in with your Claude account:
```
claude
```
(Full/native install options: https://code.claude.com/docs)

## 3. Get this project onto your PC
Clone the repo and check out the branch with the automation:
```
git clone https://github.com/mikecutillo/mikecutillo.git
cd mikecutillo
git checkout claude/admiring-maxwell-reresm
cd office-hours-recap
npm install
```

## 4. Open your signed-in browser for the automation to attach to
Double-click **`start-edge-debug.bat`**. In that Edge window:
- Go to https://teams.microsoft.com and sign in (MFA once).
- Sign into Outlook too (https://outlook.office.com).
- Open the **iCIMS Office Hours** recap so it's on screen.

## 5. Let local Claude drive it
From the `office-hours-recap` folder, start Claude Code:
```
claude
```
Then paste this kickoff prompt:

> I'm running you locally on Windows. Microsoft Edge is open with the debug port
> (start-edge-debug.bat) and I'm signed into Teams + Outlook in it, with the iCIMS
> Office Hours recap open. Use send-recap.js to attach to that Edge over CDP, copy the
> recap notes text, and prepare the email "Office Hours | 06/23/2026 Recap w/ recording"
> to mcutillo@velocityhcm.com only (test mode, no BCC). Run it, watch what happens, and
> if any selector fails, look at the screenshot in logs\ and fix it, then retry. Show me
> the email before sending.

Local Claude can now run `node send-recap.js --test ...`, read the screenshots/logs when
something doesn't match, adjust the selectors in `send-recap.js`, and re-run — the live
debugging loop the cloud session can't do.

---

## Why local works and cloud doesn't
- **Cloud Claude:** runs in a datacenter; can't reach teams.microsoft.com (network blocked)
  and has no access to your screen or browser session.
- **Local Claude:** runs on your PC, attaches to *your* signed-in Edge, so it can genuinely
  highlight/copy the recap and fill/send the email — exactly the takeover you want.

## Notes
- Uses your existing Claude subscription; no extra paid service.
- Keep the test (`--test`) first run going only to mcutillo@velocityhcm.com before the
  full BCC send.
- If your recap is in the **desktop** Teams app, just reopen it at teams.microsoft.com in
  the debug Edge — Playwright can only drive the browser.
