import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData, getProfile } from '../../../../../lib/family-data'
import { phPost, phDelete } from '../../../router/pihole/client'

// Redirects YouTube to Google's Restricted Mode endpoint
const YOUTUBE_RESTRICT_RECORDS = [
  { domain: 'www.youtube.com', cname: 'restrict.youtube.com' },
  { domain: 'youtube.com',     cname: 'restrict.youtube.com' },
  { domain: 'm.youtube.com',   cname: 'restrict.youtube.com' },
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

    try {
      if (enabled) {
        for (const r of YOUTUBE_RESTRICT_RECORDS) {
          await phPost('/config', {
            config: {
              dns: {
                cnameRecords: [`${r.domain},${r.cname}`]
              }
            }
          })
        }
      } else {
        for (const r of YOUTUBE_RESTRICT_RECORDS) {
          await phDelete(`/config/dns/cnameRecords/${encodeURIComponent(`${r.domain},${r.cname}`)}`)
        }
      }
    } catch {
      // State saved regardless of Pi-hole API response
    }

    const idx = data.profiles.findIndex(p => p.id === profileId)
    data.profiles[idx].youtubeRestricted = enabled
    writeFamilyData(data)

    return NextResponse.json({ ok: true, youtubeRestricted: enabled })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
