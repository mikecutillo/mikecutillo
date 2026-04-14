'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import TopNav from '@/components/top-nav'
import BrandLogo from '@/components/brand-logo'
import { RefreshCw, HardDrive, Cpu, GripVertical, Play, Eye, Sparkles, AlertCircle } from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Legend,
} from 'recharts'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TorrentRow } from '@/app/api/seedbox/route'
import MigrationPanel from '@/components/cloud-command/MigrationPanel'

// ─── Cleanup & Mac Storage Types ─────────────────────────────────────────────
type CleanupItem = { name: string; category: string; size_gb: number; original_path: string; status: string }
type CleanupOp = {
  id: string; date: string; label: string; triggered_by: string; archive_root: string
  total_freed_gb: number; cumulative_freed_gb: number
  items: CleanupItem[]
  by_category: Record<string, number>
}
type CleanupData = {
  summary: { total_operations: number; total_freed_gb: number; cumulative_freed_gb: number; last_cleanup: string }
  operations: CleanupOp[]
}
type MacCategory = { key: string; label: string; gb: number; color: string; detail: string }
type MacConsumer = { label: string; gb: number; path: string; color: string }
type MacStorageData = {
  last_refreshed: string
  disk: { total_gb: number; used_gb: number; free_gb: number; label: string }
  categories: MacCategory[]
  top_consumers: MacConsumer[]
}

const CATEGORY_COLORS: Record<string, string> = {
  project:  '#f97316',
  cloud:    '#3b82f6',
  cache:    '#ef4444',
  app_data: '#6b7280',
}
const CATEGORY_LABELS: Record<string, string> = {
  project:  'Old Projects',
  cloud:    'Cloud Cache',
  cache:    'Build Cache',
  app_data: 'App Data',
}

// ─── File type taxonomy — vibrant palette ─────────────────────────────────────
const T = {
  photos:   { label: 'Photos',      color: '#ec4899' },
  videos:   { label: 'Videos',      color: '#3b82f6' },
  word:     { label: 'Word / Docs', color: '#10b981' },
  excel:    { label: 'Excel',       color: '#f59e0b' },
  ppt:      { label: 'PowerPoint',  color: '#8b5cf6' },
  email:    { label: 'Email',       color: '#06b6d4' },
  backups:  { label: 'Backups',     color: '#f97316' },
  movies:   { label: 'Movies',      color: '#f43f5e' },
  games:    { label: 'Games',       color: '#84cc16' },
  tv:       { label: 'TV Shows',    color: '#d946ef' },
  emulator: { label: 'Emulators',   color: '#a78bfa' },
  other:    { label: 'Other',       color: '#6b7280' },
}

// ─── Fleet data ───────────────────────────────────────────────────────────────
const CLOUD_TYPES: Array<{ key: keyof typeof T; gb: number }> = [
  { key: 'photos',  gb: 602 },
  { key: 'videos',  gb: 173 },
  { key: 'backups', gb: 204 },
  { key: 'word',    gb: 118 },
  { key: 'email',   gb: 65  },
  { key: 'excel',   gb: 62  },
  { key: 'other',   gb: 54  },
]
const cloudTotal = CLOUD_TYPES.reduce((s, t) => s + t.gb, 0)

const NAS_TYPES: Array<{ key: keyof typeof T; gb: number }> = [
  { key: 'movies',   gb: 1600 },
  { key: 'games',    gb: 1100 },
  { key: 'videos',   gb: 800  },
  { key: 'backups',  gb: 450  },
  { key: 'tv',       gb: 320  },
  { key: 'emulator', gb: 180  },
  { key: 'other',    gb: 50   },
]
const nasTotal = NAS_TYPES.reduce((s, t) => s + t.gb, 0)

// Cross-service bar chart
const SERVICE_STACK = [
  { svc: 'Google', photos: 112, videos: 38,  word: 70,  excel: 22, ppt: 0,  email: 21, backups: 0,   movies: 0,    games: 0,    other: 12  },
  { svc: 'iCloud', photos: 490, videos: 135, word: 38,  excel: 0,  ppt: 0,  email: 0,  backups: 195, movies: 0,    games: 0,    other: 32  },
  { svc: 'M365',   photos: 0,   videos: 0,   word: 60,  excel: 40, ppt: 28, email: 44, backups: 9,   movies: 0,    games: 0,    other: 10  },
  { svc: 'NAS',    photos: 0,   videos: 800, word: 0,   excel: 0,  ppt: 0,  email: 0,  backups: 450, movies: 1600, games: 1100, tv: 320, emulator: 180, other: 50  },
]

// ─── NAS category cards ───────────────────────────────────────────────────────
type NasCatItem = { label: string; sub?: string }
type NasCat = {
  id: string; icon: string; label: string; color: string; used_pct: number
  stat: string; stat2: string
  items: NasCatItem[]
  recents: string[]; recentLabel: string
  pills: string[]
  activeDown?: number; activeSeed?: number; dlSpeed?: string; ulSpeed?: string
}

