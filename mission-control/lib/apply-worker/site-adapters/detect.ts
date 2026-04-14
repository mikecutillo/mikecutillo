/**
 * detect — URL → site adapter router.
 *
 * The orchestrator calls `pickAdapter(url)` once per apply run. We
 * try each adapter's `canHandle` in priority order and fall through
 * to `generic` if nothing else matches. Generic uses label-scraping
 * heuristics that work on most boards but are less reliable than a
 * purpose-built adapter.
 *
 * New adapters get added to the list in one place — no orchestrator
 * changes required.
 */

import { SiteAdapter } from './types'
import linkedinAdapter from './linkedin'
import workdayAdapter from './workday'
import greenhouseAdapter from './greenhouse'
import leverAdapter from './lever'
import ashbyAdapter from './ashby'
import icimsAdapter from './icims'
import genericAdapter from './generic'

/**
 * Priority order — LinkedIn first (primary target), then the ATS
 * providers we support natively, then the generic fallback. Within
 * the ATS group, order is alphabetical — no one adapter is "better"
 * than another.
 */
const ADAPTERS: SiteAdapter[] = [
  linkedinAdapter,
  ashbyAdapter,
  greenhouseAdapter,
  icimsAdapter,
  leverAdapter,
  workdayAdapter,
  genericAdapter, // keep last — catches anything else
]

export function pickAdapter(url: string): SiteAdapter {
  for (const a of ADAPTERS) {
    if (a.canHandle(url)) return a
  }
  return genericAdapter
}

export const ALL_ADAPTERS = ADAPTERS
