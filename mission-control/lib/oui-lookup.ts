import fs from 'fs'
import path from 'path'

let ouiMap: Record<string, string> | null = null

function loadOui(): Record<string, string> {
  if (ouiMap) return ouiMap
  try {
    const file = path.join(process.cwd(), 'data', 'oui-map.json')
    ouiMap = JSON.parse(fs.readFileSync(file, 'utf8'))
    return ouiMap!
  } catch {
    ouiMap = {}
    return ouiMap
  }
}

/** Returns true if this MAC has a locally-administered (randomized/private) bit set */
export function isRandomizedMac(mac: string): boolean {
  const first = parseInt(mac.split(':')[0], 16)
  return (first & 0x02) !== 0
}

/** Look up the vendor/manufacturer name for a MAC address */
export function macVendor(mac: string): string | null {
  if (isRandomizedMac(mac)) return null
  const oui = mac.replace(/[:\-]/g, '').slice(0, 6).toUpperCase()
  const map = loadOui()
  return map[oui] ?? null
}

/** Guess the device type from vendor name and hostname */
export function guessDeviceType(
  mac: string,
  name: string,
  vendor: string | null
): 'iphone' | 'ipad' | 'computer' | 'tv' | 'speaker' | 'router' | 'nas' | 'hub' | 'other' {
  const n = (name + ' ' + (vendor || '')).toLowerCase()

  if (/iphone/.test(n)) return 'iphone'
  if (/ipad/.test(n)) return 'ipad'
  if (/macbook|mac mini|macmini|imac|mac pro/.test(n)) return 'computer'
  if (/apple tv|appletv/.test(n)) return 'tv'
  if (/homepod/.test(n)) return 'speaker'
  if (/netgear|orbi|router|gateway/.test(n)) return 'router'
  if (/synology|nas|qnap/.test(n)) return 'nas'
  if (/philips|hue/.test(n)) return 'hub'
  if (/echo|alexa|fire tv|amazon/.test(n)) return 'tv'  // treat Amazon as media device
  if (/roku/.test(n)) return 'tv'
  if (/samsung/.test(n)) return 'tv'
  if (/google nest|chromecast/.test(n)) return 'tv'

  // Randomized MAC = almost certainly a modern Apple mobile device
  if (isRandomizedMac(mac)) return 'iphone'

  return 'other'
}

/** Returns a human-readable label combining name + vendor */
export function deviceLabel(mac: string, hostname: string, vendor: string | null): string {
  const isRandom = isRandomizedMac(mac)
  if (isRandom) return `Apple Device (privacy mode)`
  if (vendor && hostname === mac.replace(/:/g, '') || hostname.match(/^192\./)) {
    return vendor || hostname
  }
  if (vendor && !hostname.includes(vendor.split(' ')[0].toLowerCase())) {
    return `${hostname} (${vendor})`
  }
  return hostname
}
