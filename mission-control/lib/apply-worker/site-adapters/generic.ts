/**
 * generic adapter — fallback form filler for any board that doesn't
 * have a dedicated adapter.
 *
 * The fill logic is similar to LinkedIn's but without the multi-step
 * Next/Review/Submit dance. For ATS vendors that don't paginate their
 * forms (most of Greenhouse/Lever/Ashby), a single loop does the job:
 *   1. Navigate to the job URL
 *   2. Find/click the primary Apply button (heuristic)
 *   3. Fill every text/select/radio/checkbox it can label
 *   4. Click Submit
 *
 * Also serves as the shared filler that the site-specific adapters
 * delegate to after running their pre-steps (login, resume select,
 * etc). See `fillFormOnce()` below.
 */

import { Page } from 'playwright'
import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { humanPause, pageTransitionPause } from '../human-pause'

const APPLY_BUTTON_PATTERNS = [
  'button:has-text("Apply for this job")',
  'button:has-text("Apply now")',
  'button:has-text("Apply")',
  'a:has-text("Apply for this job")',
  'a:has-text("Apply now")',
  'a:has-text("Apply")',
]

const SUBMIT_BUTTON_PATTERNS = [
  'button[type="submit"]:has-text("Submit")',
  'button:has-text("Submit application")',
  'button:has-text("Submit")',
  'input[type="submit"]',
]

async function getLabelFor(page: Page, inputHandle: import('playwright').ElementHandle<Element>): Promise<string> {
  return await page.evaluate((el) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    const aria = input.getAttribute('aria-label')
    if (aria) return aria
    const id = input.id
    if (id) {
      const lbl = document.querySelector(`label[for="${id}"]`)
      if (lbl?.textContent) return lbl.textContent.trim()
    }
    let cur: Element | null = input.parentElement
    for (let i = 0; i < 6 && cur; i++) {
      const lbl = cur.querySelector('label')
      if (lbl?.textContent) return lbl.textContent.trim()
      const heading = cur.querySelector('h1, h2, h3, h4, legend')
      if (heading?.textContent && cur.contains(input)) return heading.textContent.trim()
      cur = cur.parentElement
    }
    return (input as HTMLInputElement).placeholder || input.name || ''
  }, inputHandle)
}

/**
 * Run a single pass over the page, filling whatever fields are visible
 * with answers from the bank. Returns the number of fields filled —
 * zero means we're likely done or stuck.
 *
 * Exported so site-specific adapters can call it directly after their
 * pre-steps. This is the shared body of every adapter that isn't
 * LinkedIn (which has its own multi-step state machine).
 */
