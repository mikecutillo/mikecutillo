/**
 * iCIMS adapter — classic ATS, multi-page forms.
 *
 * iCIMS often requires an account to apply. For personal use with a
 * pre-existing account, the persistent Playwright profile carries
 * the session cookie forward. First-time use requires the one-time
 * login flow (`/api/job-pipeline/browser-login?site=icims`).
 *
 * Not every iCIMS portal is multi-page — some are single-page. We
 * call the generic filler in a small loop, paginating when we see a
 * Next button.
 */

import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { fillFormOnce, clickSubmit } from './generic'
import { humanPause, pageTransitionPause } from '../human-pause'

const icimsAdapter: SiteAdapter = {
  name: 'icims',
  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.includes('icims.com')
    } catch {
      return false
    }
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, setPhase, config } = ctx
    setPhase('opening-site', 'Opening iCIMS portal')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    // iCIMS sometimes shows an "Apply for this job" button before the
    // form.
    for (const sel of ['button:has-text("Apply")', 'a:has-text("Apply")']) {
      const btn = await page.$(sel)
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click()
        await pageTransitionPause(config)
        break
      }
    }

    setPhase('filling-form', 'Filling iCIMS form')
    let step = 0
    while (step < 6) {
      step++
      try {
        const filled = await fillFormOnce(ctx)
        // Even if zero fields filled, we may still be at a "Next"
        // gate — so we always try to advance.
        void filled
      } catch (err) {
        return { status: 'failed', message: (err as Error).message }
      }

      // Check for submit button first
      const submittable = await page.$('button:has-text("Submit")')
      if (submittable && (await submittable.isVisible().catch(() => false))) {
        setPhase('submitting', 'Clicking Submit')
        const clicked = await clickSubmit(ctx, ['button:has-text("Submit")'])
        if (!clicked) return { status: 'failed', message: 'iCIMS: submit not clickable' }
        await page.waitForTimeout(3_000)
        return {
          status: 'applied',
          message: 'Submitted via iCIMS',
          submittedAt: new Date().toISOString(),
        }
      }

      // Otherwise click Next/Continue
      const nextBtn = await page.$('button:has-text("Next"), button:has-text("Continue")')
      if (!nextBtn) {
        return { status: 'failed', message: `iCIMS: no Next/Submit at step ${step}` }
      }
      await humanPause(config)
      await nextBtn.click()
      await pageTransitionPause(config)
    }

    return { status: 'failed', message: 'iCIMS: exceeded 6 steps' }
  },
}

export default icimsAdapter
