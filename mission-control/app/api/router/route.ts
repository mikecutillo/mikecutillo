import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { soapCall, tag, parseDevices } from './soap'

function getArpDevices(): any[] {
  try {
    const file = path.join(process.cwd(), 'data', 'arp-devices.json')
    if (!fs.existsSync(file)) return []
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data.devices || []
  } catch { return [] }
}

const SVC_INFO    = 'urn:NETGEAR-ROUTER:service:DeviceInfo:1'
const SVC_WAN     = 'urn:NETGEAR-ROUTER:service:WANIPConnection:1'
const SVC_CONFIG  = 'urn:NETGEAR-ROUTER:service:DeviceConfig:1'
const SVC_TRAFFIC = 'urn:NETGEAR-ROUTER:service:TrafficMeter:1'

export async function GET() {
  try {
    const [devXml, wanXml, blockXml, trafficXml] = await Promise.allSettled([
      soapCall(SVC_INFO,    'GetAttachDevice'),
      soapCall(SVC_WAN,     'GetExternalIPAddress'),
      soapCall(SVC_CONFIG,  'GetBlockDeviceEnable'),
      soapCall(SVC_TRAFFIC, 'GetTrafficMeterStatistics'),
    ])

    const devRaw = devXml.status === 'fulfilled' ? tag(devXml.value, 'NewAttachDevice') : ''
    const wanIp  = wanXml.status === 'fulfilled'  ? tag(wanXml.value, 'NewExternalIPAddress') : ''
    const blockEnabled = blockXml.status === 'fulfilled' ? tag(blockXml.value, 'NewBlockDeviceEnable') : 'off'
    const blockedMacs  = blockXml.status === 'fulfilled' ? tag(blockXml.value, 'NewBlockDeviceMACList') : ''

    // Parse devices from SOAP, fall back to ARP if empty
    const soapDevices = parseDevices(devRaw).map(d => ({
      ...d,
      blocked: blockedMacs.toLowerCase().includes(d.mac.toLowerCase()),
    }))

    // If SOAP returned no devices (auth issue or offline), use ARP file
    const arpDevices = soapDevices.length === 0 ? getArpDevices() : []
    const devices = soapDevices.length > 0 ? soapDevices : arpDevices.map(d => ({
      ...d,
      blocked: blockedMacs.toLowerCase().includes(d.mac.toLowerCase()),
    }))

    // Parse traffic
    let traffic = { todayUpload: '', todayDownload: '', monthUpload: '', monthDownload: '' }
    if (trafficXml.status === 'fulfilled') {
      const t = trafficXml.value
      traffic = {
        todayUpload:    tag(t, 'NewTodayConnectionTime') || tag(t, 'NewTodayUpload'),
        todayDownload:  tag(t, 'NewTodayDownload'),
        monthUpload:    tag(t, 'NewMonthUpload'),
        monthDownload:  tag(t, 'NewMonthDownload'),
      }
    }

    // Port mappings
    const ports = []
    for (let i = 0; i < 10; i++) {
      const xml = await soapCall(SVC_WAN, 'GetGenericPortMappingEntry',
        `<NewPortMappingIndex>${i}</NewPortMappingIndex>`)
      if (!xml || xml.includes('Fault') || xml.includes('SpecifiedArrayIndexInvalid')) break
      const exPort = tag(xml, 'NewExternalPort')
      const proto  = tag(xml, 'NewProtocol')
      const intIp  = tag(xml, 'NewInternalClient')
      const intPort = tag(xml, 'NewInternalPort')
      const desc   = tag(xml, 'NewPortMappingDescription')
      if (exPort) ports.push({ exPort, proto, intIp, intPort, desc })
    }

    return NextResponse.json({ devices, wanIp, blockEnabled, blockedMacs, traffic, ports })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