export async function fillFormOnce(ctx: ApplyContext): Promise<number> {
  const { page, resolveAnswer, resumePdfPath, config } = ctx
  let filled = 0

  // File upload (if any)
  const fileInputs = await page.$$('input[type="file"]')
  for (const fi of fileInputs) {
    const name = await fi.evaluate((el) => (el as HTMLInputElement).name ?? '')
    const label = await getLabelFor(page, fi)
    const nameLower = (name + ' ' + label).toLowerCase()
    if (nameLower.includes('resume') || nameLower.includes('cv') || nameLower.includes('attachment')) {
      try {
        await fi.setInputFiles(resumePdfPath)
        filled++
        await humanPause(config)
      } catch {
        // ignore
      }
    }
  }

  // Text inputs (unfilled only)
  const textInputs = await page.$$('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea')
  for (const inp of textInputs) {
    const value = await inp.evaluate((el) => (el as HTMLInputElement).value ?? '')
    if (value && value.trim().length > 0) continue
    const label = await getLabelFor(page, inp)
    if (!label) continue
    try {
      const answer = await resolveAnswer({ question: label, fieldLabel: label, fieldType: 'text' })
      await inp.fill('')
      await inp.type(answer, { delay: 20 + Math.random() * 30 })
      filled++
      await humanPause(config)
    } catch {
      // resolveAnswer failures propagate from the orchestrator — treat
      // a thrown here as a signal to stop filling and let the caller
      // decide the outcome.
      throw new Error('field resolution cancelled')
    }
  }

  // Selects
  const selects = await page.$$('select')
  for (const sel of selects) {
    const current = await sel.evaluate((el) => (el as HTMLSelectElement).value)
    if (current) continue
    const label = await getLabelFor(page, sel)
    if (!label) continue
    const answer = await resolveAnswer({ question: label, fieldLabel: label, fieldType: 'select' })
    try {
      await sel.selectOption({ label: answer })
    } catch {
      try {
        await sel.selectOption({ value: answer })
      } catch {
        // leave unselected if nothing matches
      }
    }
    filled++
    await humanPause(config)
  }

  // Radio groups
  const radioGroups = await page.$$('fieldset:has(input[type="radio"])')
  for (const group of radioGroups) {
    const legend = await group.evaluate((el) => el.querySelector('legend')?.textContent?.trim() ?? '')
    if (!legend) continue
    const checked = await group.$('input[type="radio"]:checked')
    if (checked) continue
    const answer = await resolveAnswer({ question: legend, fieldLabel: legend, fieldType: 'radio' })
    const radios = await group.$$('input[type="radio"]')
    for (const r of radios) {
      const labelText = await r.evaluate((el) => {
        const input = el as HTMLInputElement
        if (input.id) {
          const lbl = document.querySelector(`label[for="${input.id}"]`)
          if (lbl?.textContent) return lbl.textContent.trim()
        }
        return (input.closest('label')?.textContent ?? '').trim()
      })
      if (labelText.toLowerCase().includes(answer.toLowerCase())) {
        await r.check()
        filled++
        break
      }
    }
    await humanPause(config)
  }

  // Consent checkboxes
  const checkboxes = await page.$$('input[type="checkbox"]:not(:checked)')
  for (const cb of checkboxes) {
    const label = await getLabelFor(page, cb)
    if (!label) continue
    const lower = label.toLowerCase()
    if (lower.includes('agree') || lower.includes('consent') || lower.includes('acknowledge') || lower.includes('certify')) {
      await cb.check().catch(() => {})
      filled++
      await humanPause(config)
    }
  }

  return filled
}

/**
 * Click the first matching Submit button, respecting autoSubmit.
 * Returns true if a button was clicked.
 */
export async function clickSubmit(ctx: ApplyContext, extraSelectors: string[] = []): Promise<boolean> {
  if (!ctx.config.autoSubmit) return false
  const { page } = ctx
  const selectors = [...extraSelectors, ...SUBMIT_BUTTON_PATTERNS]
  for (const sel of selectors) {
    const btn = await page.$(sel)
    if (!btn) continue
    const visible = await btn.isVisible().catch(() => false)
    if (!visible) continue
    await humanPause(ctx.config)
    await btn.click()
    return true
  }
  return false
}

const genericAdapter: SiteAdapter = {
  name: 'generic',
  canHandle(): boolean {
    return true // last-resort fallback
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, setPhase, config } = ctx
    setPhase('opening-site', 'Opening job page')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    // If the landing page has an Apply button (not the form itself),
    // click it to navigate to the form.
    for (const sel of APPLY_BUTTON_PATTERNS) {
      const btn = await page.$(sel)
      if (btn && (await btn.isVisible().catch(() => false))) {
        await humanPause(config)
        await btn.click()
        await pageTransitionPause(config)
        break
      }
    }

    setPhase('filling-form', 'Filling form fields')
    try {
      const filled = await fillFormOnce(ctx)
      if (filled === 0) {
        return { status: 'failed', message: 'No fillable fields detected — adapter did not recognize this form' }
      }
    } catch (err) {
      return { status: 'failed', message: (err as Error).message }
    }

    setPhase('submitting', 'Clicking Submit')
    const clicked = await clickSubmit(ctx)
    if (!clicked) {
      return { status: 'failed', message: 'Could not find a Submit button' }
    }
    await page.waitForTimeout(3_000)
    return {
      status: 'applied',
      message: 'Submitted via generic adapter',
      submittedAt: new Date().toISOString(),
      screenshot: await page.screenshot({ fullPage: false }).catch(() => undefined) as Buffer | undefined,
    }
  },
}

export default genericAdapter
