#!/usr/bin/env node
/**
 * Office Hours Recap mailer
 * --------------------------
 * Attaches to an already-signed-in Microsoft Edge (via the DevTools/CDP port),
 * finds the Outlook-on-the-web COMPOSE window that Teams' "Send to email" opened,
 * and fills in:
 *    - Subject:  Office Hours | MM/DD/YYYY Recap w/ recording
 *    - To:       mcutillo@velocityhcm.com
 *    - Bcc:      everyone in office-hours-bcc-raw.txt   (skipped in --test)
 * then optionally clicks Send.
 *
 * WHY THIS DESIGN:
 *   You do the 3 fragile Teams clicks by hand (View recap -> Share v -> Send to email).
 *   This script only automates the stable, tedious part (subject + 95 Bcc + send) inside
 *   Outlook on the web, whose accessible labels are far more stable than the Teams recap UI.
 *
 * USAGE (PowerShell / cmd, from this folder):
 *   1) Launch Edge with the automation profile + debug port (use start-edge-debug.bat).
 *   2) In that Edge: sign into Teams + Outlook, open the channel, click the recap,
 *      Share v -> "Send to email"  (an Outlook compose tab opens).
 *   3) Run:   node send-recap.js --test            (fills To=you, NO bcc, does NOT send)
 *      then:  node send-recap.js --test --send      (same, but clicks Send)
 *      live:  node send-recap.js --date 06/23/2026 --send   (To + full Bcc + send)
 *
 * UNATTENDED (scheduled, no human clicks) -- drives Teams too:
 *   node send-recap.js --auto --meeting-url "<recap/meeting url>" --send
 *   (Add --test first to send only to mcutillo with no Bcc.)
 *
 * FLAGS:
 *   --test            Test mode: To = mcutillo only, Bcc skipped. (recommended first)
 *   --send            Actually click Send. Without it, the script fills + stops for review.
 *   --auto            Unattended: script clicks View recap -> Share -> Send to email itself.
 *   --meeting-url <u> Required with --auto. The Teams recap/meeting link to open.
 *   --require-body / --no-require-body
 *                     Refuse to send if the body is empty (default ON in --auto).
 *   --screenshot-dir  Where failure screenshots go. Default ./logs
 *   --date MM/DD/YYYY Date shown in the subject. Default = most recent Tuesday.
 *   --to <email>      Override the To recipient. Default mcutillo@velocityhcm.com.
 *   --port <n>        CDP port Edge is listening on. Default 9222.
 *   --bcc-file <path> Path to the raw bcc list. Default ./office-hours-bcc-raw.txt
 *   --keep-open       Leave the browser attached after finishing (default detaches).
 *
 * EXIT CODES: 0 ok | 2 no Edge | 3 no compose tab | 4 Teams nav failed | 5 empty body
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// ----------------------------- args -----------------------------
function parseArgs(argv) {
  const a = { test: false, send: false, port: 9222, to: 'mcutillo@velocityhcm.com',
              date: null, bccFile: path.join(__dirname, 'office-hours-bcc-raw.txt'),
              keepOpen: false, auto: false, meetingUrl: null,
              screenshotDir: path.join(__dirname, 'logs'), requireBody: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--test') a.test = true;
    else if (t === '--send') a.send = true;
    else if (t === '--keep-open') a.keepOpen = true;
    else if (t === '--auto') a.auto = true;
    else if (t === '--meeting-url') a.meetingUrl = argv[++i];
    else if (t === '--screenshot-dir') a.screenshotDir = argv[++i];
    else if (t === '--no-require-body') a.requireBody = false;
    else if (t === '--require-body') a.requireBody = true;
    else if (t === '--date') a.date = argv[++i];
    else if (t === '--to') a.to = argv[++i];
    else if (t === '--port') a.port = parseInt(argv[++i], 10);
    else if (t === '--bcc-file') a.bccFile = argv[++i];
    else if (t === '--help' || t === '-h') { printHelp(); process.exit(0); }
    else console.warn(`(!) ignoring unknown arg: ${t}`);
  }
  // In unattended --auto mode, default to refusing to send an empty body.
  if (a.requireBody === null) a.requireBody = a.auto;
  return a;
}
function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n')
    .filter(l => l.startsWith(' *') || l.startsWith('/**')).join('\n'));
}

// ------------------------- date helper --------------------------
// Most recent Tuesday (today counts if today is Tuesday). Returns MM/DD/YYYY.
function mostRecentTuesday(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();            // 0=Sun..6=Sat ; Tuesday = 2
  const diff = (day - 2 + 7) % 7;    // days back to Tuesday
  d.setDate(d.getDate() - diff);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// ------------------------- bcc parsing --------------------------
// Pull every RFC-ish email out of the raw "Name <addr>; bare@addr; ..." blob, dedupe.
function loadBccEmails(file) {
  if (!fs.existsSync(file)) {
    console.warn(`(!) bcc file not found: ${file} -> Bcc will be empty`);
    return [];
  }
  const raw = fs.readFileSync(file, 'utf8');
  const re = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const seen = new Set();
  const out = [];
  for (const m of raw.match(re) || []) {
    const key = m.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(m); }
  }
  return out;
}

// ---------------------- locator utilities -----------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Try a list of locator factories; return the first that becomes visible.
async function firstVisible(page, factories, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const make of factories) {
      try {
        const loc = make();
        if (await loc.first().isVisible().catch(() => false)) return loc.first();
      } catch (_) { /* keep trying */ }
    }
    await sleep(250);
  }
  return null;
}

