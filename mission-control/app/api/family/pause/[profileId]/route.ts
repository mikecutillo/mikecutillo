import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData, getProfile } from '../../../../../lib/family-data'
import { soapCall, tag } from '../../../router/soap'
import { postToDiscord, DISCORD_COLORS } from '../../../../../lib/discord-dispatch'

const SVC = 'urn:NETGEAR-ROUTER:service:DeviceConfig:1'

async function getBlockedMacs(): Promise<string[]> {
  const xml = await soapCall(SVC, 'GetBlockDeviceEnable')
  const raw = tag(xml, 'NewBlockDeviceMACList') || ''
  return raw.split(',').map(m => m.trim().toUpperCase()).filter(Boolean)
}

async function setBlockedMacs(macs: string[]) {
  await soapCall(SVC, 'SetBlockDevice',
    `<NewBlockDeviceMACList>${macs.join(',')}</NewBlockDeviceMACList>`)
  if (macs.length > 0) {
    await soapCall(SVC, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>1</NewBlockDeviceEnable>')
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params
    const { paused } = await req.json()
    const data = readFamilyData()
    const profile = getProfile(data, profileId)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    if (profile.devices.length === 0) return NextResponse.json({ error: 'No devices assigned to this profile' }, { status: 400 })

    const current = await getBlockedMacs()
    const profileMacs = profile.devices.map(d => d.mac.toUpperCase())

    let newList: string[]
    if (paused) {
      newList = Array.from(new Set([...current, ...profileMacs]))
    } else {
      newList = current.filter(m => !profileMacs.includes(m))
    }

    await setBlockedMacs(newList)

    // Save paused state
    const idx = data.profiles.findIndex(p => p.id === profileId)
    data.profiles[idx].paused = paused
    data.profiles[idx].pausedAt = paused ? new Date().toISOString() : null
    writeFamilyData(data)

    postToDiscord('screen-time', {
      title: `Screen Time — ${paused ? 'Internet Paused' : 'Internet Resumed'}`,
      color: paused ? DISCORD_COLORS.alert : DISCORD_COLORS.family,
      fields: [
        { name: 'Profile', value: `${profile.emoji} ${profile.name}`, inline: true },
        { name: 'Action', value: paused ? 'Paused by parent' : 'Resumed by parent', inline: true },
        { name: 'Devices', value: profile.devices.map(d => d.name).join(', ') || 'None', inline: false },
      ],
    }).catch(() => {})

    return NextResponse.json({ ok: true, paused, blockedMacs: newList })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
