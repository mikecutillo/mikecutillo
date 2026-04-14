/**
 * Greenhouse adapter — single-page application form.
 *
 * Greenhouse-hosted forms live on `*.greenhouse.io` with a predictable
 * `/embed/job_app` or direct `/jobs/` layout. The form has a file
 * input for the resume, text inputs for contact info, and a list of
 * screening questions. No multi-step wizard — one submit click.
 */

import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { fillFormOnce, clickSubmit } from './generic'
import { pageTransitionPause } from '../human-pause'

const greenhouseAdapter: SiteAdapter = {
  name: 'greenhouse',
  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.includes('greenhouse.io') || u.hostname.includes('boards.greenhouse.io')
    } catch {
      return false
    }
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, setPhase, config } = ctx
    setPhase('opening-site', 'Opening Greenhouse form')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    setPhase('filling-form', 'Filling application form')
    try {
      const filled = await fillFormOnce(ctx)
      if (filled === 0) {
        return { status: 'failed', message: 'Greenhouse: no fillable fields detected' }
      }
    } catch (err) {
      return { status: 'failed', message: (err as Error).message }
    }

    setPhase('submitting', 'Clicking Submit')
    const clicked = await clickSubmit(ctx, [
      'input[type="submit"][value*="Submit"]',
      'button:has-text("Submit Application")',
    ])
    if (!clicked) return { status: 'failed', message: 'Greenhouse: submit button not found' }
    await page.waitForTimeout(3_000)
    return {
      status: 'applied',
      message: 'Submitted via Greenhouse',
      submittedAt: new Date().toISOString(),
    }
  },
}

export default greenhouseAdapter
