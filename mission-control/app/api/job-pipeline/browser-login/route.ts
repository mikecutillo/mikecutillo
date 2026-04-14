/**
 * browser-login — one-time interactive login for sites that need a
 * session cookie the worker can't bootstrap on its own (primarily
 * LinkedIn — 2FA/captcha makes scripted login too fragile for a
 * "walk away" UX).
 *
 * Flow:
 *   POST { site: 'linkedin' | 'workday' | ... }
 *   → Launches the persistent Playwright context headed
 *   → Navigates to the site's login URL
 *   → Returns 200 { ok, note } immediately
 *   → Leaves the browser window open so Mike can finish logging in
 *   → Cookies persist into `.playwright-profile/` the moment the
 *     login completes — the next apply run reuses them
 *
 * The browser stays open indefinitely. A follow-up POST
 * { site, close: true } closes the session once Mike has confirmed
 * he's logged in, or the worker's next apply call will reuse the
 * context as-is.
 */

import { NextRequest, NextResponse } from 'next/server'
import { openSession, releaseSession, closeBrowser } from '@/lib/apply-worker/browser'

const LOGIN_URLS: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/login',
  workday: 'https://www.myworkday.com/',
  greenhouse: 'https://boards.greenhouse.io/',
  lever: 'https://hire.lever.co/login',
  ashby: 'https://app.ashbyhq.com/login',
  icims: 'https://login.icims.com/',
}

export async function POST(req: NextRequest) {
  let body: { site?: string; close?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { site, close } = body
  if (!site) {
    return NextResponse.json({ error: 'site required' }, { status: 400 })
  }

  if (close) {
    await closeBrowser()
    return NextResponse.json({
      ok: true,
      note: 'Browser closed. Session cookies are persisted.',
    })
  }

  const loginUrl = LOGIN_URLS[site.toLowerCase()]
  if (!loginUrl) {
    return NextResponse.json(
      { error: `Unknown site "${site}". Supported: ${Object.keys(LOGIN_URLS).join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const session = await openSession()
    await session.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // Intentionally do NOT close the page — Mike needs time to sign in.
    // The persistent context captures cookies as soon as the login
    // completes. We return immediately so the UI doesn't block.
    void session // keep reference alive for the lifetime of the context
    return NextResponse.json({
      ok: true,
      note: `Browser opened at ${loginUrl}. Sign in — cookies persist automatically.`,
      site,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Could not open browser: ${msg}` },
      { status: 500 },
    )
  }
}

/**
 * GET — small probe for the UI to know whether a login session is
 * already active (so Settings can show "Log In" vs "Re-log In").
 */
export async function GET() {
  const { isBrowserOpen } = await import('@/lib/apply-worker/browser')
  return NextResponse.json({ active: isBrowserOpen() })
}

// Prevent releaseSession from becoming dead-code in a tree-shake pass:
// the browser-login flow deliberately doesn't call it, but the import
// keeps the module graph stable for callers that DO release sessions.
void releaseSession