const NAS_CATS: NasCat[] = [
  {
    id: 'emulator', icon: '🎮', label: 'Emulators', color: '#a78bfa', used_pct: 60,
    stat: '4,812 ROMs', stat2: '~180 GB',
    items: [
      { label: 'NES · SNES · GBA', sub: '2,773 titles' },
      { label: 'SEGA Genesis',     sub: '521 titles'   },
      { label: 'PS1 · PS2',        sub: '750 titles'   },
      { label: 'N64',              sub: '768 titles'   },
    ],
    recents: ['DKC 3 (SNES)', 'Metal Gear Solid (PS1)', 'GoldenEye 007 (N64)'],
    recentLabel: 'Recently Added',
    pills: ['NES','SNES','GBA','Genesis','PS1','PS2','N64'],
  },
  {
    id: 'movies', icon: '🎬', label: 'Movies', color: '#f97316', used_pct: 50,
    stat: '847 films', stat2: '~4.8 TB',
    items: [
      { label: '4K UHD Vault',     sub: '142 titles' },
      { label: '1080p Blu-ray',    sub: '389 titles' },
      { label: 'Classics <1980',   sub: '316 titles' },
    ],
    recents: ['Dune: Part Two (4K)', 'Oppenheimer (4K)', 'The Batman (4K)'],
    recentLabel: 'Recent Downloads',
    pills: ['4K UHD','1080p','Blu-ray'],
  },
  {
    id: 'pcgames', icon: '🕹️', label: 'PC Games', color: '#84cc16', used_pct: 35,
    stat: '312 games', stat2: '~2.1 TB',
    items: [
      { label: 'AAA Titles',         sub: '89 games · 47 installed' },
      { label: 'Indie Library',      sub: '183 games'               },
      { label: 'CLAW Training Data', sub: '40 datasets'             },
    ],
    recents: ['Cyberpunk 2077 CE', "Baldur's Gate 3", 'Hollow Knight'],
    recentLabel: 'Recently Added',
    pills: ['AAA','Indie','Training'],
  },
  {
    id: 'seedbox', icon: '🌱', label: 'Seed Box', color: '#f59e0b', used_pct: 25,
    stat: '12 active', stat2: '↓45 MB/s  ↑12 MB/s',
    items: [
      { label: 'Downloading', sub: '4 torrents active' },
      { label: 'Seeding',     sub: '8 torrents · ratio 2.4' },
      { label: 'ISO Vault',   sub: '63 images archived' },
    ],
    recents: ['Ubuntu 24.04 LTS ISO', 'Arch Linux 2024.03', 'Win11 Pro 23H2'],
    recentLabel: 'Active / Recent',
    pills: ['Downloading','Seeding','ISO'],
    activeDown: 4, activeSeed: 8, dlSpeed: '45 MB/s', ulSpeed: '12 MB/s',
  },
  {
    id: 'tv', icon: '📺', label: 'TV Shows', color: '#ec4899', used_pct: 15,
    stat: '127 series', stat2: '8,432 episodes',
    items: [
      { label: 'HD Series', sub: '89 shows · 5,200 eps' },
      { label: 'Classics',  sub: '28 shows · 2,800 eps' },
      { label: 'Anime',     sub: '10 shows · 432 eps'   },
    ],
    recents: ['Severance S2 (2025)', 'The Bear S3', 'Andor S2'],
    recentLabel: 'Recently Added',
    pills: ['HD','Classics','Anime'],
  },
]

// ─── Cloud provider breakdown (derived from SERVICE_STACK totals) ─────────────
const CLOUD_PROVIDERS = [
  { name: 'Google',  gb: 275,  color: '#3b82f6' },  // 112+38+70+22+21+12
  { name: 'iCloud',  gb: 890,  color: '#f59e0b' },  // 490+135+38+195+32
  { name: 'M365',    gb: 191,  color: '#06b6d4' },  // 60+40+28+44+9+10
]
const cloudProviderTotal = CLOUD_PROVIDERS.reduce((s, p) => s + p.gb, 0)

