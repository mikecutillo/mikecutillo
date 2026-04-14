'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Shield,
  Globe,
  Router,
  RefreshCw,
  Filter,
  AlertTriangle,
  Info,
  LogIn,
  CalendarDays,
  FileText,
  Mail,
  Wifi,
  WifiOff,
  MessageSquare,
  ChevronRight,
  Settings,
  Trash2,
  Download,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react'
import TopNav from '@/components/top-nav'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilyIntelEvent {
  id: string
  timestamp: string
  source: 'microsoft' | 'google' | 'pihole' | 'manual'
  sourceDetail: string
  person: string
  device?: string
  category: string
  severity: 'info' | 'warning' | 'alert'
  title: string
  description: string
  domain?: string
  metadata: Record<string, unknown>
}

interface EventCounts {
  total: number
  byPerson: Record<string, number>
  bySource: Record<string, number>
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
}

interface SetupStatus {
  webhookBaseUrl: string | null
  sources: {
    microsoft: { configured: boolean; missingVars: string[]; capabilities: string[] }
    google:    { configured: boolean; missingVars: string[]; capabilities: string[] }
    pihole:    { configured: boolean; missingVars: string[]; capabilities: string[] }
  }
  subscriptions: Array<{ id: string; source: string; label: string; expiresAt: string; expired: boolean; expiresSoon: boolean }>
  piholeCursor:  { lastPollAt: string | null }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERSON_COLORS: Record<string, string> = {
  mike:    '#5E6AD2',
  erin:    '#ec4899',
  liam:    '#22c55e',
  clara:   '#f59e0b',
  shared:  '#06b6d4',
  unknown: '#6b7280',
}

const SEVERITY_COLORS: Record<string, string> = {
  info:    '#5E6AD2',
  warning: '#f59e0b',
  alert:   '#ef4444',
}

const SOURCE_LABELS: Record<string, string> = {
  microsoft: 'Microsoft',
  google:    'Google',
  pihole:    'Pi-hole',
  manual:    'Manual',
}

const PEOPLE   = ['mike', 'erin', 'liam', 'clara', 'shared', 'unknown']
const SOURCES  = ['microsoft', 'google', 'pihole', 'manual']
const CATS     = ['calendar', 'file', 'email', 'network', 'signin', 'security', 'communication']
const SEVS     = ['info', 'warning', 'alert']

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FamilyIntelPage() {
  const [events, setEvents]         = useState<FamilyIntelEvent[]>([])
  const [counts, setCounts]         = useState<EventCounts | null>(null)
  const [status, setStatus]         = useState<SetupStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [polling, setPolling]       = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)

  // Filters
  const [filterPerson,   setFilterPerson]   = useState<string>('')
  const [filterSource,   setFilterSource]   = useState<string>('')
  const [filterCat,      setFilterCat]      = useState<string>('')
  const [filterSeverity, setFilterSeverity] = useState<string>('')
  const [showSetup,      setShowSetup]      = useState(false)

  // ─── Data Fetching ──────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams({ limit: '300' })
    if (filterPerson)   params.set('person',   filterPerson)
    if (filterSource)   params.set('source',   filterSource)
    if (filterCat)      params.set('category', filterCat)
    if (filterSeverity) params.set('severity', filterSeverity)

