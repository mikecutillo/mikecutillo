import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import { readFamilyData, writeFamilyData } from '../../../../lib/family-data'
import { soapCall, tag, parseDevices } from '../../router/soap'
import { postToDiscord, DISCORD_COLORS } from '../../../../lib/discord-dispatch'

const SVC_INFO   = 'urn:NETGEAR-ROUTER:service:DeviceInfo:1'
const SVC_CONFIG = 'urn:NETGEAR-ROUTER:service:DeviceConfig:1'

function getArpMacs(): string[] {
  try {
    const raw = execFileSync('/usr/sbin/arp', ['-a'], { timeout: 8000 }).toString()
    const macs: string[] = []
    for (const line of raw.split('\n')) {
      const m = line.match(/\(([^)]+)\)\s+at\s+([0-9a-f:]{14,17})/i)
      if (!m) continue
      const [, ip, mac] = m
      if (mac === 'ff:ff:ff:ff:ff:ff' || ip.startsWith('169.') || ip.startsWith('224.')) continue
      macs.push(mac.toUpperCase().split(':').map((p: string) => p.padStart(2,'0')).join(':'))
    }
    return macs
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { active } = await req.json()
    const data = readFamilyData()

    if (active) {
      // Get all connected device MACs — try SOAP first, fall back to ARP
      let allMacs: string[] = []
      try {
        const devXml = await soapCall(SVC_INFO, 'GetAttachDevice')
        const devRaw = tag(devXml, 'NewAttachDevice') || ''
        const soapDevices = parseDevices(devRaw)
        allMacs = soapDevices.map(d => d.mac.toUpperCase())
      } catch {}
      if (allMacs.length === 0) allMacs = getArpMacs()

      if (allMacs.length > 0) {
        await soapCall(SVC_CONFIG, 'SetBlockDevice',
          `<NewBlockDeviceMACList>${allMacs.join(',')}</NewBlockDeviceMACList>`)
        await soapCall(SVC_CONFIG, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>1</NewBlockDeviceEnable>')
      }

      data.dinnerMode = true
      data.dinnerModeStartedAt = new Date().toISOString()
    } else {
      // Unblock all
      await soapCall(SVC_CONFIG, 'SetBlockDevice', '<NewBlockDeviceMACList></NewBlockDeviceMACList>')
      await soapCall(SVC_CONFIG, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>0</NewBlockDeviceEnable>')

      data.dinnerMode = false
      data.dinnerModeStartedAt = null

      // Restore any profiles that were individually paused
      for (const profile of data.profiles) {
        if (profile.paused && profile.devices.length > 0) {
          const macs = profile.devices.map(d => d.mac.toUpperCase())
          await soapCall(SVC_CONFIG, 'SetBlockDevice',
            `<NewBlockDeviceMACList>${macs.join(',')}</NewBlockDeviceMACList>`)
          await soapCall(SVC_CONFIG, 'SetBlockDeviceEnable', '<NewBlockDeviceEnable>1</NewBlockDeviceEnable>')
        }
      }
    }

    writeFamilyData(data)

    postToDiscord('screen-time', {
      title: `Dinner Mode — ${active ? 'Activated' : 'Deactivated'}`,
      color: active ? DISCORD_COLORS.alert : DISCORD_COLORS.family,
      fields: [
        { name: 'Status', value: active ? 'All devices blocked' : 'Devices restored', inline: true },
      ],
      ...(active ? { description: 'Time to eat! All network devices have been blocked.' } : {}),
    }).catch(() => {})

    return NextResponse.json({ ok: true, dinnerMode: active })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
