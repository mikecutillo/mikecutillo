import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const ARP_FILE = path.join(process.cwd(), 'data', 'arp-devices.json')

export async function GET() {
  try {
    if (!fs.existsSync(ARP_FILE)) {
      return NextResponse.json({
        devices: [],
        message: 'Run `node scripts/arp-watcher.js` in a separate terminal to populate device list',
        watcherRunning: false,
      })
    }

    const raw = fs.readFileSync(ARP_FILE, 'utf8')
    const data = JSON.parse(raw)
    const ageMs = Date.now() - new Date(data.updatedAt || 0).getTime()
    const stale = ageMs > 120000 // older than 2 minutes

    return NextResponse.json({
      devices: data.devices || [],
      updatedAt: data.updatedAt,
      watcherRunning: !stale,
      stale,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, devices: [] }, { status: 500 })
  }
}