    const res = await fetch(`/api/family-intel/events?${params}`)
    const data = await res.json()
    setEvents(data.events ?? [])
    setCounts(data.counts ?? null)
  }, [filterPerson, filterSource, filterCat, filterSeverity])

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/family-intel/setup')
    const data = await res.json()
    setStatus(data)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchEvents(), fetchStatus()])
    setLoading(false)
  }, [fetchEvents, fetchStatus])

  useEffect(() => { load() }, [load])

  const pollPihole = async () => {
    setPolling(true)
    await fetch('/api/family-intel/ingest/pihole', { method: 'GET' })
    await fetchEvents()
    await fetchStatus()
    setPolling(false)
  }

  const setupSubscriptions = async (source: string) => {
    setSetupLoading(true)
    await fetch('/api/family-intel/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    await fetchStatus()
    setSetupLoading(false)
  }

  const clearEvents = async () => {
    if (!confirm('Clear all events?')) return
    await fetch('/api/family-intel/events?all=true', { method: 'DELETE' })
    await fetchEvents()
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const todayCounts = events.filter(e => {
    const d = new Date(e.timestamp)
    const now = new Date()
    return d.getFullYear() === now.getFullYear() &&
           d.getMonth() === now.getMonth() &&
           d.getDate() === now.getDate()
  }).length

  const alertCount   = events.filter(e => e.severity === 'alert').length
  const warningCount = events.filter(e => e.severity === 'warning').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopNav
        crumbs={[
          { label: 'Cutillo Cloud' },
          { label: 'Family Intel', active: true },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={pollPihole} disabled={polling} style={btnStyle('#1a2035')}>
              <RefreshCw size={13} style={{ animation: polling ? 'spin-slow 1s linear infinite' : 'none' }} />
              {polling ? 'Polling…' : 'Poll Pi-hole'}
            </button>
            <button onClick={() => setShowSetup(v => !v)} style={btnStyle('#1a2035')}>
              <Settings size={13} />
              Setup
            </button>
            <button onClick={() => load()} style={btnStyle('#1a2035')}>
              <RefreshCw size={13} />
            </button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ─── Stats Row ──────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {[
            { label: 'Total Events',   value: counts?.total ?? events.length, color: '#5E6AD2', icon: <Activity size={16} /> },
            { label: 'Today',          value: todayCounts, color: '#10b981', icon: <Clock size={16} /> },
            { label: 'Alerts',         value: alertCount,   color: '#ef4444', icon: <AlertTriangle size={16} /> },
            { label: 'Warnings',       value: warningCount, color: '#f59e0b', icon: <Info size={16} /> },
            { label: 'Sources Active', value: status ? Object.values(status.sources).filter(s => s.configured).length : 0, color: '#06b6d4', icon: <CheckCircle size={16} /> },
          ].map(s => (
            <div key={s.label} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: s.color, marginBottom: 8 }}>
                {s.icon}
                <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Syne)' }}>
                {loading ? '—' : s.value}
              </div>
            </div>
          ))}
        </div>

        {/* ─── Source Health ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {status && [
            { key: 'microsoft', label: 'Microsoft Graph', icon: <Shield size={16} />, color: '#0078d4' },
            { key: 'google',    label: 'Google',           icon: <Globe size={16} />,  color: '#ea4335' },
            { key: 'pihole',    label: 'Pi-hole DNS',      icon: <Router size={16} />, color: '#10b981' },
          ].map(src => {
            const s = status.sources[src.key as keyof typeof status.sources]
            const isConfigured = s.configured
            return (
              <div key={src.key} style={{ ...cardStyle, borderLeft: `3px solid ${isConfigured ? src.color : '#374151'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: isConfigured ? src.color : 'var(--muted)' }}>
                    {src.icon}
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{src.label}</span>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    background: isConfigured ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    color: isConfigured ? '#10b981' : '#ef4444',
                  }}>
                    {isConfigured ? <CheckCircle size={10} /> : <XCircle size={10} />}
                    {isConfigured ? 'Active' : 'Not configured'}
                  </div>
                </div>

                {isConfigured ? (
                  <>
                    {src.key === 'pihole' && status.piholeCursor.lastPollAt && (
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>
                        Last poll: {relTime(status.piholeCursor.lastPollAt)}
                      </p>
                    )}
                    {src.key !== 'pihole' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {status.subscriptions.filter(sub => sub.source === src.key).map(sub => (
                          <div key={sub.id} style={{
                            padding: '2px 6px', borderRadius: 3, fontSize: 10,
                            background: sub.expired ? 'rgba(239,68,68,0.15)' : sub.expiresSoon ? 'rgba(245,158,11,0.15)' : 'rgba(94,106,210,0.15)',
                            color: sub.expired ? '#ef4444' : sub.expiresSoon ? '#f59e0b' : '#5E6AD2',
                          }}>
                            {sub.label}
                          </div>
                        ))}
                        {status.subscriptions.filter(sub => sub.source === src.key).length === 0 && (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>No active subscriptions</span>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    <p style={{ fontSize: 11, color: '#ef4444', margin: '0 0 4px' }}>Missing:</p>
                    {s.missingVars.map(v => (
                      <span key={v} style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 3, fontSize: 10, background: 'rgba(239,68,68,0.1)', color: '#ef4444', marginRight: 4, marginBottom: 2 }}>
                        {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ─── Setup Panel ─────────────────────────────────────────────────── */}
        {showSetup && status && (
          <div style={{ ...cardStyle, borderColor: 'rgba(94,106,210,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Webhook Setup
              </h3>
              <button onClick={() => setShowSetup(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Webhook base URL</p>
                <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: status.webhookBaseUrl ? '#10b981' : '#ef4444' }}>
                  {status.webhookBaseUrl || 'WEBHOOK_BASE_URL not set'}
                </div>
              </div>
              <div>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>Pi-hole cursor</p>
                <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                  {status.piholeCursor.lastPollAt ? relTime(status.piholeCursor.lastPollAt) : 'Never polled'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setupSubscriptions('google')} disabled={setupLoading || !status.webhookBaseUrl} style={btnStyle('#1a3350', !status.webhookBaseUrl)}>
                <Globe size={12} /> Setup Google
              </button>
              <button onClick={() => setupSubscriptions('microsoft')} disabled={setupLoading || !status.sources.microsoft.configured || !status.webhookBaseUrl} style={btnStyle('#1a3350', !status.sources.microsoft.configured)}>
                <Shield size={12} /> Setup Microsoft
              </button>
              <button onClick={pollPihole} disabled={polling || !status.sources.pihole.configured} style={btnStyle('#1a3350')}>
                <Router size={12} /> Poll Pi-hole Now
              </button>
              <button onClick={() => fetch('/api/family-intel/ingest/pihole?reset=1').then(() => fetchStatus())} style={btnStyle('#1a1a1a')}>
                Reset Cursor
              </button>
              <button onClick={clearEvents} style={btnStyle('#2a1010')}>
                <Trash2 size={12} /> Clear Events
              </button>
              <a href="/api/family-intel/report" target="_blank" rel="noopener noreferrer" style={{ ...btnStyle('#1a2035'), textDecoration: 'none' }}>
                <Download size={12} /> Full Report JSON
              </a>
            </div>
          </div>
        )}

        {/* ─── Filters ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={13} color="var(--muted)" />
          <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }}>PERSON</span>
          {PEOPLE.map(p => (
            <FilterChip key={p} label={p} color={PERSON_COLORS[p]} active={filterPerson === p}
              onClick={() => setFilterPerson(v => v === p ? '' : p)} />
          ))}
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }}>SOURCE</span>
          {SOURCES.map(s => (
            <FilterChip key={s} label={SOURCE_LABELS[s]} color="#5E6AD2" active={filterSource === s}
              onClick={() => setFilterSource(v => v === s ? '' : s)} />
          ))}
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }}>SEV</span>
          {SEVS.map(s => (
            <FilterChip key={s} label={s} color={SEVERITY_COLORS[s]} active={filterSeverity === s}
              onClick={() => setFilterSeverity(v => v === s ? '' : s)} />
          ))}
        </div>

        {/* ─── Timeline ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Loading events…
            </div>
          ) : events.length === 0 ? (
            <EmptyState onPoll={pollPihole} />
          ) : (
            events.map(ev => <EventRow key={ev.id} event={ev} />)
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: FamilyIntelEvent }) {
  const [expanded, setExpanded] = useState(false)
  const personColor  = PERSON_COLORS[event.person] ?? '#6b7280'
  const severityColor = SEVERITY_COLORS[event.severity] ?? '#5E6AD2'

  return (
    <div
      onClick={() => setExpanded(v => !v)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
        background: expanded ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${expanded ? 'var(--border)' : 'transparent'}`,
        transition: 'background 0.15s',
        borderLeft: `3px solid ${severityColor}`,
      }}
    >
      {/* Source icon */}
      <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        {getCategoryIcon(event.category, event.source)}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          {/* Person badge */}
          <span style={{
            padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: `${personColor}22`, color: personColor, textTransform: 'capitalize',
          }}>
            {event.person}
          </span>
          {/* Source badge */}
          <span style={{
            padding: '1px 6px', borderRadius: 4, fontSize: 10,
            background: 'rgba(255,255,255,0.06)', color: 'var(--muted)',
          }}>
            {SOURCE_LABELS[event.source] ?? event.source}
          </span>
          {/* Domain tag */}
          {event.domain && (
            <span style={{
              padding: '1px 6px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
              background: 'rgba(94,106,210,0.1)', color: '#8b9cf7',
            }}>
              {event.domain}
            </span>
          )}
          {/* Device */}
          {event.device && (
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              via {event.device}
            </span>
          )}
        </div>

        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
          {event.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{event.description}</div>

        {/* Expanded metadata */}
        {expanded && Object.keys(event.metadata).length > 0 && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', fontSize: 11, fontFamily: 'monospace', color: '#8b9cf7', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(event.metadata, null, 2)}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{relTime(event.timestamp)}</div>
        {event.severity !== 'info' && (
          <div style={{ fontSize: 10, color: severityColor, textTransform: 'uppercase', marginTop: 2 }}>
            {event.severity}
          </div>
        )}
      </div>

      <ChevronRight size={13} color="var(--muted)" style={{ flexShrink: 0, marginTop: 6, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onPoll }: { onPoll: () => void }) {
  return (
    <div style={{ padding: '60px 24px', textAlign: 'center' }}>
      <Activity size={32} color="var(--muted)" style={{ marginBottom: 16 }} />
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>No events yet</p>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 20px' }}>
        Poll Pi-hole to start collecting DNS events, or configure Microsoft/Google webhooks for platform-level intelligence.
      </p>
      <button onClick={onPoll} style={btnStyle('#1e2a4a')}>
        <Router size={13} /> Poll Pi-hole Now
      </button>
    </div>
  )
}

// ─── Filter Chip ─────────────────────────────────────────────────────────────

function FilterChip({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `${color}22` : 'transparent',
        color: active ? color : 'var(--muted)',
        transition: 'all 0.12s',
        textTransform: 'capitalize',
      }}
    >
      {label}
    </button>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCategoryIcon(category: string, source: string) {
  const size = 14
  const color = 'var(--muted)'
  if (source === 'microsoft') return <Shield size={size} color="#0078d4" />
  if (source === 'google')    return <Globe size={size} color="#ea4335" />
  if (source === 'pihole')    return <Router size={size} color="#10b981" />
  switch (category) {
    case 'signin':         return <LogIn size={size} color={color} />
    case 'calendar':       return <CalendarDays size={size} color={color} />
    case 'file':           return <FileText size={size} color={color} />
    case 'email':          return <Mail size={size} color={color} />
    case 'network':        return <Wifi size={size} color={color} />
    case 'security':       return <AlertTriangle size={size} color="#ef4444" />
    case 'communication':  return <MessageSquare size={size} color={color} />
    default:               return <Activity size={size} color={color} />
  }
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)    return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function btnStyle(bg = '#1a2035', disabled = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
    background: bg, border: '1px solid var(--border)',
    color: disabled ? 'var(--muted)' : 'var(--text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'opacity 0.15s',
  }
}

const cardStyle: React.CSSProperties = {
  padding: '14px 16px',
  borderRadius: 10,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
}
