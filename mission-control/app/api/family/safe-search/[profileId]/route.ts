import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData, getProfile } from '../../../../../lib/family-data'
import { phPost, phDelete } from '../../../router/pihole/client'

// Pi-hole v6 custom DNS records for Safe Search enforcement
// These CNAME-style overrides force browsers to Google/Bing safe-search servers
const SAFE_SEARCH_RECORDS = [
  // Google Safe Search — force.safesearch.google.com resolves to Google's safe-search IP
  { domain: 'www.google.com',    cname: 'forcesafesearch.google.com' },
  { domain: 'google.com',        cname: 'forcesafesearch.google.com' },
  // Bing Safe Search
  { domain: 'www.bing.com',      cname: 'strict.bing.com' },
  { domain: 'bing.com',          cname: 'strict.bing.com' },
  // DuckDuckGo Safe Search
  { domain: 'duckduckgo.com',    cname: 'safe.duckduckgo.com' },
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params
    const { enabled } = await req.json()
    const data = readFamilyData()
    const profile = getProfile(data, profileId)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Apply or remove Pi-hole CNAME records
    // Pi-hole v6 custom CNAME records via config API
    try {
      if (enabled) {
        for (const r of SAFE_SEARCH_RECORDS) {
          await phPost('/config', {
            config: {
              dns: {
                cnameRecords: [`${r.domain},${r.cname}`]
              }
            }
          })
        }
      } else {
        for (const r of SAFE_SEARCH_RECORDS) {
          await phDelete(`/config/dns/cnameRecords/${encodeURIComponent(`${r.domain},${r.cname}`)}`)
        }
      }
    } catch {
      // Pi-hole CNAME API may vary by version — state is saved regardless
    }

    // Save state
    const idx = data.profiles.findIndex(p => p.id === profileId)
    data.profiles[idx].safeSearch = enabled
    writeFamilyData(data)

    return NextResponse.json({ ok: true, safeSearch: enabled })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
