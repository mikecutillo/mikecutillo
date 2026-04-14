#!/usr/bin/env node
// arp-watcher.js — runs outside the Claude app sandbox
// Polls `arp -a` every 30s and writes device list to data/arp-devices.json
// Run: node scripts/arp-watcher.js

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const OUTPUT = path.join(__dirname, '..', 'data', 'arp-devices.json')

function normalMac(mac) {
  return mac.toUpperCase().split(':').map(p => p.padStart(2, '0')).join(':')
}

const VENDOR_TYPE = {
  'A4:C3:F0': 'iphone', 'A8:51:AB': 'iphone', '3C:22:FB': 'iphone',
  'F0:B3:EC': 'ipad',   '60:F8:1D': 'ipad',
  '04:D3:B0': 'computer', 'A8:66:7F': 'computer', '14:7D:DA': 'computer',
  'F4:5C:89': 'computer', '34:C9:3D': 'computer', '1C:F6:4C': 'computer',
}

function guessType(mac, name) {
  const n = (name || '').toLowerCase()
  if (/iphone/.test(n)) return 'iphone'
  if (/ipad/.test(n)) return 'ipad'
  if (/macbook|mac-mini|macmini|imac/.test(n)) return 'computer'
  if (/appletv|apple-tv/.test(n)) return 'tv'
  if (/samsung|roku|fire/.test(n)) return 'tv'
  return VENDOR_TYPE[mac.substring(0, 8)] || 'other'
}

function scan() {
  execFile('/usr/sbin/arp', ['-a'], { timeout: 10000 }, (_err, stdout) => {
    const devices = []
    for (const line of (stdout || '').split('\n')) {
      const m = line.match(/^(\S+)\s+\(([^)]+)\)\s+at\s+([0-9a-f:]{14,17})\s+on\s+(\S+)/i)
      if (!m) continue
      const [, hostname, ip, rawMac] = m
      const mac = normalMac(rawMac)
      if (mac === 'FF:FF:FF:FF:FF:FF') continue
      if (ip.startsWith('169.') || ip.startsWith('224.') || ip.startsWith('239.')) continue
      const name = hostname === '?' ? ip : hostname.replace(/\.(local|home|lan)$/, '')
      const type = guessType(mac, name)
      devices.push({ mac, ip, name, type, signal: '', blocked: false })
    }

    fs.writeFileSync(OUTPUT, JSON.stringify({ devices, updatedAt: new Date().toISOString() }, null, 2))
    console.log(`[arp-watcher] ${new Date().toLocaleTimeString()} — ${devices.length} devices written to data/arp-devices.json`)
  })
}

scan()
setInterval(scan, 30000)
console.log('[arp-watcher] Started — scanning every 30s. Press Ctrl+C to stop.')
