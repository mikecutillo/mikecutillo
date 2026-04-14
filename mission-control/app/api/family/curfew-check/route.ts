import { NextResponse } from 'next/server'
import { readFamilyData, writeFamilyData } from '../../../../lib/family-data'
import { soapCall, tag } from '../../router/soap'
import { postToDiscord, DISCORD_COLORS } from '../../../../lib/discord-dispatch'

const SVC = 'urn:NETGEAR-ROUTER:service:DeviceConfig:1'

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { hour: h, minute: m }
}

function isAfterCurfew(now: Date, curfewStr: string, bonusMinutes: number): boolean {
  const { hour, minute } = parseTime(curfewStr)
  const curfewMins = hour * 60 + minute + bonusMinutes
  const nowMins = now.getHours() * 60 + now.getMinutes()
  // Also block during early morning hours (midnight to 7am)
  const wakeupMins = 7 * 60
  return nowMins >= curfewMins || (nowMins < wakeupMins)
}

export async function POST() {
  try {
    const data = readFamilyData()
    const now = new Date()
    const isWeekend = now.getDay() === 0 || now.getDay() === 5 || now.getDay() === 6 // Fri/Sat/Sun

    // Get current blocked list
    const xml = await soapCall(SVC, 'GetBlockDeviceEnable')
    const rawList = tag(xml, 'NewBlockDeviceMACList') || ''
    let blockedMacs = rawList.split(',').map(m => m.trim().toUpperCase()).filter(Boolean)
    let changed = false

    for (const profile of data.profiles) {
      if (profile.devices.length === 0) continue
      if (profile.paused) continue // Don't interfere with manually paused profiles

      const curfewStr = isWeekend && profile.weekendOverride
        ? profile.curfew.weekend
        : profile.curfew.weekday

      const shouldBlock = isAfterCurfew(now, curfewStr, profile.bonusMinutes)
      const profileMacs = profile.devices.map(d => d.mac.toUpperCase())
      const isCurrentlyBlocked = profileMacs.some(m => blockedMacs.includes(m))

      if (shouldBlock && !isCurrentlyBlocked) {
        blockedMacs = Array.from(new Set([...blockedMacs, ...profileMacs]))
        changed = true
      } else if (!shouldBlock && isCurrentlyBlocked) {
        blockedMacs = blockedMacs.filter(m => !profileMacs.includes(m))
        // Reset bonus minutes at wakeup
        const idx = data.profiles.findIndex(p => p.id === profile.id)
        data.profiles[idx].bonusMinutes = 0
        changed = true
      }
    }

    if (changed) {
      await soapCall(SVC, 'SetBlockDevice',
        `<NewBlockDeviceMACList>${blockedMacs.join(',')}</NewBlockDeviceMACList>`)
      if (blockedMacs.length > 0) {
        await soapCall(SVC, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>1</NewBlockDeviceEnable>')
      } else {
        await soapCall(SVC, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>0</NewBlockDeviceEnable>')
      }
      writeFamilyData(data)

      // Notify Discord #screen-time for each profile that changed
      for (const profile of data.profiles) {
        if (profile.devices.length === 0 || profile.paused) continue
        const curfewStr = isWeekend && profile.weekendOverride
          ? profile.curfew.weekend : profile.curfew.weekday
        const shouldBlock = isAfterCurfew(now, curfewStr, profile.bonusMinutes)
        const profileMacs = profile.devices.map(d => d.mac.toUpperCase())
        const isBlocked = profileMacs.some(m => blockedMacs.includes(m))

        postToDiscord('screen-time', {
          title: `Screen Time — ${isBlocked ? 'Curfew Enforced' : 'Curfew Lifted'}`,
          color: isBlocked ? DISCORD_COLORS.alert : DISCORD_COLORS.family,
          fields: [
            { name: 'Profile', value: `${profile.emoji} ${profile.name}`, inline: true },
            { name: 'Action', value: isBlocked ? 'Devices blocked' : 'Devices unblocked', inline: true },
            { name: 'Curfew', value: `${curfewStr} (${isWeekend ? 'weekend' : 'weekday'})`, inline: true },
            ...(profile.bonusMinutes > 0 ? [{ name: 'Bonus Minutes', value: `${profile.bonusMinutes} min`, inline: true }] : []),
          ],
        }).catch(() => {}) // fire-and-forget
      }
    }

    return NextResponse.json({ ok: true, changed, blockedMacs })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
