'use client'

import { useEffect, useState, useCallback } from 'react'
import { useVisibilityInterval } from '@/hooks/use-visibility-interval'
import {
  Wifi, WifiOff, Shield, ShieldOff, Globe, Router as RouterIcon,
  RefreshCw, Lock, Unlock, Trash2, Plus, ChevronRight, Activity,
  Smartphone, Laptop, Tv, Gamepad2, HardDrive, Monitor, BarChart2,
  Clock, Eye, AlertTriangle, CheckCircle, XCircle, Users, Utensils,
  BookOpen, Timer, Zap, Moon, UserCheck,
} from 'lucide-react'
import { APP_PRESETS, PRESET_CATEGORIES } from '../../lib/router-presets'
import type { FamilyData, FamilyProfile, FamilyDevice } from '../../lib/family-data'
import ScreenTimeTab from '../../components/screen-time-tab'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Device { mac: string; ip: string; name: string; type: string; signal: string; blocked: boolean; vendor?: string; hostname?: string; randomizedMac?: boolean }
interface PortEntry { exPort: string; proto: string; intIp: string; intPort: string; desc: string }
interface RouterData { devices: Device[]; wanIp: string; blockEnabled: string; traffic: { todayUpload: string; todayDownload: string }; ports: PortEntry[] }
interface PiholeData { summary: any; clients: any; topDomains: any; topBlocked: any }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function deviceIcon(name: string, type = '') {
  const n = (name + ' ' + type).toLowerCase()
  if (/iphone|phone|android|pixel|galaxy/.test(n)) return <Smartphone size={12} />
  if (/ipad|tablet/.test(n))                        return <Smartphone size={12} />
  if (/tv|samsung|roku|firetv|appletv/.test(n))    return <Tv size={12} />
  if (/playstation|ps4|ps5|xbox|switch|gamepad/.test(n)) return <Gamepad2 size={12} />
  if (/nas|synology|server|hdd|storage/.test(n))   return <HardDrive size={12} />
  if (/imac|desktop|pc|hub/.test(n))               return <Monitor size={12} />
  if (/laptop|macbook|notebook|computer/.test(n))  return <Laptop size={12} />
  if (/router|orbi|netgear|gateway/.test(n))       return <RouterIcon size={12} />
  return <Wifi size={12} />
}

function fmtBytes(raw: string) {
  const n = parseFloat(raw)
  if (!n || isNaN(n)) return '—'
  if (n > 1024) return `${(n / 1024).toFixed(1)} GB`
  return `${n.toFixed(1)} MB`
}

function fmtNum(n: number) {
  if (!n) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

// ─── Style constants ──────────────────────────────────────────────────────────
const CARD: React.CSSProperties = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '16px' }
const LABEL: React.CSSProperties = { fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' as const, letterSpacing: '0.9px', marginBottom: '10px' }
const BTN: React.CSSProperties = { border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '500', padding: '5px 9px', transition: 'all 0.15s' }

// ─── Tab component ────────────────────────────────────────────────────────────
type Tab = 'devices' | 'apps' | 'dns' | 'ports' | 'family' | 'screentime'
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'family',     label: 'Family',        icon: <Users size={12} /> },
  { id: 'screentime', label: 'Screen Time',   icon: <Monitor size={12} /> },
  { id: 'devices',    label: 'Devices',       icon: <Wifi size={12} /> },
  { id: 'apps',       label: 'App Controls',  icon: <Shield size={12} /> },
  { id: 'dns',        label: 'DNS Insights',  icon: <Activity size={12} /> },
  { id: 'ports',      label: 'Port Forwards', icon: <Globe size={12} /> },
]

