'use client'

import { useEffect, useState, useCallback } from 'react'
import { Database, ArrowRight, HardDrive, Monitor, Cloud } from 'lucide-react'

type EcosystemData = Record<string, { files: number; sizeGb: number; sources: string[] }>
type LocationData = {
  clawbot: { label: string; files: number; sizeGb: number }
  pictureCloud: { label: string; files: number; sizeGb: number }
  pcLocal: { label: string; files: number; sizeGb: number }
}

type MigrationData = {
  index: { totalFiles: number; totalSizeGb: number }
  ecosystem: EcosystemData
  location: LocationData
  dedup: { totalValidatedGb: number; validatedPairs: Array<{ pair: string; recoverableGb: number }> } | null
  batches: { ready: number; totalGb: number; totalFiles: number }
  pipeline: {
    pull: { pct: number }; index: { pct: number }; dedup: { pct: number }
    organize: { pct: number }; delete: { pct: number }; pushBack: { pct: number }
  }
  nas: { clawbotFreeGb: number | null; pictureCloudFreeGb: number | null }
}

const ECO_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  apple:     { label: 'Apple / iCloud',     color: '#60a5fa', icon: Cloud },
  google:    { label: 'Google',             color: '#f59e0b', icon: Cloud },
  microsoft: { label: 'Microsoft / PC',     color: '#34d399', icon: Monitor },
  pc_local:  { label: 'PC Local',           color: '#a78bfa', icon: Monitor },
  shared:    { label: 'Shared / NAS',       color: '#6b7280', icon: HardDrive },
}

function fmtGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  if (gb >= 100) return `${gb.toFixed(0)} GB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(gb * 1000).toFixed(0)} MB`
}