// ─── Panel order (persisted to localStorage) ──────────────────────────────────
const DEFAULT_PANELS = ['fleet', 'fleet-bar', 'nas-cards', 'migration', 'mac-cleanup', 'cleanup-log', 'mac-consumers']
const PANEL_TITLES: Record<string, string> = {
  'fleet':        'Fleet Overview',
  'fleet-bar':    'Storage by Service & Type',
  'nas-cards':    'NAS Categories',
  'migration':    'Migration Command',
  'mac-cleanup':  'Mac Local + Cleanup History',
  'cleanup-log':  'AI Cleanup Operations Log',
  'mac-consumers':'Mac Top Consumers',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TOTAL_TB = 36, NAS_TB = 10, CLOUD_TB = 26
const USED_GB  = cloudTotal + nasTotal
const USED_TB  = USED_GB / 1024

function fmtG(gb: number) { return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb} GB` }
function fmtSpeed(bps: number) {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`
  if (bps >= 1_000)     return `${(bps / 1_000).toFixed(0)} KB/s`
  return `${bps} B/s`
}
function fmtBytes(b: number) {
  if (b >= 1_000_000_000_000) return `${(b / 1_000_000_000_000).toFixed(1)} TB`
  if (b >= 1_000_000_000)     return `${(b / 1_000_000_000).toFixed(1)} GB`
  if (b >= 1_000_000)         return `${(b / 1_000_000).toFixed(0)} MB`
  return `${b} B`
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; fill: string }>
  label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px 12px', fontSize: '11px' }}>
      <div style={{ color: '#E5E7EE', fontWeight: 700, marginBottom: '6px' }}>{label}</div>
      {payload.filter(p => p.value > 0).map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: p.fill }} />
          <span style={{ color: '#A0AABB' }}>{p.name}</span>
          <span style={{ color: '#E5E7EE', marginLeft: 'auto', paddingLeft: '12px' }}>{fmtG(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Sortable Panel wrapper ───────────────────────────────────────────────────
function SortablePanel({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1, position: 'relative' }}>
      <div
        {...attributes} {...listeners}
        title={`Drag to reorder: ${PANEL_TITLES[id] ?? id}`}
        style={{
          position: 'absolute', top: '9px', right: '12px', zIndex: 20,
          cursor: isDragging ? 'grabbing' : 'grab', color: '#374151', padding: '3px',
          borderRadius: '4px', display: 'flex', alignItems: 'center',
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        <GripVertical size={13} />
      </div>
      {children}
    </div>
  )
}

export default function CloudStorage() {
  const cloudDonut = CLOUD_TYPES.map(t => ({ name: T[t.key].label, v: t.gb, color: T[t.key].color }))
  const nasDonut   = NAS_TYPES.map(t => ({ name: T[t.key].label, v: t.gb, color: T[t.key].color }))

  const usedPct = Math.round((USED_TB / TOTAL_TB) * 100)

  // ── Seedbox live data ────────────────────────────────────────────────────────
  type SeedboxData = {
    torrents: TorrentRow[]
    totalDl: number; totalUl: number
    downloading: number; seeding: number; checking: number; total: number
    error?: string
  }
  const [seedbox, setSeedbox] = useState<SeedboxData | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/seedbox').then(r => r.json()).then(setSeedbox).catch(() => {})
    load()
    timerRef.current = setInterval(load, 7000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  // ── Cleanup History data ─────────────────────────────────────────────────────
  const [cleanupData, setCleanupData] = useState<CleanupData | null>(null)
  const [macData, setMacData] = useState<MacStorageData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  const loadData = useCallback(async (refresh = false) => {
    try {
      const [ch, mac] = await Promise.all([
        fetch('/api/cleanup-history').then(r => r.json()),
        fetch(`/api/mac-storage${refresh ? '?refresh=true' : ''}`).then(r => r.json()),
      ])
      setCleanupData(ch)
      setMacData(mac)
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch {}
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData(true)
    setRefreshing(false)
  }

  // ── Drag-to-reorder panel state ──────────────────────────────────────────────
  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_PANELS
    try {
      const saved = localStorage.getItem('storage-panel-order')
      if (saved) {
        const parsed = JSON.parse(saved) as string[]
        if (parsed.length === DEFAULT_PANELS.length) return parsed
      }
    } catch {}
    return DEFAULT_PANELS
  })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setPanelOrder(prev => {
        const next = arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string))
        localStorage.setItem('storage-panel-order', JSON.stringify(next))
        return next
      })
    }
  }

  // ── Build cleanup timeline points ────────────────────────────────────────────
  const cleanupTimeline = cleanupData?.operations.map(op => ({
    date: op.label,
    freed: op.total_freed_gb,
    cumulative: op.cumulative_freed_gb,
  })) ?? []

  // ── Run-cleanup state ────────────────────────────────────────────────────────
  type CleanupRunResult = {
    timestamp: string
    dry_run: boolean
    disk: {
      total_gb: number
      before: { used_gb: number; free_gb: number; used_pct: number }
      after:  { used_gb: number; free_gb: number; used_pct: number }
    }
    total_freed_bytes: number
    total_freed_gb: number
    items: Array<{ label: string; path: string; category: string; bytes: number; action: string }>
    error?: string
  }
  const [cleanupRunning, setCleanupRunning] = useState<'preview' | 'run' | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupRunResult | null>(null)
  const [cleanupError,  setCleanupError]  = useState<string | null>(null)

  const runCleanup = async (mode: 'preview' | 'run') => {
    if (cleanupRunning) return
    setCleanupRunning(mode)
    setCleanupError(null)
    setCleanupResult(null)
    try {
      const url = mode === 'preview' ? '/api/cleanup-disk' : '/api/cleanup-disk?run=true'
      const res = await fetch(url, { method: mode === 'preview' ? 'GET' : 'GET' })
      const json = await res.json() as CleanupRunResult
      if (json.error) {
        setCleanupError(json.error)
      } else {
        setCleanupResult(json)
        // After a real run, reload history + mac storage so the chart updates
        if (mode === 'run') await loadData(true)
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : String(err))
    } finally {
      setCleanupRunning(null)
    }
  }

  // Group preview/run items by category for an inline mini-bar
  const cleanupItemsByCategory = (() => {
    if (!cleanupResult) return null
    const groups: Record<string, number> = {}
    for (const item of cleanupResult.items) {
      groups[item.category] = (groups[item.category] ?? 0) + item.bytes
    }
    return Object.entries(groups)
      .map(([k, v]) => ({ key: k, gb: v / 1024 / 1024 / 1024 }))
      .sort((a, b) => b.gb - a.gb)
  })()
  const SCRIPT_CAT_COLORS: Record<string, string> = {
    backups:         '#f97316',
    build:           '#3b82f6',
    package_cache:   '#ef4444',
    system_cache:    '#a78bfa',
    claude_versions: '#06b6d4',
  }
  const SCRIPT_CAT_LABELS: Record<string, string> = {
    backups:         'Rotated Backups',
    build:           'Build Artifacts',
    package_cache:   'Package Caches',
    system_cache:    'System Caches',
    claude_versions: 'Old Claude Versions',
  }

  // ── Mac storage donut ────────────────────────────────────────────────────────
  const macDonut = macData?.categories.map(c => ({ name: c.label, v: c.gb, color: c.color })) ?? []
  const macTotal = macData?.categories.reduce((s, c) => s + c.gb, 0) ?? 0

  return (
    <div style={{ height: '100vh', background: '#06080d', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopNav
        crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Storage Core', active: true }]}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {lastUpdated && <span style={{ fontSize: '11px', color: '#4a5568' }}>Updated {lastUpdated}</span>}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: refreshing ? '#1a2030' : '#111318',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px', padding: '5px 10px',
                color: refreshing ? '#4a5568' : '#E5E7EE', fontSize: '12px', cursor: refreshing ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        }
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={panelOrder} strategy={verticalListSortingStrategy}>
        <div style={{ padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', paddingBottom: '16px' }}>

        {/* ── Hero Stat Strip ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', flexShrink: 0 }}>
          {[
            { label: 'Total Fleet', value: `${TOTAL_TB} TB`, sub: 'NAS + Cloud', color: '#3b82f6', border: '#3b82f620' },
            { label: 'Space Freed', value: cleanupData ? `${cleanupData.summary.cumulative_freed_gb.toFixed(2)} GB` : '—', sub: `${cleanupData?.summary.total_operations ?? 0} AI cleanup${(cleanupData?.summary.total_operations ?? 0) !== 1 ? 's' : ''}`, color: '#10b981', border: '#10b98120' },
            { label: 'Fleet Used', value: `${usedPct}%`, sub: `${fmtG(USED_GB)} of ${TOTAL_TB} TB`, color: '#f59e0b', border: '#f59e0b20' },
            { label: 'Mac Free', value: macData ? `${macData.disk.free_gb.toFixed(1)} GB` : '—', sub: macData ? `of ${macData.disk.total_gb} GB local` : 'local disk', color: '#06b6d4', border: '#06b6d420' },
          ].map(s => (
            <div key={s.label} style={{ background: '#111318', border: `1px solid ${s.border}`, borderTop: `2px solid ${s.color}`, borderRadius: '8px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#E5E7EE', marginTop: '2px' }}>{s.label}</div>
              <div style={{ fontSize: '10px', color: '#4a5568' }}>{s.sub}</div>
            </div>
          ))}
        </div>

          {/* ── Draggable Panels ── */}
          {panelOrder.map(id => {
            let content: React.ReactNode = null

            if (id === 'fleet') content = (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', height: '285px', flexShrink: 0 }}>

          {/* Fleet overview — hierarchical 2-donut */}
          <div style={{ background: '#111318', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '28px', fontWeight: 700, color: '#E5E7EE', lineHeight: 1 }}>{TOTAL_TB} TB</span>
              <span style={{ fontSize: '12px', color: '#A0AABB' }}>Total Fleet</span>
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#4a5568' }}>Used {fmtG(USED_GB)} · Free {(TOTAL_TB - USED_TB).toFixed(1)} TB</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flex: 1, alignItems: 'center' }}>

              {/* Left donut: NAS vs Cloud split */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{ position: 'relative', width: 110, height: 110 }}>
                  <PieChart width={110} height={110}>
                    <Pie
                      data={[{ name: 'NAS', v: NAS_TB * 1024 }, { name: 'Cloud', v: CLOUD_TB * 1024 }]}
                      dataKey="v" cx={53} cy={53} innerRadius={32} outerRadius={52}
                      startAngle={90} endAngle={-270} strokeWidth={2} stroke="#06080d"
                    >
                      <Cell fill="#10b981" />
                      <Cell fill="#3b82f6" />
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '11px' }} formatter={(v: unknown) => [fmtG(v as number), '']} />
                  </PieChart>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>{TOTAL_TB}TB</span>
                    <span style={{ fontSize: '9px', color: '#4a5568' }}>fleet</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#10b981' }} />
                    <span style={{ fontSize: '10px', color: '#A0AABB', flex: 1 }}>NAS</span>
                    <span style={{ fontSize: '10px', color: '#E5E7EE', fontWeight: 600 }}>{NAS_TB} TB</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#3b82f6' }} />
                    <span style={{ fontSize: '10px', color: '#A0AABB', flex: 1 }}>Cloud</span>
                    <span style={{ fontSize: '10px', color: '#E5E7EE', fontWeight: 600 }}>{CLOUD_TB} TB</span>
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', color: '#374151', flexShrink: 0 }}>
                <span style={{ fontSize: '18px', lineHeight: 1 }}>→</span>
                <span style={{ fontSize: '9px', color: '#374151' }}>cloud</span>
              </div>

              {/* Right donut: Cloud provider breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1 }}>
                <div style={{ position: 'relative', width: 110, height: 110 }}>
                  <PieChart width={110} height={110}>
                    <Pie
                      data={CLOUD_PROVIDERS.map(p => ({ name: p.name, v: p.gb, color: p.color }))}
                      dataKey="v" cx={53} cy={53} innerRadius={32} outerRadius={52}
                      startAngle={90} endAngle={-270} strokeWidth={2} stroke="#06080d"
                    >
                      {CLOUD_PROVIDERS.map((p, i) => <Cell key={i} fill={p.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '11px' }} formatter={(v: unknown) => [fmtG(v as number), '']} />
                  </PieChart>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>{CLOUD_TB}TB</span>
                    <span style={{ fontSize: '9px', color: '#4a5568' }}>cloud</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%' }}>
                  {CLOUD_PROVIDERS.map(p => (
                    <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: p.color }} />
                      <span style={{ fontSize: '10px', color: '#A0AABB', flex: 1 }}>{p.name}</span>
                      <span style={{ fontSize: '10px', color: '#E5E7EE', fontWeight: 600 }}>{fmtG(p.gb)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: '9px', color: '#374151', marginTop: '2px' }}>est. of {fmtG(cloudProviderTotal)} indexed</div>
                </div>
              </div>
            </div>
          </div>

          {/* Cloud Storage by Type */}
          <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', flexShrink: 0 }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>Cloud Storage by Type</span>
              <span style={{ fontSize: '9px', color: '#6b7280', background: '#1a2030', borderRadius: '3px', padding: '1px 5px' }}>est.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flex: 1 }}>
              <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
                <PieChart width={130} height={130}>
                  <Pie data={cloudDonut} dataKey="v" cx={63} cy={63} innerRadius={38} outerRadius={61} startAngle={90} endAngle={-270} strokeWidth={0}
                    labelLine={false}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, v }: any) => {
                      if (v / cloudTotal < 0.07) return null
                      const R = Math.PI / 180
                      const r = innerRadius + (outerRadius - innerRadius) * 1.45
                      const x = cx + r * Math.cos(-midAngle * R)
                      const y = cy + r * Math.sin(-midAngle * R)
                      return <text x={x} y={y} fill="#E5E7EE" fontSize={9} textAnchor="middle" dominantBaseline="central">{fmtG(v)}</text>
                    }}
                  >
                    {cloudDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '11px', color: '#E5E7EE' }} formatter={(v: unknown) => [`${fmtG(v as number)}`, '']} />
                </PieChart>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 700 }}>{fmtG(cloudTotal)}</span>
                  <span style={{ fontSize: '9px', color: '#4a5568' }}>cloud</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {cloudDonut.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '9px', height: '9px', borderRadius: '2px', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: '#A0AABB', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ fontSize: '11px', color: '#E5E7EE', fontWeight: 600 }}>{fmtG(d.v)}</span>
                    <span style={{ fontSize: '10px', color: '#4a5568', width: '30px', textAlign: 'right' }}>{Math.round(d.v / cloudTotal * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* NAS Storage by Type */}
          <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', flexShrink: 0 }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>NAS Storage by Type</span>
              <span style={{ fontSize: '9px', color: '#6b7280', background: '#1a2030', borderRadius: '3px', padding: '1px 5px' }}>est.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flex: 1 }}>
              <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
                <PieChart width={130} height={130}>
                  <Pie data={nasDonut} dataKey="v" cx={63} cy={63} innerRadius={38} outerRadius={61} startAngle={90} endAngle={-270} strokeWidth={0}
                    labelLine={false}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, v }: any) => {
                      if (v / nasTotal < 0.07) return null
                      const R = Math.PI / 180
                      const r = innerRadius + (outerRadius - innerRadius) * 1.45
                      const x = cx + r * Math.cos(-midAngle * R)
                      const y = cy + r * Math.sin(-midAngle * R)
                      return <text x={x} y={y} fill="#E5E7EE" fontSize={9} textAnchor="middle" dominantBaseline="central">{fmtG(v)}</text>
                    }}
                  >
                    {nasDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '11px', color: '#E5E7EE' }} formatter={(v: unknown) => [`${fmtG(v as number)}`, '']} />
                </PieChart>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#84cc16', fontWeight: 700 }}>{fmtG(nasTotal)}</span>
                  <span style={{ fontSize: '9px', color: '#4a5568' }}>NAS</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {nasDonut.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '9px', height: '9px', borderRadius: '2px', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: '#A0AABB', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ fontSize: '11px', color: '#E5E7EE', fontWeight: 600 }}>{fmtG(d.v)}</span>
                    <span style={{ fontSize: '10px', color: '#4a5568', width: '30px', textAlign: 'right' }}>{Math.round(d.v / nasTotal * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
              </div>
            )

            else if (id === 'fleet-bar') content = (
              <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 18px', height: '245px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>Fleet Storage by Service &amp; Type</span>
            <span style={{ fontSize: '9px', color: '#6b7280', background: '#1a2030', borderRadius: '3px', padding: '1px 5px' }}>est.</span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SERVICE_STACK} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <XAxis dataKey="svc" tick={{ fontSize: 13, fill: '#A0AABB' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#4a5568' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1024 ? `${(v/1024).toFixed(0)}T` : `${v}G`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '10px', color: '#A0AABB', paddingTop: '4px' }} iconSize={9} />
                <Bar dataKey="photos"  stackId="a" fill={T.photos.color}  name="Photos"    />
                <Bar dataKey="videos"  stackId="a" fill={T.videos.color}  name="Videos"    />
                <Bar dataKey="word"    stackId="a" fill={T.word.color}    name="Word/Docs"  />
                <Bar dataKey="excel"   stackId="a" fill={T.excel.color}   name="Excel"      />
                <Bar dataKey="ppt"     stackId="a" fill={T.ppt.color}     name="PPT"        />
                <Bar dataKey="email"   stackId="a" fill={T.email.color}   name="Email"      />
                <Bar dataKey="backups" stackId="a" fill={T.backups.color} name="Backups"    />
                <Bar dataKey="movies"   stackId="a" fill={T.movies.color}   name="Movies/TV"  />
                <Bar dataKey="games"   stackId="a" fill={T.games.color}   name="Games"      />
                <Bar dataKey="tv"      stackId="a" fill={T.tv.color}      name="TV Shows"   />
                <Bar dataKey="emulator" stackId="a" fill={T.emulator.color} name="Emulators" />
                <Bar dataKey="other"   stackId="a" fill={T.other.color}   name="Other"      radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
              </div>
            )

            else if (id === 'nas-cards') content = (
              <div style={{ height: '280px', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '8px' }}>
          {NAS_CATS.map(cat => (
            <div key={cat.id} style={{ background: '#111318', border: `1px solid ${cat.color}22`, borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>

              {/* Icon + label + main stat */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '18px', lineHeight: 1 }}>{cat.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE', lineHeight: 1.2 }}>{cat.label}</div>
                  <div style={{ fontSize: '10px', color: cat.color, fontWeight: 600, marginTop: '2px' }}>
                    {cat.id === 'seedbox' && seedbox
                      ? `${seedbox.downloading} ↓  ${seedbox.seeding} ⇅  ${seedbox.checking > 0 ? `${seedbox.checking} ⟳` : ''}`
                      : cat.stat}
                  </div>
                </div>
                <span style={{ fontSize: '9px', color: '#4a5568', textAlign: 'right', flexShrink: 0, lineHeight: '1.4', maxWidth: '70px' }}>
                  {cat.id === 'seedbox' && seedbox
                    ? <><span style={{ color: '#22c55e' }}>↓ {fmtSpeed(seedbox.totalDl)}</span><br /><span style={{ color: '#f59e0b' }}>↑ {fmtSpeed(seedbox.totalUl)}</span></>
                    : cat.stat2}
                </span>
              </div>

              {/* Usage bar — static for seedbox (disk usage) */}
              <div style={{ flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                  <span style={{ color: cat.color, fontWeight: 600 }}>~{cat.used_pct}% full</span>
                  <span style={{ color: '#6b7280' }}>{100 - cat.used_pct}% free</span>
                </div>
                <div style={{ height: '5px', borderRadius: '3px', background: '#1a2030' }}>
                  <div style={{ width: `${cat.used_pct}%`, height: '100%', borderRadius: '3px', background: cat.color }} />
                </div>
              </div>

              {/* Torrent list (seedbox) OR static sub-items */}
              {cat.id === 'seedbox' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  {!seedbox
                    ? <span style={{ fontSize: '10px', color: '#4a5568' }}>Connecting to qBittorrent…</span>
                    : seedbox.error
                    ? <span style={{ fontSize: '10px', color: '#ef4444' }}>{seedbox.error}</span>
                    : seedbox.torrents.map(t => {
                        const stateColor = t.state.startsWith('downloading') ? '#22c55e'
                          : t.state.startsWith('checking') ? '#f59e0b'
                          : t.state === 'uploading' || t.state === 'stalledUP' || t.state === 'forcedUP' ? '#3b82f6'
                          : t.state.includes('paused') ? '#4a5568'
                          : t.state === 'error' ? '#ef4444'
                          : '#6b7280'
                        const stateIcon = t.state.startsWith('downloading') ? '↓'
                          : t.state.startsWith('checking') ? '⟳'
                          : t.state === 'uploading' || t.state === 'stalledUP' || t.state === 'forcedUP' ? '⇅'
                          : t.state.includes('paused') ? '⏸'
                          : '?'
                        const pct = Math.round(t.progress * 100)
                        const etaStr = t.eta > 0 && t.eta < 8640000
                          ? t.eta < 60 ? `${t.eta}s`
                          : t.eta < 3600 ? `${Math.round(t.eta / 60)}m`
                          : `${(t.eta / 3600).toFixed(1)}h`
                          : null
                        return (
                          <div key={t.hash} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ fontSize: '9px', color: stateColor, flexShrink: 0, width: '10px' }}>{stateIcon}</span>
                              <span style={{ fontSize: '9px', color: '#A0AABB', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                              <span style={{ fontSize: '9px', color: '#4a5568', flexShrink: 0 }}>
                                {t.state.startsWith('downloading') && t.dlspeed > 0
                                  ? `${fmtSpeed(t.dlspeed)}${etaStr ? ' · ' + etaStr : ''}`
                                  : t.state.startsWith('checking')
                                  ? `${pct}%`
                                  : t.state === 'uploading' || t.state === 'stalledUP'
                                  ? `↑${fmtSpeed(t.upspeed)} r${t.ratio.toFixed(1)}`
                                  : fmtBytes(t.size)}
                              </span>
                            </div>
                            {(t.state.startsWith('downloading') || t.state.startsWith('checking')) && (
                              <div style={{ marginLeft: '15px', height: '3px', borderRadius: '2px', background: '#1a2030' }}>
                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', background: stateColor, opacity: 0.8 }} />
                              </div>
                            )}
                          </div>
                        )
                      })
                  }
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0 }}>
                  {cat.items.map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: cat.color, flexShrink: 0, opacity: 0.7, display: 'inline-block', marginTop: '4px' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '10px', color: '#A0AABB' }}>{item.label}</div>
                        {item.sub && <div style={{ fontSize: '9px', color: '#4a5568', marginTop: '1px' }}>{item.sub}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recents — hidden for seedbox (live list is the recents) */}
              {cat.id !== 'seedbox' && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '7px', flexShrink: 0 }}>
                  <div style={{ fontSize: '9px', color: '#374151', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{cat.recentLabel}</div>
                  {cat.recents.map(r => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                      <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: `${cat.color}66`, flexShrink: 0 }} />
                      <span style={{ fontSize: '9px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pills */}
              {cat.pills.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', flexShrink: 0 }}>
                  {cat.pills.map(pill => (
                    <span key={pill} style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '10px', background: `${cat.color}15`, color: cat.color, border: `1px solid ${cat.color}30` }}>
                      {pill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
              </div>
            )

            else if (id === 'mac-cleanup') content = (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px', minHeight: '340px', flexShrink: 0 }}>

          {/* Mac Local Storage donut */}
          <div style={{ background: '#111318', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '10px', padding: '14px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexShrink: 0 }}>
              <HardDrive size={14} color="#06b6d4" />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>Mac Local Storage</span>
              <span style={{ fontSize: '9px', color: '#6b7280', background: '#1a2030', borderRadius: '3px', padding: '1px 5px', marginLeft: 'auto' }}>
                {macData ? `${macData.disk.free_gb.toFixed(1)} GB free` : 'loading…'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1 }}>
              <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
                <PieChart width={110} height={110}>
                  <Pie data={macDonut.length ? macDonut : [{ name: 'empty', v: 1, color: '#1a2030' }]}
                    dataKey="v" cx={53} cy={53} innerRadius={32} outerRadius={52}
                    startAngle={90} endAngle={-270} strokeWidth={0}>
                    {macDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '11px' }}
                    formatter={(v: unknown) => [`${(v as number).toFixed(1)} GB`, '']} />
                </PieChart>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#06b6d4', fontWeight: 700 }}>{macData?.disk.used_gb.toFixed(0) ?? '?'}GB</span>
                  <span style={{ fontSize: '9px', color: '#4a5568' }}>used</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                {(macData?.categories ?? []).map(cat => (
                  <div key={cat.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: cat.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', color: '#A0AABB', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.label}</span>
                    <span style={{ fontSize: '10px', color: '#E5E7EE', fontWeight: 600 }}>{cat.gb.toFixed(1)}GB</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI Cleanup — Run + History panel */}
          <div style={{ background: '#111318', border: '1px solid rgba(16,185,129,0.18)', borderRadius: '10px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>

            {/* ── Header row: title + Run/Preview buttons ───────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <Sparkles size={14} color="#10b981" />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>AI Cleanup</span>
              <span style={{ fontSize: '10px', color: '#4a5568' }}>· caches, builds &amp; rotated backups</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => runCleanup('preview')}
                  disabled={cleanupRunning !== null}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    background: cleanupRunning === 'preview' ? '#1a2030' : '#0d1117',
                    border: '1px solid rgba(139,92,246,0.35)',
                    color: '#a78bfa', borderRadius: '6px',
                    padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                    cursor: cleanupRunning ? 'not-allowed' : 'pointer',
                    opacity: cleanupRunning && cleanupRunning !== 'preview' ? 0.4 : 1,
                  }}
                >
                  <Eye size={11} /> {cleanupRunning === 'preview' ? 'Scanning…' : 'Preview'}
                </button>
                <button
                  onClick={() => runCleanup('run')}
                  disabled={cleanupRunning !== null}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    background: cleanupRunning === 'run' ? '#0e2d20' : '#10b981',
                    border: '1px solid #10b981',
                    color: cleanupRunning === 'run' ? '#10b981' : '#06080d',
                    borderRadius: '6px', padding: '5px 12px',
                    fontSize: '11px', fontWeight: 700,
                    cursor: cleanupRunning ? 'not-allowed' : 'pointer',
                    opacity: cleanupRunning && cleanupRunning !== 'run' ? 0.4 : 1,
                  }}
                >
                  <Play size={11} /> {cleanupRunning === 'run' ? 'Cleaning…' : 'Run Cleanup'}
                </button>
              </div>
            </div>

            {/* ── Stat strip: cumulative / ops / last run ───────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', flexShrink: 0 }}>
              <div style={{ background: '#0d1117', border: '1px solid rgba(16,185,129,0.18)', borderRadius: '7px', padding: '8px 12px' }}>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#10b981', lineHeight: 1.05 }}>
                  {cleanupData ? `${cleanupData.summary.cumulative_freed_gb.toFixed(1)} GB` : '—'}
                </div>
                <div style={{ fontSize: '9px', color: '#4a5568', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Freed</div>
              </div>
              <div style={{ background: '#0d1117', border: '1px solid rgba(249,115,22,0.18)', borderRadius: '7px', padding: '8px 12px' }}>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#f97316', lineHeight: 1.05 }}>
                  {cleanupData?.summary.total_operations ?? '—'}
                </div>
                <div style={{ fontSize: '9px', color: '#4a5568', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Operations</div>
              </div>
              <div style={{ background: '#0d1117', border: '1px solid rgba(139,92,246,0.18)', borderRadius: '7px', padding: '8px 12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#a78bfa', lineHeight: 1.05, marginTop: '2px' }}>
                  {cleanupData?.summary.last_cleanup ?? '—'}
                </div>
                <div style={{ fontSize: '9px', color: '#4a5568', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last Run</div>
              </div>
            </div>

            {/* ── Inline preview/run result OR history bar list ─────────── */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {cleanupError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#2a0d10', border: '1px solid #f87171', borderRadius: '6px', padding: '8px 10px', fontSize: '11px', color: '#fca5a5' }}>
                  <AlertCircle size={12} /> {cleanupError}
                </div>
              )}

              {cleanupResult && (
                <div style={{ background: '#0d1117', border: `1px solid ${cleanupResult.dry_run ? 'rgba(139,92,246,0.35)' : 'rgba(16,185,129,0.35)'}`, borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: cleanupResult.dry_run ? '#a78bfa' : '#10b981', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {cleanupResult.dry_run ? 'Preview' : 'Cleanup Complete'}
                    </span>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: '#E5E7EE' }}>
                      {cleanupResult.dry_run
                        ? `${(cleanupResult.items.reduce((s, i) => s + i.bytes, 0) / 1024 / 1024 / 1024).toFixed(2)} GB reclaimable`
                        : `${cleanupResult.total_freed_gb.toFixed(2)} GB freed`}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#4a5568' }}>
                      {cleanupResult.disk.before.used_pct}% → {cleanupResult.disk.after.used_pct}%
                    </span>
                  </div>
                  {/* Stacked bar of per-category buckets */}
                  {cleanupItemsByCategory && cleanupItemsByCategory.length > 0 && (
                    <>
                      <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#1a2030', marginBottom: '6px' }}>
                        {cleanupItemsByCategory.map(c => {
                          const total = cleanupItemsByCategory.reduce((s, x) => s + x.gb, 0)
                          return (
                            <div key={c.key}
                              title={`${SCRIPT_CAT_LABELS[c.key] ?? c.key}: ${c.gb.toFixed(2)} GB`}
                              style={{ width: `${(c.gb / total) * 100}%`, background: SCRIPT_CAT_COLORS[c.key] ?? '#6b7280' }}
                            />
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {cleanupItemsByCategory.map(c => (
                          <span key={c.key} style={{
                            fontSize: '9px', padding: '2px 6px', borderRadius: '10px',
                            background: `${SCRIPT_CAT_COLORS[c.key] ?? '#6b7280'}18`,
                            color: SCRIPT_CAT_COLORS[c.key] ?? '#6b7280',
                            border: `1px solid ${SCRIPT_CAT_COLORS[c.key] ?? '#6b7280'}30`,
                          }}>
                            {SCRIPT_CAT_LABELS[c.key] ?? c.key}: {c.gb.toFixed(2)}GB
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* History — horizontal bars per operation */}
              {cleanupTimeline.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div style={{ fontSize: '9px', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Operations Timeline</div>
                  {(() => {
                    const max = Math.max(...cleanupTimeline.map(t => t.freed))
                    return cleanupTimeline.map((t, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: '#A0AABB', width: '90px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.date}</span>
                        <div style={{ flex: 1, height: '14px', background: '#0d1117', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            width: `${(t.freed / max) * 100}%`, height: '100%',
                            background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
                          }} />
                          <span style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', fontWeight: 700, color: '#E5E7EE', textShadow: '0 0 4px #000' }}>
                            {t.freed.toFixed(2)} GB
                          </span>
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              ) : (
                !cleanupResult && !cleanupError && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#374151', fontSize: '11px' }}>
                    No cleanup operations recorded yet — hit Preview to see what's reclaimable
                  </div>
                )
              )}
            </div>
          </div>
              </div>
            )

            else if (id === 'cleanup-log') {
              if (cleanupData && cleanupData.operations.length > 0) content = (
                <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 18px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Cpu size={14} color="#8b5cf6" />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>AI Cleanup Operations Log</span>
              <span style={{ fontSize: '10px', color: '#4a5568', marginLeft: '4px' }}>— full restore available via ClawBotLoot</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {cleanupData.operations.map(op => (
                <div key={op.id} style={{ background: '#0d1117', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#E5E7EE' }}>{op.label}</div>
                      <div style={{ fontSize: '10px', color: '#4a5568' }}>{new Date(op.date).toLocaleDateString()} · {op.triggered_by}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>{op.total_freed_gb.toFixed(2)} GB</div>
                      <div style={{ fontSize: '9px', color: '#4a5568' }}>freed</div>
                    </div>
                  </div>
                  {/* Category badges */}
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {Object.entries(op.by_category).map(([cat, gb]) => (
                      <span key={cat} style={{
                        fontSize: '9px', padding: '2px 7px', borderRadius: '10px',
                        background: `${CATEGORY_COLORS[cat] ?? '#6b7280'}18`,
                        color: CATEGORY_COLORS[cat] ?? '#6b7280',
                        border: `1px solid ${CATEGORY_COLORS[cat] ?? '#6b7280'}30`,
                      }}>
                        {CATEGORY_LABELS[cat] ?? cat}: {(gb as number).toFixed(2)}GB
                      </span>
                    ))}
                  </div>
                  {/* Items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {op.items.map(item => (
                      <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.status === 'archived' ? '#10b981' : '#6b7280', flexShrink: 0 }} />
                        <span style={{ fontSize: '10px', color: '#A0AABB', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                        <span style={{ fontSize: '10px', color: '#E5E7EE', fontWeight: 600, flexShrink: 0 }}>{item.size_gb.toFixed(2)}GB</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '9px', color: '#374151', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                    📦 Archive: {op.archive_root.replace('/Volumes/ClawBotLoot/', 'ClawBotLoot/')}
                  </div>
                </div>
              ))}
            </div>
                </div>
              )
            }

            else if (id === 'migration') {
              content = <MigrationPanel />
            }

            else if (id === 'mac-consumers') {
              if (macData) content = (
                <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 18px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <HardDrive size={14} color="#06b6d4" />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE' }}>Mac Top Consumers</span>
              <span style={{ fontSize: '10px', color: '#4a5568', marginLeft: 'auto' }}>
                {macData.disk.used_gb.toFixed(1)} GB used of {macData.disk.total_gb} GB
              </span>
            </div>
            {/* Usage bar */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ height: '6px', borderRadius: '4px', background: '#1a2030', overflow: 'hidden', display: 'flex' }}>
                {macData.categories.map(cat => (
                  <div key={cat.key} style={{
                    width: `${(cat.gb / macData.disk.total_gb) * 100}%`,
                    background: cat.color, height: '100%',
                  }} title={`${cat.label}: ${cat.gb.toFixed(1)}GB`} />
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
              {macData.top_consumers.map(item => (
                <div key={item.label} style={{ background: '#0d1117', borderRadius: '7px', padding: '10px 12px', border: `1px solid ${item.color}20` }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: item.color }}>{item.gb.toFixed(1)} GB</div>
                  <div style={{ fontSize: '10px', color: '#E5E7EE', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
                  <div style={{ fontSize: '9px', color: '#374151', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.path}</div>
                </div>
              ))}
            </div>
                </div>
              )
            }

            if (!content) return null
            return <SortablePanel key={id} id={id}>{content}</SortablePanel>
          })}

        </div>
        </SortableContext>
      </DndContext>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
