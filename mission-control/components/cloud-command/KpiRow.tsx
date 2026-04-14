'use client'

import { Database, Trash2, HardDrive, Activity } from 'lucide-react'
import type { CSSProperties } from 'react'

type KpiCard = {
  label: string
  value: string
  sub: string
  color: string
  icon: React.ComponentType<{ size?: number; color?: string }>
}

type Props = {
  totalFiles: number
  totalSizeGb: number
  totalValidatedGb: number
  validatedPairs: number
  batchesReady: number
  batchTotalGb: number
  clawbotFreeGb: number | null
  pictureCloudFreeGb: number | null
}

function fmtGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`
}

function fmtCount(n: number): string {
  return n.toLocaleString()
}

export default function KpiRow({
  totalFiles, totalSizeGb, totalValidatedGb, validatedPairs,
  batchesReady, batchTotalGb, clawbotFreeGb, pictureCloudFreeGb,
}: Props) {
  const cards: KpiCard[] = [
    {
      label: 'Total Indexed',
      value: fmtCount(totalFiles),
      sub: `${fmtGb(totalSizeGb)} across 11 sources`,
      color: '#4DA6FF',
      icon: Database,
    },
    {
      label: 'Dedup Savings',
      value: fmtGb(totalValidatedGb),
      sub: `${validatedPairs} validated pairs`,
      color: '#34d399',
      icon: Trash2,
    },
    {
      label: 'Deletion Batches',
      value: `${batchesReady} ready`,
      sub: batchTotalGb > 0 ? `${fmtGb(batchTotalGb)} recoverable` : 'none generated',
      color: '#f59e0b',
      icon: Activity,
    },
    {
      label: 'Disk Free',
      value: clawbotFreeGb !== null ? fmtGb(clawbotFreeGb) : '--',
      sub: pictureCloudFreeGb !== null
        ? `PCS: ${fmtGb(pictureCloudFreeGb)} free`
        : 'Picture Cloud not mounted',
      color: '#a78bfa',
      icon: HardDrive,
    },
  ]

  const cardStyle: CSSProperties = {
    background: '#111318',
    borderRadius: '10px',
    padding: '14px 16px',
    minWidth: 0,
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
      {cards.map(card => {
        const Icon = card.icon
        return (
          <div key={card.label} style={{ ...cardStyle, borderLeft: `3px solid ${card.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{card.label}</span>
              <Icon size={14} color={card.color} />
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: card.color, lineHeight: 1.1 }}>{card.value}</div>
            <div style={{ fontSize: '11px', color: '#4a5568', marginTop: '4px' }}>{card.sub}</div>
          </div>
        )
      })}
    </div>
  )
}
