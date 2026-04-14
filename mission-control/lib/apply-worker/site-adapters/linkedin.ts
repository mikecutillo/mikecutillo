/**
 * LinkedIn Easy Apply adapter.
 *
 * This is the primary target of Phase 2. The happy path is:
 *   1. Open the job URL in the persistent context (already logged in)
 *   2. Click "Easy Apply"
 *   3. Walk the multi-step form — contact → resume → questions → review
 *   4. On each step, fill every visible field via the answer-bank
 *      resolver. Unknown questions pause the worker via `resolveAnswer`.
 *   5. Click "Submit application" — auto-submit per config
 *
 * LinkedIn's DOM changes frequently, so selectors are deliberately
 * loose (text matches + role matches instead of class names).
 */

import { ApplyContext, ApplyOutcome, SiteAdapter } from './types'
import { humanPause, pageTransitionPause } from '../human-pause'

const EASY_APPLY_BUTTON_SELECTORS = [
  'button[aria-label*="Easy Apply"]',
  'button:has-text("Easy Apply")',
  '.jobs-apply-button',
]

const NEXT_BUTTON_SELECTORS = [
  'button[aria-label="Continue to next step"]',
  'button:has-text("Next")',
  'button:has-text("Continue")',
  'button:has-text("Review")',
]

const SUBMIT_BUTTON_SELECTORS = [
  'button[aria-label="Submit application"]',
  'button:has-text("Submit application")',
  'button:has-text("Submit")',
]

const RESUME_UPLOAD_SELECTORS = [
  'input[type="file"][name="file"]',
  'input[type="file"]',
]

/**
 * Extract the label associated with a form input. LinkedIn's input
 * markup varies — we try aria-label, <label for>, closest <label>,
 * then walk up to the nearest heading/fieldset.
 */
async function getFieldLabel(page: import('playwright').Page, inputHandle: import('playwright').ElementHandle<Element>): Promise<string> {
  return await page.evaluate((el) => {
    const htmlEl = el as HTMLInputElement
    const aria = htmlEl.getAttribute('aria-label')
    if (aria) return aria
    const id = htmlEl.id
    if (id) {
      const lbl = document.querySelector(`label[for="${id}"]`)
      if (lbl && lbl.textContent) return lbl.textContent.trim()
    }
    let parent: Element | null = htmlEl.parentElement
    for (let i = 0; i < 5 && parent; i++) {
      const lbl = parent.querySelector('label')
      if (lbl && lbl.textContent) return lbl.textContent.trim()
      parent = parent.parentElement
    }
    return htmlEl.placeholder || htmlEl.name || ''
  }, inputHandle)
}

