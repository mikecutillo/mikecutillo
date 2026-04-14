/**
 * Ashby adapter — `*.ashbyhq.com` and `jobs.ashbyhq.com/*`.
 *
 * Ashby uses a SPA-style form with client-side rendering and data-*
 * attributes on inputs instead of classic name/id pairs. The generic
 * filler's label heuristic still works because Ashby keeps visible
 * <label> text near each input.
 */

import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { fillFormOnce, clickSubmit } from './generic'
import { pageTransitionPause } from '../human-pause'

const ashbyAdapter: SiteAdapter = {
  name: 'ashby',
  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.includes('ashbyhq.com')
    } catch {
      return false
    }
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, setPhase, config } = ctx
    setPhase('opening-site', 'Opening Ashby form')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    // Some Ashby postings land on a detail page with an Apply button.
    const applyBtn = await page.$('button:has-text("Apply"), a:has-text("Apply")')
    if (applyBtn && (await applyBtn.isVisible().catch(() => false))) {
      await applyBtn.click()
      await pageTransitionPause(config)
    }

    setPhase('filling-form', 'Filling application form')
    try {
      const filled = await fillFormOnce(ctx)
      if (filled === 0) {
        return { status: 'failed', message: 'Ashby: no fillable fields detected' }
      }
    } catch (err) {
      return { status: 'failed', message: (err as Error).message }
    }

    setPhase('submitting', 'Clicking Submit')
    const clicked = await clickSubmit(ctx, [
      'button:has-text("Submit Application")',
    ])
    if (!clicked) return { status: 'failed', message: 'Ashby: submit button not found' }
    await page.waitForTimeout(3_000)
    return {
      status: 'applied',
      message: 'Submitted via Ashby',
      submittedAt: new Date().toISOString(),
    }
  },
}

export default ashbyAdapter