// Find the Outlook compose page among all attached pages (poll, since the user
// opens it by hand a moment before/after launching this script).
async function findComposePage(browser, timeout = 60000) {
  const deadline = Date.now() + timeout;
  const looksLikeCompose = async (page) => {
    const url = page.url() || '';
    if (!/outlook\.(office|office365)\.com|outlook\.live\.com/i.test(url)) return false;
    const subj = await firstVisible(page, [
      () => page.getByRole('textbox', { name: /add a subject|^subject$/i }),
      () => page.locator('input[aria-label*="subject" i]'),
    ], 1500);
    return !!subj;
  };
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      for (const page of ctx.pages()) {
        try { if (await looksLikeCompose(page)) return page; } catch (_) {}
      }
    }
    process.stdout.write('.');
    await sleep(1000);
  }
  return null;
}

// Type recipients into an Outlook recipient well (To or Bcc).
async function fillRecipients(page, field, emails) {
  if (!emails.length) return 0;
  // Reveal Bcc row if needed.
  if (field === 'Bcc') {
    const bccToggle = await firstVisible(page, [
      () => page.getByRole('button', { name: /^bcc$/i }),
      () => page.getByText(/^Bcc$/),
    ], 3000);
    if (bccToggle) { await bccToggle.click().catch(() => {}); await sleep(400); }
  }
  const well = await firstVisible(page, [
    () => page.getByRole('textbox', { name: new RegExp(`^${field}$`, 'i') }),
    () => page.locator(`div[aria-label="${field}"] input`),
    () => page.locator(`[aria-label^="${field}"][role="textbox"]`),
  ], 8000);
  if (!well) {
    console.warn(`(!) Could not locate the ${field} field automatically.`);
    return -1;
  }
  let added = 0;
  for (const email of emails) {
    await well.click();
    await well.type(email, { delay: 5 });
    await page.keyboard.press('Enter');   // commit the chip
    await sleep(120);                      // let Outlook resolve/render the pill
    added++;
    if (added % 20 === 0) process.stdout.write(`  ..${added}/${emails.length}\n`);
  }
  return added;
}

async function setSubject(page, subject) {
  const subj = await firstVisible(page, [
    () => page.getByRole('textbox', { name: /add a subject|^subject$/i }),
    () => page.locator('input[aria-label*="subject" i]'),
  ], 8000);
  if (!subj) { console.warn('(!) Subject field not found.'); return false; }
  await subj.click();
  await subj.fill('');             // clear "Recap..." default if any
  await subj.type(subject, { delay: 5 });
  return true;
}