// Donut chart via SVG
function EcosystemDonut({ data }: { data: EcosystemData }) {
  const entries = Object.entries(data)
    .filter(([, v]) => v.sizeGb > 0)
    .sort((a, b) => b[1].sizeGb - a[1].sizeGb)
  const total = entries.reduce((s, [, v]) => s + v.sizeGb, 0)
  if (total === 0) return null

  const cx = 80, cy = 80, r = 60, stroke = 18
  let cumAngle = -90 // start at top

  const arcs = entries.map(([key, v]) => {
    const pct = v.sizeGb / total
    const angle = pct * 360
    const startAngle = cumAngle
    const endAngle = cumAngle + angle
    cumAngle = endAngle

    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180
    const x1 = cx + r * Math.cos(startRad)
    const y1 = cy + r * Math.sin(startRad)
    const x2 = cx + r * Math.cos(endRad)
    const y2 = cy + r * Math.sin(endRad)
    const large = angle > 180 ? 1 : 0

    return {
      key,
      d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      color: ECO_META[key]?.color ?? '#475569',
      pct: Math.round(pct * 100),
      sizeGb: v.sizeGb,
      files: v.files,
    }
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {arcs.map(arc => (
          <path
            key={arc.key}
            d={arc.d}
            fill="none"
            stroke={arc.color}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#E5E7EE" fontSize="18" fontWeight="700">
          {fmtGb(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#6b7280" fontSize="10">
          total indexed
        </text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        {arcs.map(arc => {
          const meta = ECO_META[arc.key]
          return (
            <div key={arc.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: arc.color, flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: '#E5E7EE', fontWeight: 600, minWidth: '110px' }}>
                {meta?.label ?? arc.key}
              </span>
              <span style={{ fontSize: '11px', color: arc.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {fmtGb(arc.sizeGb)}
              </span>
              <span style={{ fontSize: '10px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                {arc.pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Where data physically lives
function LocationBars({ location, clawbotFreeGb, pictureCloudFreeGb }: {
  location: LocationData
  clawbotFreeGb: number | null
  pictureCloudFreeGb: number | null
}) {
  const locations = [
    {
      ...location.clawbot,
      color: '#4DA6FF',
      freeGb: clawbotFreeGb,
      icon: HardDrive,
    },
    {
      ...location.pictureCloud,
      color: '#34d399',
      freeGb: pictureCloudFreeGb,
      icon: HardDrive,
    },
    {
      ...location.pcLocal,
      color: '#a78bfa',
      freeGb: null,
      icon: Monitor,
    },
  ]

  const maxGb = Math.max(...locations.map(l => l.sizeGb), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
        Physical Location
      </div>
      {locations.map(loc => {
        const Icon = loc.icon
        const barPct = maxGb > 0 ? Math.max((loc.sizeGb / maxGb) * 100, 1) : 0
        return (
          <div key={loc.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon size={13} color={loc.color} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#E5E7EE' }}>{loc.label}</span>
                <span style={{ fontSize: '11px', color: loc.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {loc.sizeGb > 0 ? fmtGb(loc.sizeGb) : 'none'}
                  {loc.freeGb !== null && loc.sizeGb > 0 ? ` (${fmtGb(loc.freeGb)} free)` : ''}
                </span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.04)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${barPct}%`, background: loc.color, borderRadius: '3px', opacity: loc.sizeGb > 0 ? 1 : 0.2 }} />
              </div>
              <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '2px' }}>
                {loc.files > 0 ? `${loc.files.toLocaleString()} files` : 'not yet indexed'}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Mini pipeline
function MiniPipeline({ pipeline }: { pipeline: MigrationData['pipeline'] }) {
  const phases = [
    { ...pipeline.pull, label: 'Pull' },
    { ...pipeline.index, label: 'Index' },
    { ...pipeline.dedup, label: 'Dedup' },
    { ...pipeline.organize, label: 'Organize' },
    { ...pipeline.delete, label: 'Delete' },
    { ...pipeline.pushBack, label: 'Push' },
  ]

  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {phases.map((p, i) => {
        const color = p.pct === 100 ? '#34d399' : p.pct > 0 ? '#f59e0b' : '#2a2d35'
        return (
          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '3px', flex: 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '8px', color, fontWeight: 600, marginBottom: '2px', textAlign: 'center' }}>{p.label}</div>
              <div style={{ height: '3px', background: 'rgba(255,255,255,0.04)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${p.pct}%`, background: color, borderRadius: '2px' }} />
              </div>
            </div>
            {i < phases.length - 1 && <ArrowRight size={8} color="#2a2d35" style={{ flexShrink: 0 }} />}
          </div>
        )
      })}
    </div>
  )
}

export default function MigrationPanel() {
  const [data, setData] = useState<MigrationData | null>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/cloud-command?ts=${Date.now()}`, { cache: 'no-store' })
      const json = await res.json()
      setData(json)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [loadData])

  if (!data) {
    return (
      <div style={{ background: '#111318', borderRadius: '10px', padding: '16px', borderLeft: '3px solid #4DA6FF', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#4a5568', fontSize: '12px' }}>Loading migration data...</span>
      </div>
    )
  }

  return (
    <div style={{ background: '#111318', borderRadius: '10px', padding: '16px', borderLeft: '3px solid #4DA6FF' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Database size={14} color="#4DA6FF" />
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#E5E7EE', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Migration Command
        </span>
        <span style={{ fontSize: '10px', color: '#4a5568', marginLeft: 'auto' }}>
          {data.index.totalFiles.toLocaleString()} files / {fmtGb(data.index.totalSizeGb)}
        </span>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
        {[
          { label: 'Indexed', value: fmtGb(data.index.totalSizeGb), color: '#4DA6FF' },
          { label: 'Dedup Savings', value: data.dedup ? fmtGb(data.dedup.totalValidatedGb) : '--', color: '#34d399' },
          { label: 'Batches', value: `${data.batches.ready} ready`, color: '#f59e0b' },
          { label: 'Recoverable', value: data.batches.totalGb ? fmtGb(data.batches.totalGb) : '--', color: '#f97316' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: '#0d1117', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{kpi.label}</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Mini pipeline */}
      <div style={{ marginBottom: '16px' }}>
        <MiniPipeline pipeline={data.pipeline} />
      </div>

      {/* Two columns: Ecosystem donut + Location bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
            Data by Ecosystem
          </div>
          <EcosystemDonut data={data.ecosystem} />
        </div>
        <div>
          <LocationBars
            location={data.location}
            clawbotFreeGb={data.nas.clawbotFreeGb}
            pictureCloudFreeGb={data.nas.pictureCloudFreeGb}
          />
        </div>
      </div>
    </div>
  )
}
