import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData } from '../../../../lib/family-data'

export async function POST(req: NextRequest) {
  try {
    const { mac, name, type, ip, profileId, vendor, hostname, randomizedMac } = await req.json()
    if (!mac) return NextResponse.json({ error: 'mac required' }, { status: 400 })

    const data = readFamilyData()

    // Remove this device from any existing profile
    for (const profile of data.profiles) {
      profile.devices = profile.devices.filter(d => d.mac.toUpperCase() !== mac.toUpperCase())
    }

    // Add to new profile (or just unassign if profileId is null/empty)
    if (profileId) {
      const idx = data.profiles.findIndex(p => p.id === profileId)
      if (idx === -1) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      data.profiles[idx].devices.push({
        mac: mac.toUpperCase(),
        name: name || mac,
        type: type || 'other',
        ip,
        ...(vendor ? { vendor } : {}),
        ...(hostname ? { hostname } : {}),
        ...(randomizedMac !== undefined ? { randomizedMac } : {}),
      })
    }

    writeFamilyData(data)
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
