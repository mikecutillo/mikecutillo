/**
 * Lever adapter — `*.lever.co` hosted application forms.
 *
 * Lever forms share Greenhouse's flat structure: one page, one submit.
 * The main difference is the resume upload is usually labeled
 * "Upload a file" with `name="resume"`.
 */

import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { fillFormOnce, clickSubmit } from './generic'
import { pageTransitionPause } from '../human-pause'

const leverAdapter: SiteAdapter = {
  name: 'lever',
  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.includes('lever.co') || u.hostname.includes('jobs.lever.co')
    } catch {
      return false
    }
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, setPhase, config } = ctx
    setPhase('opening-site', 'Opening Lever form')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    // Lever landings sometimes have an "Apply for this job" button
    // ahead of the form — click it if present.
    const applyBtn = await page.$('a:has-text("Apply for this job"), button:has-text("Apply for this job")')
    if (applyBtn && (await applyBtn.isVisible().catch(() => false))) {
      await applyBtn.click()
      await pageTransitionPause(config)
    }

    setPhase('filling-form', 'Filling application form')
    try {
      const filled = await fillFormOnce(ctx)
      if (filled === 0) {
        return { status: 'failed', message: 'Lever: no fillable fields detected' }
      }
    } catch (err) {
      return { status: 'failed', message: (err as Error).message }
    }

    setPhase('submitting', 'Clicking Submit')
    const clicked = await clickSubmit(ctx, [
      'button:has-text("Submit application")',
    ])
    if (!clicked) return { status: 'failed', message: 'Lever: submit button not found' }
    await page.waitForTimeout(3_000)
    return {
      status: 'applied',
      message: 'Submitted via Lever',
      submittedAt: new Date().toISOString(),
    }
  },
}

export default leverAdapter
