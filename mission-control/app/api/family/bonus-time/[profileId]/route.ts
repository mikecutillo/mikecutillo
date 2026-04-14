import { NextRequest, NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData, getProfile } from '../../../../../lib/family-data'
import { soapCall, tag } from '../../../router/soap'
import { postToDiscord, DISCORD_COLORS } from '../../../../../lib/discord-dispatch'

const SVC = 'urn:NETGEAR-ROUTER:service:DeviceConfig:1'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params
    const { minutes = 15 } = await req.json()
    const data = readFamilyData()
    const profile = getProfile(data, profileId)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const idx = data.profiles.findIndex(p => p.id === profileId)
    data.profiles[idx].bonusMinutes = (profile.bonusMinutes || 0) + minutes

    // If devices are currently blocked by curfew, unblock them now
    if (profile.devices.length > 0) {
      const xml = await soapCall(SVC, 'GetBlockDeviceEnable')
      const rawList = tag(xml, 'NewBlockDeviceMACList') || ''
      const blockedMacs = rawList.split(',').map(m => m.trim().toUpperCase()).filter(Boolean)
      const profileMacs = profile.devices.map(d => d.mac.toUpperCase())
      const isBlocked = profileMacs.some(m => blockedMacs.includes(m))

      if (isBlocked && !profile.paused) {
        const newList = blockedMacs.filter(m => !profileMacs.includes(m))
        await soapCall(SVC, 'SetBlockDevice',
          `<NewBlockDeviceMACList>${newList.join(',')}</NewBlockDeviceMACList>`)
        if (newList.length === 0) {
          await soapCall(SVC, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>0</NewBlockDeviceEnable>')
        }
      }
    }

    writeFamilyData(data)

    const totalBonus = data.profiles[idx].bonusMinutes
    const now = new Date()
    const isWeekend = now.getDay() === 0 || now.getDay() === 5 || now.getDay() === 6
    const baseCurfew = isWeekend && profile.weekendOverride
      ? profile.curfew.weekend : profile.curfew.weekday

    postToDiscord('screen-time', {
      title: 'Screen Time — Bonus Time Granted',
      color: DISCORD_COLORS.family,
      fields: [
        { name: 'Profile', value: `${profile.emoji} ${profile.name}`, inline: true },
        { name: 'Added', value: `+${minutes} min`, inline: true },
        { name: 'Total Bonus', value: `${totalBonus} min`, inline: true },
        { name: 'Effective Curfew', value: `${baseCurfew} + ${totalBonus} min`, inline: false },
      ],
    }).catch(() => {})

    return NextResponse.json({ ok: true, bonusMinutes: totalBonus })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
