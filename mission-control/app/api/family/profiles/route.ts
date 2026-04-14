import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData } from '../../../../lib/family-data'

export async function GET() {
  try {
    const data = readFamilyData()
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = readFamilyData()

    // Update a profile or top-level fields
    if (body.profileId) {
      const idx = data.profiles.findIndex(p => p.id === body.profileId)
      if (idx === -1) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      data.profiles[idx] = { ...data.profiles[idx], ...body.updates }
    } else {
      // Top-level update (dinnerMode, screenFreeNight)
      Object.assign(data, body.updates)
    }

    writeFamilyData(data)
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