export default function RouterPage() {
  const [tab, setTab] = useState<Tab>('family')
  const [routerData, setRouterData] = useState<RouterData | null>(null)
  const [pihole, setPihole] = useState<PiholeData | null>(null)
  const [piholeOnline, setPiholeOnline] = useState(false)
  const [appStatus, setAppStatus] = useState<Record<string, boolean>>({})
  const [keywords, setKeywords] = useState<string[]>([])
  const [newKw, setNewKw] = useState('')
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [editingName, setEditingName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [blocking, setBlocking] = useState<string | null>(null)
  const [togglingApp, setTogglingApp] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [clientQueries, setClientQueries] = useState<any[]>([])
  const [selectedClient, setSelectedClient] = useState<string | null>(null)


  // Family tab state
  const [familyData, setFamilyData] = useState<FamilyData | null>(null)
  const [familyActivity, setFamilyActivity] = useState<Record<string, any[]>>({})
  const [familyBusy, setFamilyBusy] = useState<Record<string, boolean>>({})
  const [assigningDevice, setAssigningDevice] = useState<string | null>(null)
  const [deviceNicknames, setDeviceNicknames] = useState<Record<string, string>>({})
  const [dinnerBusy, setDinnerBusy] = useState(false)
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const saved = localStorage.getItem('router-device-names')
      if (saved) setNameMap(JSON.parse(saved))

      const [rRes, kRes, phRes, apRes, famRes] = await Promise.allSettled([
        fetch('/api/router').then(r => r.json()),
        fetch('/api/router/keywords').then(r => r.json()),
        fetch('/api/router/pihole').then(r => r.json()),
        fetch('/api/router/pihole/apps').then(r => r.json()),
        fetch('/api/family/profiles').then(r => r.json()),
      ])

      if (rRes.status === 'fulfilled') setRouterData(rRes.value)
      if (kRes.status === 'fulfilled') setKeywords(kRes.value.keywords || [])
      if (phRes.status === 'fulfilled' && !phRes.value.error) {
        setPihole(phRes.value)
        setPiholeOnline(true)
      }
      if (apRes.status === 'fulfilled' && !apRes.value.error) {
        setAppStatus(apRes.value.status || {})
      }
      if (famRes.status === 'fulfilled' && !famRes.value.error) {
        setFamilyData(famRes.value)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useVisibilityInterval(loadAll, 30_000)

  async function loadClientQueries(ip: string) {
    setSelectedClient(ip)
    const from = Math.floor(Date.now() / 1000) - 86400
    const data = await fetch(`/api/router/pihole/queries?client=${ip}&from=${from}&count=200`).then(r => r.json())
    setClientQueries(data?.queries || data?.data || [])
  }

  async function toggleBlock(mac: string, blocked: boolean) {
    setBlocking(mac)
    try {
      await fetch('/api/router/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac, blocked: !blocked }) })
      await loadAll()
    } finally { setBlocking(null) }
  }

  async function toggleApp(app: string, currentlyBlocked: boolean) {
    setTogglingApp(app)
    try {
      await fetch('/api/router/pihole/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, block: !currentlyBlocked }) })
      setAppStatus(prev => ({ ...prev, [app]: !currentlyBlocked }))
    } finally { setTogglingApp(null) }
  }

  async function addKeyword() {
    if (!newKw.trim()) return
    const res = await fetch('/api/router/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: newKw.trim().toLowerCase() }) })
    const j = await res.json()
    setKeywords(j.keywords || keywords)
    setNewKw('')
  }

  async function removeKeyword(kw: string) {
    const res = await fetch('/api/router/keywords', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: kw }) })
    const j = await res.json()
    setKeywords(j.keywords || keywords.filter(k => k !== kw))
  }

  function saveName(mac: string) {
    const updated = { ...nameMap, [mac]: nameInput }
    setNameMap(updated)
    localStorage.setItem('router-device-names', JSON.stringify(updated))
    setEditingName(null)
  }

  // ── Family helpers ────────────────────────────────────────────────────────
  async function familyPost(url: string, body: object, busyKey?: string) {
    if (busyKey) setFamilyBusy(prev => ({ ...prev, [busyKey]: true }))
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (j.data) setFamilyData(j.data)
      else await fetch('/api/family/profiles').then(r => r.json()).then(setFamilyData)
      return j
    } finally {
      if (busyKey) setFamilyBusy(prev => ({ ...prev, [busyKey]: false }))
    }
  }

  async function togglePause(profileId: string, paused: boolean) {
    await familyPost(`/api/family/pause/${profileId}`, { paused }, `pause-${profileId}`)
  }

  async function toggleDinnerMode(active: boolean) {
    setDinnerBusy(true)
    try {
      await fetch('/api/family/dinner-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
      const d = await fetch('/api/family/profiles').then(r => r.json())
      setFamilyData(d)
    } finally { setDinnerBusy(false) }
  }

  async function addBonusTime(profileId: string, minutes: number) {
    await familyPost(`/api/family/bonus-time/${profileId}`, { minutes }, `bonus-${profileId}`)
  }

  async function toggleSafeSearch(profileId: string, enabled: boolean) {
    await familyPost(`/api/family/safe-search/${profileId}`, { enabled }, `ss-${profileId}`)
  }

  async function toggleYouTubeRestrict(profileId: string, enabled: boolean) {
    await familyPost(`/api/family/youtube-restrict/${profileId}`, { enabled }, `yt-${profileId}`)
  }

  async function toggleProfileApp(profileId: string, app: string, block: boolean) {
    setFamilyBusy(prev => ({ ...prev, [`app-${profileId}-${app}`]: true }))
    try {
      await fetch('/api/router/pihole/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, block }) })
      // Update blockedApps in family data
      const profile = familyData?.profiles.find(p => p.id === profileId)
      if (profile) {
        const newBlocked = block
          ? Array.from(new Set([...profile.blockedApps, app]))
          : profile.blockedApps.filter((a: string) => a !== app)
        await familyPost('/api/family/profiles', { profileId, updates: { blockedApps: newBlocked } }, undefined)
      }
    } finally {
      setFamilyBusy(prev => ({ ...prev, [`app-${profileId}-${app}`]: false }))
    }
  }

  async function toggleHomeworkMode(profileId: string, enabled: boolean) {
    await familyPost('/api/family/profiles', { profileId, updates: { homeworkMode: enabled } }, `hw-${profileId}`)
  }

  async function updateCurfew(profileId: string, field: 'weekday' | 'weekend', value: string) {
    const profile = familyData?.profiles.find(p => p.id === profileId)
    if (!profile) return
    await familyPost('/api/family/profiles', { profileId, updates: { curfew: { ...profile.curfew, [field]: value } } })
  }

  async function assignDevice(mac: string, name: string, type: string, ip: string, profileId: string | null, vendor?: string, hostname?: string, randomizedMac?: boolean) {
    setAssigningDevice(mac)
    try {
      await fetch('/api/family/assign-device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac, name, type, ip, profileId, vendor, hostname, randomizedMac }) })
      const d = await fetch('/api/family/profiles').then(r => r.json())
      setFamilyData(d)
    } finally { setAssigningDevice(null) }
  }

  async function loadFamilyActivity(profileId: string) {
    const res = await fetch(`/api/family/activity/${profileId}`).then(r => r.json())
    setFamilyActivity(prev => ({ ...prev, [profileId]: res.queries || [] }))
  }

  function minutesUntilCurfew(profile: FamilyProfile): number | null {
    if (!profile.devices.length) return null
    const now = new Date()
    const isWeekend = now.getDay() === 0 || now.getDay() === 5 || now.getDay() === 6
    const curfewStr = isWeekend && profile.weekendOverride ? profile.curfew.weekend : profile.curfew.weekday
    const [ch, cm] = curfewStr.split(':').map(Number)
    const curfewMins = ch * 60 + cm + (profile.bonusMinutes || 0)
    const nowMins = now.getHours() * 60 + now.getMinutes()
    const diff = curfewMins - nowMins
    return diff > 0 ? diff : 0
  }

  // ── Derived family data ────────────────────────────────────────────────────
  const allAssignedMacs = new Set(
    (familyData?.profiles || []).flatMap(p => p.devices.map(d => d.mac.toUpperCase()))
  )
  const unassignedDevices = (routerData?.devices || []).filter(
    d => !allAssignedMacs.has(d.mac.toUpperCase())
  )

  const devices = routerData?.devices || []
  const summary = pihole?.summary
  const totalQ   = summary?.queries_today     ?? summary?.dns_queries_today ?? 0
  const blockedQ = summary?.queries_blocked   ?? summary?.ads_blocked_today ?? 0
  const blockPct = totalQ ? ((blockedQ / totalQ) * 100).toFixed(1) : '0'

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: '8px', fontSize: '13px' }}>
      <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Connecting to router...
    </div>
  )

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1280px', margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(94,106,210,0.12)', border: '1px solid rgba(94,106,210,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
            <RouterIcon size={16} />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text)' }}>Router Control</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', gap: '8px' }}>
              <span>NETGEAR Orbi RBR750</span>
              <span style={{ color: piholeOnline ? '#26c26e' : '#e05c5c' }}>
                {piholeOnline ? '● Pi-hole active' : '○ Pi-hole offline'}
              </span>
            </div>
          </div>
        </div>
        <button onClick={loadAll} disabled={refreshing} style={{ ...BTN, background: 'rgba(255,255,255,0.05)', color: 'var(--muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <RefreshCw size={12} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'WAN IP',      value: routerData?.wanIp || '—',             icon: <Globe size={13} />,     color: '#5e6ad2' },
          { label: 'Devices',     value: `${devices.length} online`,             icon: <Wifi size={13} />,      color: '#26c26e' },
          { label: 'Blocked',     value: `${devices.filter(d=>d.blocked).length} paused`, icon: <ShieldOff size={13} />, color: devices.filter(d=>d.blocked).length ? '#e05c5c' : 'rgba(255,255,255,0.25)' },
          { label: 'DNS Queries', value: piholeOnline ? fmtNum(totalQ) : '—',   icon: <Activity size={13} />,  color: '#5e6ad2' },
          { label: 'Blocked DNS', value: piholeOnline ? `${blockPct}%` : '—',   icon: <Shield size={13} />,    color: piholeOnline ? '#f5a623' : 'rgba(255,255,255,0.25)' },
        ].map(s => (
          <div key={s.label} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px' }}>
            <div style={{ color: s.color }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)' }}>{s.value}</div>
              <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            ...BTN, padding: '7px 12px', borderRadius: '7px 7px 0 0', fontSize: '11px',
            background: tab === t.id ? 'rgba(94,106,210,0.12)' : 'transparent',
            color: tab === t.id ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: '-1px',
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: DEVICES                                                   */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === 'devices' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '14px' }}>
          <div style={CARD}>
            <div style={LABEL}>Connected Devices ({devices.length})</div>
            {devices.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '12px', textAlign: 'center', padding: '24px' }}>No devices found</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {devices.map(d => {
                const name = nameMap[d.mac] || d.name
                return (
                  <div key={d.mac} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '7px', background: d.blocked ? 'rgba(224,92,92,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${d.blocked ? 'rgba(224,92,92,0.12)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div style={{ color: d.blocked ? '#e05c5c' : 'rgba(38,194,110,0.8)' }}>{deviceIcon(name, d.type)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingName === d.mac
                        ? <form onSubmit={e => { e.preventDefault(); saveName(d.mac) }}><input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)} onBlur={() => saveName(d.mac)} style={{ fontSize: '12px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(94,106,210,0.4)', borderRadius: '4px', color: 'var(--text)', padding: '2px 6px', width: '160px' }} /></form>
                        : <div style={{ fontSize: '12px', fontWeight: '500', color: d.blocked ? '#e05c5c' : 'var(--text)', cursor: 'pointer' }} onClick={() => { setEditingName(d.mac); setNameInput(name) }}>{name}</div>}
                      <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'monospace' }}>{d.ip}</div>
                    </div>
                    {piholeOnline && (
                      <button onClick={() => loadClientQueries(d.ip)} style={{ ...BTN, padding: '3px 7px', fontSize: '10px', background: selectedClient === d.ip ? 'rgba(94,106,210,0.15)' : 'rgba(255,255,255,0.04)', color: selectedClient === d.ip ? 'var(--accent)' : 'var(--muted)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <Eye size={10} /> History
                      </button>
                    )}
                    <button onClick={() => toggleBlock(d.mac, d.blocked)} disabled={blocking === d.mac} style={{ ...BTN, padding: '4px 8px', fontSize: '10px', background: d.blocked ? 'rgba(38,194,110,0.1)' : 'rgba(224,92,92,0.1)', color: d.blocked ? '#26c26e' : '#e05c5c', border: `1px solid ${d.blocked ? 'rgba(38,194,110,0.2)' : 'rgba(224,92,92,0.2)'}`, opacity: blocking === d.mac ? 0.5 : 1 }}>
                      {d.blocked ? <><Unlock size={10} /> Unblock</> : <><Lock size={10} /> Block</>}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Device query history sidebar */}
          <div style={CARD}>
            {selectedClient ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={LABEL}>History — {nameMap[selectedClient] || selectedClient}</div>
                  <button onClick={() => setSelectedClient(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '14px' }}>×</button>
                </div>
                {clientQueries.length === 0
                  ? <div style={{ color: 'var(--muted)', fontSize: '11px' }}>No queries found</div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '420px', overflowY: 'auto' }}>
                      {clientQueries.slice(0, 80).map((q: any, i: number) => {
                        const domain = q.domain ?? q[2] ?? ''
                        const status = q.status ?? q[4] ?? 0
                        const isBlocked = status === 1 || status === 5 || status === 6
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.015)' }}>
                            {isBlocked
                              ? <XCircle size={9} style={{ color: '#e05c5c', flexShrink: 0 }} />
                              : <CheckCircle size={9} style={{ color: '#26c26e', flexShrink: 0 }} />}
                            <span style={{ fontSize: '10px', color: isBlocked ? 'rgba(224,92,92,0.8)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{domain}</span>
                          </div>
                        )
                      })}
                    </div>}
              </>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: '11px', textAlign: 'center', padding: '40px 0' }}>
                <Eye size={20} style={{ opacity: 0.3, marginBottom: '8px', display: 'block', margin: '0 auto 8px' }} />
                Click "History" on any device to see their DNS activity
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: APP CONTROLS                                              */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === 'apps' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '14px' }}>
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={LABEL}>App & Site Controls</div>
              <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
                {piholeOnline ? 'Blocked via Pi-hole DNS' : 'Blocked via router keyword filter'}
              </div>
            </div>

            {(Object.entries(PRESET_CATEGORIES) as [string, {label:string,color:string}][]).map(([catKey, cat]) => {
              const apps = Object.entries(APP_PRESETS).filter(([, p]) => p.category === catKey)
              if (!apps.length) return null
              return (
                <div key={catKey} style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '9px', fontWeight: '700', color: cat.color, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px', opacity: 0.8 }}>
                    {cat.label}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                    {apps.map(([key, preset]) => {
                      const isBlocked = appStatus[key] === true
                      const isToggling = togglingApp === key
                      return (
                        <button key={key} onClick={() => toggleApp(key, isBlocked)} disabled={isToggling}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                            background: isBlocked ? 'rgba(224,92,92,0.08)' : 'rgba(38,194,110,0.06)',
                            borderTop: `2px solid ${isBlocked ? 'rgba(224,92,92,0.25)' : 'rgba(38,194,110,0.2)'}`,
                            opacity: isToggling ? 0.6 : 1, transition: 'all 0.15s',
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <span style={{ fontSize: '14px' }}>{preset.emoji}</span>
                            <span style={{ fontSize: '11px', fontWeight: '500', color: 'var(--text)' }}>{preset.label}</span>
                          </div>
                          <div style={{
                            width: '28px', height: '16px', borderRadius: '8px', position: 'relative',
                            background: isBlocked ? '#e05c5c' : '#26c26e',
                            transition: 'background 0.2s', flexShrink: 0,
                          }}>
                            <div style={{
                              position: 'absolute', top: '2px', width: '12px', height: '12px',
                              borderRadius: '50%', background: 'white',
                              left: isBlocked ? '2px' : '14px', transition: 'left 0.2s',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                            }} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Quick router keyword blocker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={CARD}>
              <div style={LABEL}>Router Keyword Filter</div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '10px', lineHeight: '1.5' }}>
                Blocks any URL containing these words — works even without Pi-hole
              </div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKeyword()} placeholder="keyword or domain..." style={{ flex: 1, fontSize: '11px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text)', padding: '6px 8px', outline: 'none' }} />
                <button onClick={addKeyword} disabled={!newKw.trim()} style={{ ...BTN, background: 'rgba(94,106,210,0.15)', color: 'var(--accent)', border: '1px solid rgba(94,106,210,0.2)', padding: '5px 8px' }}><Plus size={12} /></button>
              </div>
              {keywords.length === 0
                ? <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', padding: '12px' }}>No keywords blocked</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {keywords.map(kw => (
                      <div key={kw} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: '5px', background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.12)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><ChevronRight size={10} style={{ color: '#f5a623' }} /><span style={{ fontSize: '11px', color: 'var(--text)' }}>{kw}</span></div>
                        <button onClick={() => removeKeyword(kw)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', padding: '2px', display: 'flex' }}><Trash2 size={11} /></button>
                      </div>
                    ))}
                  </div>}
            </div>

            {!piholeOnline && (
              <div style={{ ...CARD, background: 'rgba(94,106,210,0.04)', border: '1px solid rgba(94,106,210,0.15)' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <AlertTriangle size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '1px' }} />
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text)', marginBottom: '4px' }}>Pi-hole not connected</div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', lineHeight: '1.5' }}>App toggles need Pi-hole running on your NAS. Router keyword filter still works without it.</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: DNS INSIGHTS                                              */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === 'dns' && (
        <div>
          {!piholeOnline ? (
            <div style={{ ...CARD, textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
              <Activity size={32} style={{ opacity: 0.2, marginBottom: '12px' }} />
              <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text)', marginBottom: '8px' }}>Pi-hole is starting up</div>
              <div style={{ fontSize: '12px', lineHeight: '1.6', maxWidth: '380px', margin: '0 auto' }}>
                Pi-hole is deploying on your NAS. Once it's ready and your router DNS is pointed to it, you'll see per-device browsing history, blocked queries, and top sites here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={CARD}>
                <div style={LABEL}>Top Domains (24h)</div>
                {(pihole?.topDomains?.domains ?? pihole?.topDomains?.top_queries ?? []).slice(0, 15).map((entry: any, i: number) => {
                  const [domain, count] = Array.isArray(entry) ? entry : [entry.domain, entry.count]
                  const max = (pihole?.topDomains?.domains?.[0]?.[1] ?? pihole?.topDomains?.top_queries?.[0]?.[1] ?? count) || 1
                  return (
                    <div key={i} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                        <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{domain}</span>
                        <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{fmtNum(count)}</span>
                      </div>
                      <div style={{ height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)' }}>
                        <div style={{ height: '100%', borderRadius: '2px', background: 'var(--accent)', width: `${(count / max) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={CARD}>
                <div style={LABEL}>Top Blocked Domains (24h)</div>
                {(pihole?.topBlocked?.domains ?? pihole?.topBlocked?.top_ads ?? []).slice(0, 15).map((entry: any, i: number) => {
                  const [domain, count] = Array.isArray(entry) ? entry : [entry.domain, entry.count]
                  const max = (pihole?.topBlocked?.domains?.[0]?.[1] ?? pihole?.topBlocked?.top_ads?.[0]?.[1] ?? count) || 1
                  return (
                    <div key={i} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                        <span style={{ color: '#e05c5c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{domain}</span>
                        <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{fmtNum(count)}</span>
                      </div>
                      <div style={{ height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)' }}>
                        <div style={{ height: '100%', borderRadius: '2px', background: '#e05c5c', width: `${(count / max) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={CARD}>
                <div style={LABEL}>Top Clients (24h)</div>
                {(pihole?.clients?.clients ?? []).slice(0, 10).map((c: any, i: number) => {
                  const ip = c.ip ?? c[0] ?? ''
                  const name = nameMap[ip] || c.name || ip
                  const count = c.count ?? c[1] ?? 0
                  const device = devices.find(d => d.ip === ip)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ color: 'rgba(38,194,110,0.7)' }}>{device ? deviceIcon(nameMap[device.mac] || device.name) : <Wifi size={12} />}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '11px', color: 'var(--text)' }}>{name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'monospace' }}>{ip}</div>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent)' }}>{fmtNum(count)}</div>
                      <button onClick={() => { setTab('devices'); loadClientQueries(ip) }} style={{ ...BTN, padding: '3px 7px', fontSize: '10px', background: 'rgba(255,255,255,0.04)', color: 'var(--muted)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <Eye size={10} />
                      </button>
                    </div>
                  )
                })}
              </div>

              <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={LABEL}>Pi-hole Summary</div>
                  <a href={`http://192.168.1.46:8090/admin`} target="_blank" rel="noreferrer" style={{ fontSize: '10px', color: 'var(--accent)', textDecoration: 'none' }}>Open Pi-hole →</a>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'Queries today',    value: fmtNum(totalQ) },
                    { label: 'Blocked today',    value: fmtNum(blockedQ) },
                    { label: 'Block rate',        value: `${blockPct}%` },
                    { label: 'Domains on list',  value: fmtNum(summary?.domains_blocked ?? summary?.domains_being_blocked ?? 0) },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '7px', padding: '10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '2px' }}>{s.value}</div>
                      <div style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: PORT FORWARDS                                             */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === 'ports' && (
        <div style={CARD}>
          <div style={LABEL}>Active Port Forwards</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(routerData?.ports || []).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '7px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(94,106,210,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: 'var(--accent)', fontFamily: 'monospace', flexShrink: 0 }}>{p.proto}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text)' }}>{p.desc || 'Unnamed Rule'}</div>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'monospace' }}>External :{p.exPort} → {p.intIp}:{p.intPort}</div>
                </div>
                <div style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '20px', background: 'rgba(38,194,110,0.08)', color: '#26c26e', border: '1px solid rgba(38,194,110,0.15)' }}>Active</div>
              </div>
            ))}
            {(!routerData?.ports?.length) && <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '20px', textAlign: 'center' }}>No port forwards found</div>}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: SCREEN TIME                                               */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === 'screentime' && (
        <ScreenTimeTab familyData={familyData} styles={{ CARD, LABEL, BTN }} />
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB: FAMILY                                                    */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === 'family' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* ── Dinner Mode Banner ── */}
          <div style={{ ...CARD, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderColor: familyData?.dinnerMode ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.07)', background: familyData?.dinnerMode ? 'rgba(245,166,35,0.06)' : 'rgba(255,255,255,0.025)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '22px' }}>🍽️</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: familyData?.dinnerMode ? '#f5a623' : 'var(--text)' }}>
                  {familyData?.dinnerMode ? 'Dinner Mode is ON — everyone is offline' : 'Dinner Mode'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {familyData?.dinnerMode
                    ? `Started ${familyData.dinnerModeStartedAt ? new Date(familyData.dinnerModeStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''} — tap to end`
                    : 'Pause the whole house — every device goes quiet'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {familyData?.dinnerMode && (
                <button onClick={() => toggleDinnerMode(false)} disabled={dinnerBusy} style={{ ...BTN, background: 'rgba(38,194,110,0.12)', color: '#26c26e', border: '1px solid rgba(38,194,110,0.2)', fontSize: '12px', padding: '7px 14px' }}>
                  ✓ End Dinner Mode
                </button>
              )}
              {!familyData?.dinnerMode && (
                <button onClick={() => toggleDinnerMode(true)} disabled={dinnerBusy} style={{ ...BTN, background: 'rgba(245,166,35,0.12)', color: '#f5a623', border: '1px solid rgba(245,166,35,0.2)', fontSize: '12px', padding: '7px 14px' }}>
                  {dinnerBusy ? '...' : '🍽️ Start Dinner Mode'}
                </button>
              )}
            </div>
          </div>

          {/* ── New Devices Tray ── */}
          {unassignedDevices.length > 0 && (
            <div style={{ ...CARD, borderColor: 'rgba(94,106,210,0.2)', background: 'rgba(94,106,210,0.04)' }}>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' }}>👋 Who do these devices belong to?</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Give each one a name and pick who it belongs to — or mark it as not a family device.</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {unassignedDevices.map(d => {
                  const nickname = deviceNicknames[d.mac] ?? ''
                  const displayLabel = d.randomizedMac
                    ? 'Apple device (iPhone or iPad)'
                    : (d.vendor && !d.vendor.toLowerCase().includes('randomized') ? d.vendor : (d.name || 'Unknown device'))
                  return (
                    <div key={d.mac} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      {/* Icon */}
                      <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
                        <span style={{ fontSize: '16px' }}>
                          {d.type === 'iphone' || d.type === 'ipad' ? '📱' :
                           d.type === 'computer' ? '💻' :
                           d.type === 'tv' ? '📺' :
                           d.type === 'router' ? '📡' :
                           d.type === 'nas' ? '🗄️' :
                           d.type === 'hub' ? '💡' :
                           d.type === 'speaker' ? '🔊' :
                           d.vendor?.toLowerCase().includes('nintendo') ? '🎮' : '📶'}
                        </span>
                      </div>

                      {/* Name + make */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '5px' }}>
                          {displayLabel}
                        </div>
                        <input
                          value={nickname}
                          onChange={e => setDeviceNicknames(prev => ({ ...prev, [d.mac]: e.target.value }))}
                          placeholder={`Name this device (e.g. "Liam's iPhone")`}
                          style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', fontWeight: '600', padding: '6px 10px', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>

                      {/* Assign dropdown */}
                      <select
                        value=""
                        onChange={e => {
                          const val = e.target.value
                          if (!val) return
                          const finalName = nickname.trim() || displayLabel
                          assignDevice(d.mac, finalName, d.type, d.ip, val === 'ignore' ? null : val, d.vendor, d.hostname, d.randomizedMac)
                        }}
                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px', padding: '8px 10px', cursor: 'pointer', flexShrink: 0 }}
                      >
                        <option value="">Who owns this? ▾</option>
                        {(familyData?.profiles || []).map(p => (
                          <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
                        ))}
                        <option value="ignore">— Not a family device</option>
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Child Profile Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '14px' }}>
            {(familyData?.profiles || []).map(profile => {
              const minsLeft = minutesUntilCurfew(profile)
              const isExpanded = expandedProfile === profile.id
              const activity = familyActivity[profile.id] || []
              const isProfileBusy = (key: string) => familyBusy[`${key}-${profile.id}`]

              return (
                <div key={profile.id} style={{ ...CARD, borderColor: profile.paused ? 'rgba(224,92,92,0.2)' : `${profile.color}22`, display: 'flex', flexDirection: 'column', gap: '14px' }}>

                  {/* Profile header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: `${profile.color}18`, border: `1px solid ${profile.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                        {profile.emoji}
                      </div>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text)' }}>{profile.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
                          {profile.devices.length === 0
                            ? 'No devices assigned yet'
                            : `${profile.devices.length} device${profile.devices.length > 1 ? 's' : ''}`}
                          {profile.paused && <span style={{ color: '#e05c5c', marginLeft: '6px' }}>● Internet off</span>}
                        </div>
                      </div>
                    </div>
                    {minsLeft !== null && minsLeft > 0 && !profile.paused && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: minsLeft < 30 ? '#f5a623' : 'var(--muted)' }}>
                          {minsLeft < 60 ? `${minsLeft}m left tonight` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left`}
                        </div>
                        {profile.bonusMinutes > 0 && (
                          <div style={{ fontSize: '10px', color: '#26c26e' }}>+{profile.bonusMinutes}m bonus</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Assigned devices */}
                  {profile.devices.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {profile.devices.map(d => (
                        <div key={d.mac} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', borderRadius: '20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', fontSize: '10px', color: 'var(--muted)' }} title={d.vendor ? `${d.vendor} · ${d.mac}` : d.mac}>
                          {deviceIcon(d.name, d.type)}
                          <span>{d.name}</span>
                          {d.vendor && d.vendor !== d.name && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px' }}>({d.vendor})</span>}
                          <button onClick={() => assignDevice(d.mac, d.name, d.type, d.ip || '', null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: '0 0 0 2px', fontSize: '10px', lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Big pause button */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {profile.paused ? (
                      <button onClick={() => togglePause(profile.id, true)} disabled={isProfileBusy('pause')} style={{ ...BTN, flex: 1, justifyContent: 'center', padding: '10px', background: 'rgba(38,194,110,0.1)', color: '#26c26e', border: '1px solid rgba(38,194,110,0.2)', fontSize: '12px', fontWeight: '600' }}>
                        <Wifi size={13} /> {isProfileBusy('pause') ? '...' : `Turn ${profile.name}'s Internet Back On`}
                      </button>
                    ) : (
                      <button onClick={() => togglePause(profile.id, false)} disabled={isProfileBusy('pause') || profile.devices.length === 0} style={{ ...BTN, flex: 1, justifyContent: 'center', padding: '10px', background: 'rgba(224,92,92,0.08)', color: '#e05c5c', border: '1px solid rgba(224,92,92,0.15)', fontSize: '12px', fontWeight: '600', opacity: profile.devices.length === 0 ? 0.4 : 1 }}>
                        <WifiOff size={13} /> {isProfileBusy('pause') ? '...' : `Pause ${profile.name}'s Internet`}
                      </button>
                    )}
                    <button onClick={() => addBonusTime(profile.id, 15)} disabled={isProfileBusy('bonus')} title="Give 15 extra minutes tonight" style={{ ...BTN, padding: '10px 12px', background: 'rgba(38,194,110,0.06)', color: '#26c26e', border: '1px solid rgba(38,194,110,0.12)', fontSize: '11px' }}>
                      <Timer size={12} /> +15 min
                    </button>
                  </div>

                  {/* Homework Mode */}
                  <button onClick={() => toggleHomeworkMode(profile.id, !profile.homeworkMode)} disabled={isProfileBusy('hw')} style={{ ...BTN, justifyContent: 'center', padding: '9px', background: profile.homeworkMode ? 'rgba(94,106,210,0.12)' : 'rgba(255,255,255,0.03)', color: profile.homeworkMode ? '#5e6ad2' : 'var(--muted)', border: `1px solid ${profile.homeworkMode ? 'rgba(94,106,210,0.2)' : 'rgba(255,255,255,0.07)'}` }}>
                    <BookOpen size={12} />
                    {profile.homeworkMode ? '📚 Homework Mode ON — only school sites allowed' : '📚 Homework Mode — block everything except school sites'}
                  </button>

                  {/* Safety toggles */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[
                      { key: 'safeSearch', label: 'Safe Search', desc: 'Google & Bing show kid-friendly results only', icon: '🔍', busy: 'ss', action: () => toggleSafeSearch(profile.id, !profile.safeSearch) },
                      { key: 'youtubeRestricted', label: 'Safe YouTube', desc: 'Hides mature videos on YouTube', icon: '▶️', busy: 'yt', action: () => toggleYouTubeRestrict(profile.id, !profile.youtubeRestricted) },
                    ].map(toggle => {
                      const isOn = profile[toggle.key as keyof FamilyProfile] as boolean
                      return (
                        <button key={toggle.key} onClick={toggle.action} disabled={!!familyBusy[`${toggle.busy}-${profile.id}`]} style={{ ...BTN, flexDirection: 'column', alignItems: 'flex-start', gap: '3px', padding: '10px 12px', background: isOn ? `${profile.color}10` : 'rgba(255,255,255,0.02)', border: `1px solid ${isOn ? profile.color + '30' : 'rgba(255,255,255,0.07)'}`, borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '600', color: isOn ? profile.color : 'var(--muted)' }}>
                            <span>{toggle.icon}</span> {toggle.label}
                            <span style={{ marginLeft: 'auto', fontSize: '10px', color: isOn ? '#26c26e' : 'rgba(255,255,255,0.2)' }}>{isOn ? 'ON' : 'OFF'}</span>
                          </div>
                          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', textAlign: 'left' }}>{toggle.desc}</div>
                        </button>
                      )
                    })}
                  </div>

                  {/* App blocks */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginBottom: '8px' }}>Block these apps for {profile.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                      {['tiktok','instagram','snapchat','discord','twitter','youtube','netflix','roblox','fortnite','minecraft','twitch'].map(appKey => {
                        const preset = APP_PRESETS[appKey]
                        if (!preset) return null
                        const isBlocked = profile.blockedApps.includes(appKey) || appStatus[appKey]
                        const isBusy = familyBusy[`app-${profile.id}-${appKey}`]
                        return (
                          <button key={appKey} onClick={() => toggleProfileApp(profile.id, appKey, !isBlocked)} disabled={isBusy} style={{ ...BTN, padding: '5px 10px', fontSize: '10px', background: isBlocked ? 'rgba(224,92,92,0.1)' : 'rgba(255,255,255,0.04)', color: isBlocked ? '#e05c5c' : 'var(--muted)', border: `1px solid ${isBlocked ? 'rgba(224,92,92,0.2)' : 'rgba(255,255,255,0.07)'}`, textDecoration: isBlocked ? 'line-through' : 'none', opacity: isBusy ? 0.5 : 1 }}>
                            {preset.emoji} {preset.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Bedtime settings */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {(['weekday', 'weekend'] as const).map(day => (
                      <div key={day} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px' }}>
                        <div style={{ ...LABEL, marginBottom: '6px' }}>
                          <Moon size={9} style={{ display: 'inline', marginRight: '4px' }} />
                          {day === 'weekday' ? 'School Night Bedtime' : 'Weekend Bedtime'}
                        </div>
                        <input
                          type="time"
                          value={profile.curfew[day]}
                          onChange={e => updateCurfew(profile.id, day, e.target.value)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '14px', fontWeight: '600', width: '100%', cursor: 'pointer' }}
                        />
                        {day === 'weekday' && profile.weekendOverride && (
                          <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '3px' }}>Fri/Sat/Sun auto +1hr</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Live activity feed toggle */}
                  <button
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedProfile(null)
                      } else {
                        setExpandedProfile(profile.id)
                        loadFamilyActivity(profile.id)
                      }
                    }}
                    style={{ ...BTN, justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--muted)', fontSize: '11px' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Eye size={11} /> What is {profile.name} browsing?</span>
                    <ChevronRight size={11} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>

                  {isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '220px', overflowY: 'auto' }}>
                      {activity.length === 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '12px', textAlign: 'center' }}>
                          {profile.devices.filter(d => d.ip).length === 0 ? 'Assign devices with IPs to see activity' : 'No recent browsing activity'}
                        </div>
                      )}
                      {activity.slice(0, 30).map((q: any, i: number) => {
                        const blocked = q.status === 'GRAVITY' || q.status === 'REGEX' || q.status === 'BLACKLIST' || q.type === 'blocked'
                        const domain = q.query || q.domain || q.name || '?'
                        const ts = q.time ? new Date(q.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '5px', background: blocked ? 'rgba(224,92,92,0.04)' : 'rgba(255,255,255,0.01)' }}>
                            <div style={{ width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0, background: blocked ? '#e05c5c' : 'rgba(38,194,110,0.6)' }} />
                            <span style={{ flex: 1, fontSize: '11px', color: blocked ? '#e05c5c80' : 'var(--muted)', textDecoration: blocked ? 'line-through' : 'none', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</span>
                            {q.deviceName && <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)' }}>{q.deviceName}</span>}
                            {ts && <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{ts}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        input::placeholder { color: rgba(255,255,255,0.2) }
        ::-webkit-scrollbar { width: 4px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px }
      `}</style>
    </div>
  )
}
