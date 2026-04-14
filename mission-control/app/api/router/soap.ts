const ROUTER_HOST = process.env.ROUTER_HOST || '192.168.1.1'
const ROUTER_PORT = process.env.ROUTER_PORT || '5000'
const ROUTER_USER = process.env.ROUTER_USER || 'admin'
const ROUTER_PASS = process.env.ROUTER_PASS || ''

const auth = Buffer.from(`${ROUTER_USER}:${ROUTER_PASS}`).toString('base64')

export async function soapCall(service: string, action: string, bodyXml = '') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(`http://${ROUTER_HOST}:${ROUTER_PORT}/soap/server_sa/`, {
      method: 'POST',
      headers: {
        SOAPAction: `"${service}#${action}"`,
        Authorization: `Basic ${auth}`,
        'Content-Type': 'text/xml',
      },
      body: `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
<SOAP-ENV:Body>
<m:${action} xmlns:m="${service}">${bodyXml}</m:${action}>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`,
      // @ts-ignore
      cache: 'no-store',
      signal: controller.signal,
    })
    return res.text()
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

export function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${name}>`, 'i'))
  return m ? m[1].trim() : ''
}

export interface Device {
  mac: string
  ip: string
  name: string
  type: string
  signal: string
  blocked: boolean
}

export function parseDevices(raw: string): Device[] {
  if (!raw) return []
  // Format: MAC=xx;IP=xx;NAME=xx;SIGNAL=xx;TYPE=xx|...
  return raw
    .split('|')
    .filter(Boolean)
    .map(chunk => {
      const pairs: Record<string, string> = {}
      chunk.split(';').forEach(part => {
        const [k, ...v] = part.split('=')
        if (k) pairs[k.trim().toUpperCase()] = v.join('=').trim()
      })
      return {
        mac: pairs['MAC'] || '',
        ip: pairs['IP'] || '',
        name: pairs['NAME'] || pairs['HOSTNAME'] || 'Unknown',
        type: pairs['TYPE'] || '',
        signal: pairs['SIGNAL'] || pairs['CONN'] || '',
        blocked: false,
      }
    })
    .filter(d => d.mac)
}
