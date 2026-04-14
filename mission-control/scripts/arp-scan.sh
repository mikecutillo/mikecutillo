#!/bin/bash
# arp-scan.sh — reads ARP table (bash has Local Network permission), enriches with OUI vendor data
# Run once: bash scripts/arp-scan.sh
# Run on loop: bash scripts/arp-scan.sh --watch

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTFILE="$SCRIPT_DIR/../data/arp-devices.json"
OUIFILE="$SCRIPT_DIR/../data/oui-map.json"
TMPFILE="/tmp/mission-control-arp.txt"

scan() {
  /usr/sbin/arp -a > "$TMPFILE" 2>/dev/null

  python3 << PYEOF
import re, json
from datetime import datetime, timezone

outfile = "$OUTFILE"
ouifile = "$OUIFILE"

# Load OUI map
try:
    with open(ouifile) as f:
        oui_map = json.load(f)
except:
    oui_map = {}

def lookup_vendor(mac):
    oui = mac.replace(':', '').replace('-', '')[:6].upper()
    return oui_map.get(oui)

def is_randomized(mac):
    first = int(mac.split(':')[0], 16)
    return bool(first & 0x02)

def clean_vendor(v):
    # Shorten very long names
    if not v: return None
    v = re.sub(r'\s+(Co\.,?Ltd\.?|Inc\.?|LLC\.?|Corp\.?|GmbH|B\.V\.|Limited)$', '', v, flags=re.I)
    return v.strip()[:30]

DEVICE_ICONS = {
    'router': '📡', 'nas': '🗄️', 'hub': '💡', 'computer': '💻',
    'iphone': '📱', 'ipad': '📱', 'tv': '📺', 'speaker': '🔊', 'other': '📶'
}

def guess_type(mac, name, vendor):
    v = (vendor or '').lower()
    n = name.lower()
    combo = n + ' ' + v

    if 'iphone' in combo: return 'iphone'
    if 'ipad' in combo: return 'ipad'
    if any(x in combo for x in ['macbook','mac mini','macmini','imac']): return 'computer'
    if any(x in combo for x in ['apple tv','appletv']): return 'tv'
    if 'homepod' in combo: return 'speaker'
    if any(x in combo for x in ['netgear','orbi','router']): return 'router'
    if any(x in combo for x in ['synology','qnap']): return 'nas'
    if any(x in combo for x in ['philips','hue']): return 'hub'
    if 'amazon' in v: return 'tv'
    if 'roku' in v: return 'tv'
    if 'samsung' in v: return 'tv'
    if 'google' in v: return 'tv'
    if is_randomized(mac): return 'iphone'  # randomized = modern Apple mobile
    return 'other'

devices = []
with open("$TMPFILE") as f:
    for line in f:
        m = re.match(r'^(\S+)\s+\(([^)]+)\)\s+at\s+([0-9a-f:]{8,17})', line.strip(), re.I)
        if not m: continue
        hostname, ip, mac = m.group(1), m.group(2), m.group(3)
        if mac.lower() == 'ff:ff:ff:ff:ff:ff': continue
        if ip.startswith('169.') or ip.startswith('224.') or ip.startswith('239.'): continue

        mac_norm = ':'.join(p.zfill(2) for p in mac.upper().split(':'))
        randomized = is_randomized(mac_norm)
        vendor = clean_vendor(lookup_vendor(mac_norm))

        # Build display name
        raw_name = ip if hostname == '?' else re.sub(r'\.(local|home|lan)$', '', hostname)
        if randomized:
            display_name = 'Apple Device'
            vendor_note = 'Randomized MAC (iOS/iPad privacy mode)'
        elif vendor and raw_name == ip:
            display_name = vendor
            vendor_note = vendor
        elif vendor:
            display_name = raw_name
            vendor_note = vendor
        else:
            display_name = raw_name
            vendor_note = None

        dtype = guess_type(mac_norm, raw_name, vendor)

        devices.append({
            'mac': mac_norm,
            'ip': ip,
            'name': display_name,
            'hostname': raw_name,
            'vendor': vendor_note,
            'type': dtype,
            'randomizedMac': randomized,
            'signal': '',
            'blocked': False,
        })

data = {'devices': devices, 'updatedAt': datetime.now(timezone.utc).isoformat()}
with open(outfile, 'w') as f:
    json.dump(data, f, indent=2)

# Print summary
for d in devices:
    icon = DEVICE_ICONS.get(d['type'], '📶')
    vendor_str = f" ({d['vendor']})" if d['vendor'] else ''
    print(f"  {icon} {d['name']:<25} {d['ip']:<16} {d['mac']}{vendor_str}")
print(f"[arp-scan] {len(devices)} devices written")
PYEOF
}

if [ "$1" == "--watch" ]; then
  echo "[arp-scan] Watching every 30s. Ctrl+C to stop."
  while true; do scan; sleep 30; done
else
  scan
fi