async function clickSend(page) {
  const send = await firstVisible(page, [
    () => page.getByRole('button', { name: /^send$/i }),
    () => page.locator('button[aria-label="Send"]'),
  ], 6000);
  if (send) { await send.click(); return true; }
  // Fallback: Outlook's keyboard shortcut.
  await page.keyboard.press('Control+Enter');
  return true;
}

// Read the current text of the Outlook compose body (to guard against blank sends).
async function getBodyText(page) {
  const body = await firstVisible(page, [
    () => page.getByRole('textbox', { name: /message body|^body$/i }),
    () => page.locator('div[aria-label*="message body" i][contenteditable="true"]'),
    () => page.locator('[role="textbox"][contenteditable="true"]'),
  ], 4000);
  if (!body) return '';
  return (await body.innerText().catch(() => '')).trim();
}

// Best-effort timestamped screenshot for unattended failure diagnosis.
async function snap(page, dir, label) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}_${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`   (screenshot) ${file}`);
    return file;
  } catch (e) { return null; }
}

// ---------------- unattended Teams -> "Send to email" -----------------
// Drives the fragile Teams side end-to-end so no human click is needed:
//   open meeting/recap URL -> View recap -> Share (caret) -> Send to email.
// The resulting Outlook compose tab (with recap NOTES text pre-filled) is then
// picked up by findComposePage(). Heavily logged + screenshots on failure,
// because these selectors are unverified against the live Teams UI and WILL be
// the first thing to tune from a real run.
async function openRecapAndSendToEmail(browser, meetingUrl, screenshotDir) {
  if (!meetingUrl) {
    throw new Error('--auto requires --meeting-url <the recurring meeting/recap link>. ' +
      'Open the Office Hours recap once in Teams web and copy the URL from the address bar.');
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  console.log('Opening meeting URL', meetingUrl);
  await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(4000); // Teams web is slow to hydrate

  // Detect a re-auth wall (session expired) and fail clearly rather than hang.
  if (/login\.microsoftonline\.com|login\.live\.com/i.test(page.url())) {
    await snap(page, screenshotDir, 'reauth-needed');
    throw new Error('Teams/Outlook session expired -> a sign-in/MFA page appeared. ' +
      'Sign in once in the automation Edge, then the schedule resumes.');
  }

  // 1) View recap (may already be on the recap page; if so this is a no-op).
  const viewRecap = await firstVisible(page, [
    () => page.getByRole('button', { name: /view recap/i }),
    () => page.getByRole('link', { name: /view recap/i }),
    () => page.getByText(/^view recap$/i),
  ], 12000);
  if (viewRecap) {
    console.log('Clicking "View recap"');
    await viewRecap.click().catch(() => {});
    await sleep(4000);
  } else {
    console.log('(i) No "View recap" button found - assuming already on the recap page.');
  }

  // 2) Open the Share dropdown (the caret next to Share).
  const shareCaret = await firstVisible(page, [
    () => page.getByRole('button', { name: /share options|more share|share.*menu/i }),
    () => page.getByRole('button', { name: /^share$/i }),
    () => page.getByText(/^share$/i),
  ], 12000);
  if (!shareCaret) {
    await snap(page, screenshotDir, 'no-share-button');
    throw new Error('Could not find the Share control on the recap page (see screenshot).');
  }
  console.log('Opening Share menu');
  await shareCaret.click().catch(() => {});
  await sleep(1500);

  // 3) "Send to email" item.
  const sendToEmail = await firstVisible(page, [
    () => page.getByRole('menuitem', { name: /send to email|send.*email|email/i }),
    () => page.getByRole('button', { name: /send to email/i }),
    () => page.getByText(/send to email/i),
  ], 8000);
  if (!sendToEmail) {
    await snap(page, screenshotDir, 'no-send-to-email');
    throw new Error('Could not find "Send to email" in the Share menu (see screenshot).');
  }
  console.log('Clicking "Send to email" (opens Outlook compose)');
  await sendToEmail.click().catch(() => {});
  await sleep(4000);
  return page;
}

// ------------------------------ main ----------------------------
(async () => {
  const args = parseArgs(process.argv);
  const dateStr = args.date || mostRecentTuesday();
  const subject = `Office Hours | ${dateStr} Recap w/ recording`;
  const bccAll = args.test ? [] : loadBccEmails(args.bccFile);

  console.log('\n=== Office Hours Recap mailer ===');
  console.log(`Flow      : ${args.auto ? 'AUTO (drives Teams too)' : 'ASSISTED (you open the recap email)'}`);
  console.log(`Mode      : ${args.test ? 'TEST (To only, no Bcc)' : 'LIVE (To + full Bcc)'}`);
  console.log(`Subject   : ${subject}`);
  console.log(`To        : ${args.to}`);
  console.log(`Bcc count : ${bccAll.length}`);
  console.log(`Will send : ${args.send ? 'YES (will click Send)' : 'no (fill + review only)'}`);
  console.log(`CDP port  : ${args.port}\n`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${args.port}`);
  } catch (e) {
    console.error(`\n(X) Could not attach to Edge on port ${args.port}.`);
    console.error('    Launch Edge first with start-edge-debug.bat (or pass --port).');
    console.error(`    Detail: ${e.message}`);
    process.exit(2);
  }

  // AUTO: script does the Teams clicks so the Outlook compose opens by itself.
  if (args.auto) {
    try {
      await openRecapAndSendToEmail(browser, args.meetingUrl, args.screenshotDir);
    } catch (e) {
      console.error(`\n(X) Teams automation failed: ${e.message}`);
      if (!args.keepOpen) await browser.close().catch(() => {});
      process.exit(4);
    }
  }

  console.log('Looking for the Outlook compose tab');
  const page = await findComposePage(browser, 60000);
  if (!page) {
    console.error('\n(X) No Outlook compose window found.');
    console.error('    In the debug Edge: open the recap, Share v -> "Send to email",');
    console.error('    then re-run this script.');
    if (!args.keepOpen) await browser.close().catch(() => {});
    process.exit(3);
  }
  console.log('\nFound compose tab:', page.url());
  await page.bringToFront().catch(() => {});

  const okSubject = await setSubject(page, subject);
  const toCount = await fillRecipients(page, 'To', [args.to]);
  let bccCount = 0;
  if (bccAll.length) {
    console.log(`Adding ${bccAll.length} Bcc recipients`);
    bccCount = await fillRecipients(page, 'Bcc', bccAll);
  }

  console.log('\n--- fill summary ---');
  console.log(`subject set : ${okSubject ? 'yes' : 'NO (check manually)'}`);
  console.log(`To added    : ${toCount}`);
  console.log(`Bcc added   : ${args.test ? '(skipped - test mode)' : bccCount}`);

  // Fail-safe: never send an empty recap when running unattended.
  if (args.send && args.requireBody) {
    const bodyLen = (await getBodyText(page)).length;
    console.log(`body length : ${bodyLen} chars`);
    if (bodyLen < 20) {
      await snap(page, args.screenshotDir, 'empty-body-abort');
      console.error('\n(X) Compose body looks empty (< 20 chars) - the recap text did not load.');
      console.error('    Refusing to send a blank recap. Nothing was sent.');
      console.error('    (Override with --no-require-body if you really mean to.)');
      if (!args.keepOpen) await browser.close().catch(() => {});
      process.exit(5);
    }
  }

  if (args.send) {
    console.log('\nClicking Send');
    await clickSend(page);
    await sleep(1500);
    console.log('Send clicked. Verify in Outlook Sent Items.');
  } else {
    console.log('\nFilled but NOT sent (no --send). Review the compose window, then');
    console.log('either click Send yourself or re-run with --send.');
  }

  if (!args.keepOpen) {
    // Detach only; do NOT close the user's Edge.
    await browser.close().catch(() => {});
  }
  console.log('\nDone.\n');
})().catch(err => {
  console.error('\n(X) Unexpected error:', err);
  process.exit(1);
});
