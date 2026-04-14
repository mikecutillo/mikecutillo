/**
 * Workday adapter — `*.myworkdayjobs.com` / `*.workday.com`.
 *
 * Workday requires a logged-in applicant profile for every tenant. The
 * persistent Playwright context carries the session cookie across
 * applies, so after the first successful login this runs with zero
 * manual steps.
 *
 * Applicant profiles on Workday retain the uploaded resume, so the
 * worker picks the saved resume from a dropdown rather than
 * re-uploading. That's why this adapter's fill logic differs from
 * LinkedIn's — there's no file input for most Workday applies.
 *
 * First-time login flow: if the session cookie is missing, the
 * adapter falls back to vault credentials. If the vault is empty
 * for this tenant, it fails with a clear message pointing at
 * Settings.
 */

import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { fillFormOnce, clickSubmit } from './generic'
import { humanPause, pageTransitionPause } from '../human-pause'
import { getCredential } from '../vault-client'

const workdayAdapter: SiteAdapter = {
  name: 'workday',
  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.includes('myworkdayjobs.com') || u.hostname.includes('workday.com')
    } catch {
      return false
    }
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, setPhase, config } = ctx
    setPhase('opening-site', 'Opening Workday job page')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    // Click "Apply" → "Apply Manually" or "Apply with Resume"
    for (const sel of [
      'button:has-text("Apply")',
      'a:has-text("Apply")',
    ]) {
      const btn = await page.$(sel)
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click()
        await pageTransitionPause(config)
        break
      }
    }
    for (const sel of [
      'button:has-text("Apply Manually")',
      'button:has-text("Autofill with Resume")',
    ]) {
      const btn = await page.$(sel)
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click()
        await pageTransitionPause(config)
        break
      }
    }

    // Detect the sign-in form. If present, fall back to vault creds.
    const signInVisible = await page.$('input[type="password"]')
    if (signInVisible) {
      setPhase('opening-site', 'Logging into Workday')
      const host = new URL(job.url).hostname
      const cred = await getCredential(host) ?? await getCredential('workday')
      if (!cred) {
        return {
          status: 'failed',
          message: `No Workday credentials in vault for ${host}. Add them in Settings → Vault.`,
        }
      }
      const usernameInput = await page.$('input[name*="userName"], input[type="email"], input[name*="email"]')
      if (usernameInput) {
        await usernameInput.fill(cred.username)
        await humanPause(config)
      }
      const passwordInput = await page.$('input[type="password"]')
      if (passwordInput) {
        await passwordInput.fill(cred.password)
        await humanPause(config)
      }
      const signInBtn = await page.$('button:has-text("Sign In"), button[type="submit"]')
      if (signInBtn) {
        await signInBtn.click()
        await pageTransitionPause(config)
      }
    }

    setPhase('filling-form', 'Filling Workday form')
    let step = 0
    while (step < 8) {
      step++
      try {
        await fillFormOnce(ctx)
      } catch (err) {
        return { status: 'failed', message: (err as Error).message }
      }

      const submitNow = await page.$('button:has-text("Submit"), button:has-text("Submit Application")')
      if (submitNow && (await submitNow.isVisible().catch(() => false))) {
        setPhase('submitting', 'Clicking Submit')
        const clicked = await clickSubmit(ctx, [
          'button:has-text("Submit Application")',
        ])
        if (!clicked) return { status: 'failed', message: 'Workday: submit not clickable' }
        await page.waitForTimeout(3_000)
        return {
          status: 'applied',
          message: 'Submitted via Workday',
          submittedAt: new Date().toISOString(),
        }
      }

      const nextBtn = await page.$('button:has-text("Save and Continue"), button:has-text("Continue"), button:has-text("Next")')
      if (!nextBtn) {
        return { status: 'failed', message: `Workday: no Next/Submit at step ${step}` }
      }
      await humanPause(config)
      await nextBtn.click()
      await pageTransitionPause(config)
    }

    return { status: 'failed', message: 'Workday: exceeded 8 steps' }
  },
}

export default workdayAdapter
