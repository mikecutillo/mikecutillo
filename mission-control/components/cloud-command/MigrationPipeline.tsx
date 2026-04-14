'use client'

import { ArrowRight } from 'lucide-react'

type Phase = {
  label: string
  pct: number
  note: string
}

type Props = {
  phases: Phase[]
}

function phaseColor(pct: number): string {
  if (pct === 100) return '#34d399'
  if (pct > 0) return '#f59e0b'
  return '#2a2d35'
}

function phaseBg(pct: number): string {
  if (pct === 100) return 'rgba(52,211,153,0.08)'
  if (pct > 0) return 'rgba(245,158,11,0.08)'
  return 'rgba(255,255,255,0.02)'
}

export default function MigrationPipeline({ phases }: Props) {
  return (
    <div style={{ background: '#111318', borderRadius: '10px', padding: '16px', borderLeft: '3px solid #60a5fa' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#E5E7EE', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Migration Pipeline
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '4px' }}>
        {phases.map((phase, i) => {
          const color = phaseColor(phase.pct)
          const bg = phaseBg(phase.pct)
          return (
            <div key={phase.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
              <div style={{
                flex: 1,
                background: bg,
                border: `1px solid ${color}33`,
                borderRadius: '8px',
                padding: '10px 10px 8px',
                minWidth: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color }}>{phase.label}</span>
                  <span style={{ fontSize: '10px', fontWeight: 600, color }}>{phase.pct}%</span>
                </div>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden', marginBottom: '6px' }}>
                  <div style={{ height: '100%', width: `${phase.pct}%`, background: color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ fontSize: '9px', color: '#6b7280', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={phase.note}>
                  {phase.note}
                </div>
              </div>
              {i < phases.length - 1 && (
                <ArrowRight size={12} color="#2a2d35" style={{ flexShrink: 0 }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
