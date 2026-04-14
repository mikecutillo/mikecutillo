/**
 * browser — Playwright persistent context singleton.
 *
 * Every apply run reuses the same persistent Chromium profile at
 * `mission-control/.playwright-profile/` (gitignored). This keeps
 * LinkedIn/Workday/Greenhouse cookies alive between applies so Mike
 * only has to log in once per site. It's also what lets the apply
 * worker run without any daily manual step.
 *
 * We deliberately use `chromium.launchPersistentContext` instead of
 * `launch` + `newContext` because we DO want cookies, localStorage,
 * and service-worker caches to persist across runs. The tradeoff is
 * that only one context can point at that directory at a time — if
 * we ever need parallelism, each parallel instance needs its own
 * profile subdirectory.
 *
 * Headed by default. Per the plan's risk mitigation: "behave like a
 * careful human — no parallelism, no headless, no raw API calls."
 */

import { chromium, BrowserContext, Page } from 'playwright'
import path from 'path'
import fs from 'fs/promises'
import { loadConfig } from './config'

let ctxSingleton: BrowserContext | null = null

const MISSION_CONTROL_ROOT = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control'

async function ensureProfileDir(dir: string): Promise<string> {
  const abs = path.isAbsolute(dir) ? dir : path.join(MISSION_CONTROL_ROOT, dir)
  await fs.mkdir(abs, { recursive: true })
  return abs
}

export interface BrowserSession {
  context: BrowserContext
  page: Page
}

/**
 * Open (or reuse) the persistent context and return a fresh page.
 *
 * Reusing the context means earlier pages may still be open from a
 * prior apply — we always open a new one so each apply has a clean
 * slate, then close it in `releaseSession`.
 */
export async function openSession(): Promise<BrowserSession> {
  const cfg = await loadConfig()
  if (!ctxSingleton) {
    const profileDir = await ensureProfileDir(cfg.persistentProfileDir)
    ctxSingleton = await chromium.launchPersistentContext(profileDir, {
      headless: cfg.defaultHeadless,
      viewport: { width: 1280, height: 900 },
      // A realistic desktop UA — don't leak the Playwright default which
      // some sites fingerprint on.
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })
  }
  const page = await ctxSingleton.newPage()
  return { context: ctxSingleton, page }
}

/**
 * Close the page without killing the context. The persistent context
 * stays alive across the Next.js process so subsequent applies don't
 * pay relaunch cost.
 */
export async function releaseSession(session: BrowserSession): Promise<void> {
  try {
    await session.page.close()
  } catch {
    // already closed
  }
}

/**
 * Close the browser entirely. Called only on dev-server shutdown or
 * when the profile needs to be swapped out.
 */
export async function closeBrowser(): Promise<void> {
  if (ctxSingleton) {
    try {
      await ctxSingleton.close()
    } catch {
      // ignore
    }
    ctxSingleton = null
  }
}

/**
 * Is there an active persistent context? Used by the LinkedIn login
 * helper to decide whether to spin up a new window or reuse an
 * existing one.
 */
export function isBrowserOpen(): boolean {
  return ctxSingleton !== null
}
