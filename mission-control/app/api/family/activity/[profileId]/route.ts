import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, getProfile } from '../../../../../lib/family-data'
import { phGet } from '../../../router/pihole/client'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params
    const data = readFamilyData()
    const profile = getProfile(data, profileId)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    if (profile.devices.length === 0) return NextResponse.json({ queries: [] })

    const now = Math.floor(Date.now() / 1000)
    const dayAgo = now - 86400

    // Fetch queries for each device in parallel
    const results = await Promise.allSettled(
      profile.devices
        .filter(d => d.ip)
        .map(device =>
          phGet(`/queries?client=${device.ip}&from=${dayAgo}&until=${now}&count=50`)
            .then((res: any) => ({ device, queries: res?.queries || [] }))
        )
    )

    // Merge and sort all queries newest first
    const allQueries: any[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const q of r.value.queries) {
          allQueries.push({
            ...q,
            deviceName: r.value.device.name,
            deviceType: r.value.device.type,
          })
        }
      }
    }
    allQueries.sort((a, b) => b.time - a.time)

    return NextResponse.json({ queries: allQueries.slice(0, 100) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
