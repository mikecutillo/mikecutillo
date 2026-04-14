'use client'

import { useEffect, useState, useCallback } from 'react'
import { useVisibilityInterval } from '@/hooks/use-visibility-interval'
import {
  Monitor, Clock, Gamepad2, Tv, MessageCircle, Globe, BookOpen,
  ChevronDown, ChevronRight, Search, RefreshCw, Wifi, WifiOff,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../lib/pc-categories'
import type { AppCategory, PcDeviceEntry, PcWeeklySummary } from '../lib/pc-activity'
import type { FamilyData } from '../lib/family-data'

// ─── Types ───────────────────────────────────────────────────────────────────
interface DeviceStatus extends PcDeviceEntry {
  isOnline: boolean
  isIdle: boolean
}

interface HourlyBucket {
  hour: number
  categories: Record<AppCategory, number>
}

interface DeviceReport {
  hostname: string
  timestamp: string
  windowsUser: string
  foreground: { processName: string; windowTitle: string } | null
  idleSeconds: number
  processes: { name: string; pid: number; cpu: number; memMb: number }[]
  browserHistory: { url: string; title: string; visitTime: string; browser: string }[]
}

interface Props {
  familyData: FamilyData | null
  styles: {
    CARD: React.CSSProperties
    LABEL: React.CSSProperties
    BTN: React.CSSProperties
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function statusColor(d: DeviceStatus): string {
  if (!d.isOnline) return '#e05c5c'
  if (d.isIdle) return '#f5a623'
  return '#26c26e'
}

function statusLabel(d: DeviceStatus): string {
  if (!d.isOnline) return 'Offline'
  if (d.isIdle) return 'Idle'
  return 'Active'
}

const CATEGORIES: AppCategory[] = ['gaming', 'video', 'social', 'browsing', 'productivity', 'other']

const CATEGORY_ICONS: Record<AppCategory, React.ReactNode> = {
  gaming: <Gamepad2 size={10} />,
  video: <Tv size={10} />,
  social: <MessageCircle size={10} />,
  browsing: <Globe size={10} />,
  productivity: <BookOpen size={10} />,
  other: <Monitor size={10} />,
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ScreenTimeTab({ familyData, styles }: Props) {
  const { CARD, LABEL, BTN } = styles

  const [devices, setDevices] = useState<Record<string, DeviceStatus>>({})
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)
  const [hourly, setHourly] = useState<HourlyBucket[]>([])
  const [reports, setReports] = useState<DeviceReport[]>([])
  const [summaries, setSummaries] = useState<PcWeeklySummary[]>([])
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(new Set())
  const [historyFilter, setHistoryFilter] = useState('')
  const [loading, setLoading] = useState(true)


  // ─── Data fetching ─────────────────────────────────────────────────────────
  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/family/pc-report')
      const data = await res.json()
      setDevices(data.devices || {})
    } catch { /* silent */ }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/family/pc-report/summary')
      const data = await res.json()
      setSummaries(data.summaries || [])
    } catch { /* silent */ }
  }, [])

  const loadDeviceDetail = useCallback(async (hostname: string) => {
    try {
      const res = await fetch(`/api/family/pc-report/${encodeURIComponent(hostname)}`)
      const data = await res.json()
      setHourly(data.hourly || [])
      setReports(data.reports || [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([loadDevices(), loadSummary()])
      setLoading(false)
    }
    init()
  }, [loadDevices, loadSummary])
  useVisibilityInterval(loadDevices, 30_000)

  useEffect(() => {
    if (selectedDevice) loadDeviceDetail(selectedDevice)
  }, [selectedDevice, loadDeviceDetail])

  // ─── Derived data ──────────────────────────────────────────────────────────
  const deviceList = Object.entries(devices)
  const profileName = (profileId: string | null) => {
    if (!profileId || !familyData) return 'Shared'
    const p = familyData.profiles.find(pr => pr.id === profileId)
    return p ? `${p.emoji} ${p.name}` : 'Shared'
  }

  // Chart data from hourly buckets
  const chartData = hourly.map(h => ({
    hour: `${h.hour}:00`,
    ...h.categories,
  }))

  // Filter browser history
  const filteredHistory = reports
    .flatMap(r => (r.browserHistory || []).map(b => ({ ...b, deviceTime: r.timestamp })))
    .filter(b => {
      if (!historyFilter) return true
      const q = historyFilter.toLowerCase()
      return b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)
    })
    .slice(0, 100)

  // Latest report for selected device (for live process list)
  const latestReport = selectedDevice
    ? reports.find(r => r.hostname === selectedDevice)
    : null

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.4)' }}>
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: '10px' }} />
        <div style={{ fontSize: '12px' }}>Loading screen time data...</div>
      </div>
    )
  }

  if (deviceList.length === 0) {
    return (
      <div style={{ ...CARD, textAlign: 'center', padding: '40px' }}>
        <Monitor size={28} style={{ color: 'rgba(255,255,255,0.3)', marginBottom: '12px' }} />
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
          No PCs reporting yet
        </div>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', maxWidth: '400px', margin: '0 auto' }}>
          Install the monitoring agent on each Windows PC to start collecting screen time data.
          See <code style={{ color: '#5e6ad2' }}>scripts/pc-monitor/install.ps1</code> for setup instructions.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* ─── Device Status Cards ──────────────────────────────────────────── */}
      <div style={LABEL}>Devices</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(deviceList.length, 3)}, 1fr)`, gap: '10px' }}>
        {deviceList.map(([hostname, device]) => (
          <div
            key={hostname}
            onClick={() => setSelectedDevice(selectedDevice === hostname ? null : hostname)}
            style={{
              ...CARD,
              cursor: 'pointer',
              border: selectedDevice === hostname
                ? '1px solid rgba(94,106,210,0.5)'
                : CARD.border,
              transition: 'all 0.15s',
            }}
          >
            {/* Status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: statusColor(device),
                boxShadow: device.isOnline ? `0 0 6px ${statusColor(device)}` : 'none',
              }} />
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#fff', flex: 1 }}>
                {device.displayName || hostname}
              </span>
              <span style={{
                fontSize: '9px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px',
                background: `${statusColor(device)}22`, color: statusColor(device),
              }}>
                {statusLabel(device)}
              </span>
            </div>

            {/* Current activity */}
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>
              {device.isOnline && device.lastForeground
                ? <><strong style={{ color: '#fff' }}>{device.lastForeground.replace(/\.exe$/i, '')}</strong></>
                : 'No active app'}
            </div>

            {/* Footer: user + last seen + profile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                {device.lastUser || 'Unknown'}
              </span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>|</span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                {timeAgo(device.lastSeen)}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                {profileName(device.profileId)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Daily Usage Chart ────────────────────────────────────────────── */}
      {selectedDevice && chartData.length > 0 && (
        <>
          <div style={LABEL}>
            Daily Usage — {devices[selectedDevice]?.displayName || selectedDevice}
          </div>
          <div style={{ ...CARD, padding: '12px 12px 4px 0' }}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="hour"
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'min', position: 'insideTopLeft', fill: 'rgba(255,255,255,0.25)', fontSize: 9 }}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0d1117',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#fff',
                  }}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                {CATEGORIES.map(cat => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="a"
                    fill={CATEGORY_COLORS[cat]}
                    name={CATEGORY_LABELS[cat]}
                    radius={cat === 'other' ? [2, 2, 0, 0] : undefined}
                  />
                ))}
                <Legend
                  wrapperStyle={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}
                  iconSize={8}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ─── Weekly Summary + Live Processes ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        {/* Weekly Summary */}
        <div>
          <div style={LABEL}>Weekly Summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {summaries.length === 0 ? (
              <div style={{ ...CARD, fontSize: '11px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                No data yet — summaries appear after the first week of collection
              </div>
            ) : summaries.map(s => (
              <div key={s.hostname} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                  <Monitor size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#fff' }}>{s.displayName}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                    {profileName(s.profileId)}
                  </span>
                </div>

                {/* Total + daily avg */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ ...CARD, padding: '8px', background: 'rgba(255,255,255,0.015)' }}>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginBottom: '2px' }}>TOTAL</div>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>{fmtMinutes(s.totalMinutes)}</div>
                  </div>
                  <div style={{ ...CARD, padding: '8px', background: 'rgba(255,255,255,0.015)' }}>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginBottom: '2px' }}>DAILY AVG</div>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>{fmtMinutes(s.avgDailyMinutes)}</div>
                  </div>
                </div>

                {/* Category breakdown bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {CATEGORIES.filter(cat => (s.byCategory[cat] || 0) > 0).map(cat => {
                    const mins = s.byCategory[cat] || 0
                    const pct = s.totalMinutes > 0 ? (mins / s.totalMinutes) * 100 : 0
                    return (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '14px', display: 'flex', justifyContent: 'center' }}>
                          {CATEGORY_ICONS[cat]}
                        </span>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', width: '70px' }}>
                          {CATEGORY_LABELS[cat]}
                        </span>
                        <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: CATEGORY_COLORS[cat], borderRadius: '3px', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', width: '40px', textAlign: 'right' }}>
                          {fmtMinutes(mins)}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Top apps */}
                {s.topApps.length > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ ...LABEL, marginBottom: '4px' }}>Top Apps</div>
                    {s.topApps.map((app, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '14px' }}>{i + 1}.</span>
                        <span style={{ fontSize: '11px', color: '#fff', flex: 1 }}>{app.name}</span>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{fmtMinutes(app.minutes)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live Processes */}
        <div>
          <div style={LABEL}>
            {selectedDevice ? `Processes — ${devices[selectedDevice]?.displayName || selectedDevice}` : 'Processes'}
          </div>
          {!selectedDevice ? (
            <div style={{ ...CARD, fontSize: '11px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
              Select a device to view running processes
            </div>
          ) : !latestReport ? (
            <div style={{ ...CARD, fontSize: '11px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
              No recent reports for this device
            </div>
          ) : (
            <div style={CARD}>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <th style={{ ...LABEL, textAlign: 'left', padding: '4px 0' }}>Process</th>
                      <th style={{ ...LABEL, textAlign: 'right', padding: '4px 0', width: '60px' }}>CPU</th>
                      <th style={{ ...LABEL, textAlign: 'right', padding: '4px 0', width: '60px' }}>MEM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(latestReport.processes || []).map((p, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ fontSize: '11px', color: '#fff', padding: '3px 0' }}>{p.name}</td>
                        <td style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textAlign: 'right', padding: '3px 0' }}>
                          {p.cpu > 0 ? `${p.cpu}s` : '—'}
                        </td>
                        <td style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textAlign: 'right', padding: '3px 0' }}>
                          {p.memMb} MB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Browser History ──────────────────────────────────────────────── */}
      {selectedDevice && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ ...LABEL, marginBottom: 0 }}>
              Browser History — {devices[selectedDevice]?.displayName || selectedDevice}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '3px 8px' }}>
              <Search size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                type="text"
                value={historyFilter}
                onChange={e => setHistoryFilter(e.target.value)}
                placeholder="Filter URLs..."
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  color: '#fff', fontSize: '10px', width: '140px',
                }}
              />
            </div>
          </div>
          <div style={{ ...CARD, maxHeight: '250px', overflowY: 'auto' }}>
            {filteredHistory.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '20px' }}>
                {historyFilter ? 'No matching URLs' : 'No browser history collected yet'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {filteredHistory.map((entry, i) => {
                  let domain = ''
                  try { domain = new URL(entry.url).hostname.replace(/^www\./, '') } catch {}
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: entry.browser === 'chrome' ? '#4285f4' : '#0078d4',
                        flexShrink: 0,
                      }} />
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '120px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {domain}
                      </span>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.title || entry.url}
                      </span>
                      <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
                        {new Date(entry.visitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
