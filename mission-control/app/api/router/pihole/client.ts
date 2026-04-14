// Pi-hole v6 API client with session caching
const PIHOLE_BASE = `http://${process.env.PIHOLE_HOST || '192.168.1.46'}:${process.env.PIHOLE_PORT || '8090'}`
const PIHOLE_PASS = process.env.PIHOLE_PASS || 'cutillo1'

let cachedSid: string | null = null
let sidExpiry = 0

async function getSid(): Promise<string> {
  if (cachedSid && Date.now() < sidExpiry) return cachedSid
  const res = await fetch(`${PIHOLE_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PIHOLE_PASS }),
  })
  const j = await res.json()
  cachedSid = j?.session?.sid || j?.sid || ''
  sidExpiry = Date.now() + 25 * 60 * 1000 // 25 min
  return cachedSid || ''
}

export async function phGet(path: string) {
  const sid = await getSid()
  const res = await fetch(`${PIHOLE_BASE}/api${path}`, {
    headers: { 'X-FTL-SID': sid },
    // @ts-ignore
    cache: 'no-store',
  })
  if (res.status === 401) { cachedSid = null; return phGet(path) } // retry once
  return res.json()
}

export async function phPost(path: string, body: unknown) {
  const sid = await getSid()
  const res = await fetch(`${PIHOLE_BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FTL-SID': sid },
    body: JSON.stringify(body),
  })
  if (res.status === 401) { cachedSid = null; return phPost(path, body) }
  return res.json()
}

export async function phDelete(path: string, body?: unknown) {
  const sid = await getSid()
  const res = await fetch(`${PIHOLE_BASE}/api${path}`, {
    method: 'DELETE',
    headers: body ? { 'Content-Type': 'application/json', 'X-FTL-SID': sid } : { 'X-FTL-SID': sid },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) { cachedSid = null; return phDelete(path, body) }
  return res.status === 204 ? { ok: true } : res.json()
}

export const PIHOLE_URL = PIHOLE_BASE