const linkedinAdapter: SiteAdapter = {
  name: 'linkedin',
  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.endsWith('linkedin.com') && u.pathname.includes('/jobs/')
    } catch {
      return false
    }
  },
  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const { page, job, config, setPhase, resolveAnswer, resumePdfPath } = ctx
    setPhase('opening-site', 'Opening LinkedIn job page')
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pageTransitionPause(config)

    // Step 1 — find and click the Easy Apply button.
    setPhase('filling-form', 'Finding Easy Apply button')
    let applyBtn = null
    for (const sel of EASY_APPLY_BUTTON_SELECTORS) {
      const candidate = await page.$(sel)
      if (candidate) {
        applyBtn = candidate
        break
      }
    }
    if (!applyBtn) {
      return {
        status: 'failed',
        message: 'Easy Apply button not found — this job may not support Easy Apply',
      }
    }
    await applyBtn.click()
    await humanPause(config)

    // Step 2 — walk through the multi-step dialog. LinkedIn shows
    // Next / Review / Submit in sequence. We keep clicking Next
    // until a Submit button appears, filling any visible inputs each
    // time.
    let step = 0
    const MAX_STEPS = 12
    while (step < MAX_STEPS) {
      step++

      // Upload the PDF if there's a file input on this step.
      for (const sel of RESUME_UPLOAD_SELECTORS) {
        const fileInput = await page.$(sel)
        if (fileInput) {
          setPhase('filling-form', `Uploading resume (step ${step})`)
          try {
            await fileInput.setInputFiles(resumePdfPath)
            await humanPause(config)
          } catch {
            // LinkedIn sometimes has the input wired to a custom button
            // rather than a plain file input — we fall back to clicking
            // the upload control and letting the filechooser event fire.
            const fc = page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null)
            await fileInput.click().catch(() => {})
            const chooser = await fc
            if (chooser) await chooser.setFiles(resumePdfPath)
          }
          break
        }
      }

      // Fill text inputs, selects, radios, textareas.
      const textInputs = await page.$$('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea')
      for (const inp of textInputs) {
        // Skip already-filled inputs (LinkedIn prefills name/email).
        const value = await inp.evaluate((el) => (el as HTMLInputElement).value ?? '')
        if (value && value.trim().length > 0) continue
        const label = await getFieldLabel(page, inp)
        if (!label) continue
        setPhase('answering-screening', `Answering: ${label.slice(0, 60)}`)
        try {
          const answer = await resolveAnswer({ question: label, fieldLabel: label, fieldType: 'text' })
          // Clear + fill with human-ish typing delay
          await inp.fill('')
          await inp.type(answer, { delay: 20 + Math.random() * 30 })
          await humanPause(config)
        } catch (err) {
          return { status: 'failed', message: `Question resolution failed: ${(err as Error).message}` }
        }
      }

      const selects = await page.$$('select')
      for (const sel of selects) {
        const current = await sel.evaluate((el) => (el as HTMLSelectElement).value)
        if (current) continue
        const label = await getFieldLabel(page, sel)
        if (!label) continue
        try {
          const answer = await resolveAnswer({ question: label, fieldLabel: label, fieldType: 'select' })
          // Try direct value match; fall back to label match.
          try {
            await sel.selectOption({ label: answer })
          } catch {
            try {
              await sel.selectOption({ value: answer })
            } catch {
              // If nothing matches, try the first non-empty option — less
              // accurate but prevents a form-stall. This is the only
              // place we make a best-effort guess; for unknown Qs we'd
              // have paused in resolveAnswer.
              const first = await sel.evaluate((el) => {
                const s = el as HTMLSelectElement
                return Array.from(s.options).find((o) => o.value && o.value !== '')?.value ?? ''
              })
              if (first) await sel.selectOption({ value: first })
            }
          }
          await humanPause(config)
        } catch (err) {
          return { status: 'failed', message: `Select resolution failed: ${(err as Error).message}` }
        }
      }

      // Radio groups — find by legend/label and pick the option whose
      // text best matches the answer.
      const radioGroups = await page.$$('fieldset:has(input[type="radio"])')
      for (const group of radioGroups) {
        const legend = await group.evaluate((el) => {
          const leg = el.querySelector('legend')
          return leg?.textContent?.trim() ?? ''
        })
        if (!legend) continue
        const alreadyChecked = await group.$('input[type="radio"]:checked')
        if (alreadyChecked) continue
        try {
          const answer = await resolveAnswer({ question: legend, fieldLabel: legend, fieldType: 'radio' })
          const radios = await group.$$('input[type="radio"]')
          let picked = false
          for (const r of radios) {
            const labelText = await r.evaluate((el) => {
              const input = el as HTMLInputElement
              const id = input.id
              if (id) {
                const lbl = document.querySelector(`label[for="${id}"]`)
                if (lbl?.textContent) return lbl.textContent.trim()
              }
              return (input.closest('label')?.textContent ?? '').trim()
            })
            if (labelText.toLowerCase().includes(answer.toLowerCase())) {
              await r.check()
              picked = true
              break
            }
          }
          if (!picked && radios.length > 0) {
            // If we can't match, default to the first option and let
            // Mike fix it later if needed. A more conservative default
            // is to pause — but the resolveAnswer hook already had its
            // chance to pause for an unknown.
            await radios[0].check()
          }
          await humanPause(config)
        } catch (err) {
          return { status: 'failed', message: `Radio resolution failed: ${(err as Error).message}` }
        }
      }

      // Checkboxes — rare in Easy Apply, but supported for completeness.
      const checkboxes = await page.$$('input[type="checkbox"]:not(:checked)')
      for (const cb of checkboxes) {
        const label = await getFieldLabel(page, cb)
        if (!label) continue
        // Only check if the label is a standard affirmation the answer
        // bank has a yes/no for, e.g. "I agree to the terms".
        const lower = label.toLowerCase()
        if (lower.includes('agree') || lower.includes('consent') || lower.includes('acknowledge')) {
          await cb.check().catch(() => {})
          await humanPause(config)
        }
      }

      // Decide: submit, next, or bail out.
      let submitBtn = null
      for (const sel of SUBMIT_BUTTON_SELECTORS) {
        submitBtn = await page.$(sel)
        if (submitBtn) {
          const visible = await submitBtn.isVisible().catch(() => false)
          if (visible) break
          submitBtn = null
        }
      }

      if (submitBtn) {
        if (!config.autoSubmit) {
          return {
            status: 'failed',
            message: 'autoSubmit=false in config — stopping before submit',
          }
        }
        setPhase('submitting', 'Clicking Submit')
        await humanPause(config)
        await submitBtn.click()
        await page.waitForTimeout(2_000)
        // LinkedIn pops a confirmation dialog after submit — we don't
        // need to click anything else.
        return {
          status: 'applied',
          message: 'Submitted via LinkedIn Easy Apply',
          submittedAt: new Date().toISOString(),
          screenshot: await page.screenshot({ fullPage: false }).catch(() => undefined) as Buffer | undefined,
        }
      }

      // No submit button yet — click Next and loop.
      let nextBtn = null
      for (const sel of NEXT_BUTTON_SELECTORS) {
        nextBtn = await page.$(sel)
        if (nextBtn) {
          const visible = await nextBtn.isVisible().catch(() => false)
          if (visible) break
          nextBtn = null
        }
      }
      if (!nextBtn) {
        return {
          status: 'failed',
          message: `Stuck at step ${step} — no Next or Submit button found`,
        }
      }
      await humanPause(config)
      await nextBtn.click()
      await pageTransitionPause(config)
    }

    return {
      status: 'failed',
      message: `Exceeded ${MAX_STEPS} steps without reaching submit`,
    }
  },
}

export default linkedinAdapter
