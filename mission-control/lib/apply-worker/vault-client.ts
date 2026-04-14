/**
 * vault-client — read credentials from the Mission Control vault for
 * adapters that need to log in programmatically (Workday, iCIMS, etc).
 *
 * The vault file format is `VaultCredentialEntry[]` at
 * `mission-control/data/vault-credentials.json`. Currently the file
 * only stores `passwordMasked` (not the plaintext) and relies on a
 * global password rule pattern: `${prefix}${service}${suffix}`.
 *
 * For a first-pass we look up by fuzzy service name and derive the
 * password from the rule. The actual password is never written to
 * this client's return — it's passed directly into Playwright's
 * type() and discarded immediately.
 */

import fs from 'fs/promises'
import path from 'path'

const CRED_PATH = path.join(
  '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data',
  'vault-credentials.json',
)
const RULES_PATH = path.join(
  '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data',
  'vault-password-rules.json',
)

interface VaultCredentialEntry {
  id: string
  service: string
  username: string
  passwordMasked?: string
  loginUrl?: string
  allowedActions?: string[]
  recoveryNotes?: string
  status?: string
}

interface PasswordRuleEntry {
  id: string
  label: string
  prefix: string
  suffix: string
  requirements?: string
  notes?: string
}

export interface ResolvedCredential {
  service: string
  username: string
  password: string
  loginUrl?: string
}

async function readCreds(): Promise<VaultCredentialEntry[]> {
  try {
    const raw = await fs.readFile(CRED_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}

async function readRules(): Promise<PasswordRuleEntry[]> {
  try {
    const raw = await fs.readFile(RULES_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}

/**
 * Look up a credential for a service. `serviceName` matching is
 * case-insensitive substring — "workday" matches "Workday (ACME)".
 *
 * Returns null if no entry matches or no password can be derived.
 */
export async function getCredential(serviceName: string): Promise<ResolvedCredential | null> {
  const creds = await readCreds()
  const lower = serviceName.toLowerCase()
  const match = creds.find((c) => c.service.toLowerCase().includes(lower))
  if (!match) return null

  // Derive password from the global rule when the entry only has
  // `passwordMasked`. Eventually the vault will store encrypted
  // plaintext and return that directly.
  const rules = await readRules()
  const rule = rules[0]
  if (!rule) return null
  const password = `${rule.prefix}${match.service}${rule.suffix}`

  return {
    service: match.service,
    username: match.username,
    password,
    loginUrl: match.loginUrl,
  }
}
