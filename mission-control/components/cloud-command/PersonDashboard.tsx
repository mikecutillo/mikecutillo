'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Cloud, HardDrive, Image, Video, FileText, Gamepad2, File } from 'lucide-react'

type SourceRow = {
  source: string
  person: string
  service: string
  files: number
  sizeGb: number
}

type ContentItem = {
  category: string
  files: number
  sizeGb: number
}

type PersonConfig = {
  id: string
  name: string
  color: string
}

type Props = {
  people: PersonConfig[]
  sourceBreakdown: SourceRow[]
  perSourceContent: Record<string, ContentItem[]>
}

const PERSON_META: Record<string, { name: string; color: string }> = {
  mike:    { name: 'Mike',    color: '#4DA6FF' },
  'erin-c':  { name: 'Erin C',  color: '#A78BFA' },
  'erin-ra': { name: 'Erin RA', color: '#F97316' },
  clara:   { name: 'Clara',   color: '#F472B6' },
  liam:    { name: 'Liam',    color: '#22C55E' },
}

const SERVICE_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  'Google Drive': Cloud,
  'Google Photos': Image,
  'iCloud': HardDrive,
  'OneDrive': Cloud,
}

const CATEGORY_COLORS: Record<string, string> = {
  photo: '#ec4899', video: '#3b82f6', document: '#10b981', presentation: '#f97316',
  game_asset: '#8b5cf6', archive: '#ef4444', metadata_sidecar: '#6b7280',
  spreadsheet: '#f59e0b', executable: '#dc2626', audio: '#14b8a6',
  email: '#0ea5e9', config: '#64748b', database: '#a855f7', other: '#475569',
}

function fmtGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  if (gb >= 100) return `${gb.toFixed(0)} GB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(gb * 1000).toFixed(0)} MB`
}

export default function PersonDashboard({ people, sourceBreakdown, perSourceContent }: Props) {
  const personIds = Object.keys(PERSON_META)
  const [expandedPerson, setExpandedPerson] = useState<string | null>('mike')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {personIds.map(personId => {
        const meta = PERSON_META[personId]
        const sources = sourceBreakdown.filter(s => s.person === personId)
        const totalGb = sources.reduce((s, src) => s + src.sizeGb, 0)
        const totalFiles = sources.reduce((s, src) => s + src.files, 0)
        const isExpanded = expandedPerson === personId

        return (
          <div key={personId} style={{
            background: '#111318',
            borderRadius: '10px',
            borderLeft: `3px solid ${meta.color}`,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div
              onClick={() => setExpandedPerson(isExpanded ? null : personId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: `${meta.color}18`, border: `1.5px solid ${meta.color}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '13px', fontWeight: 700, color: meta.color,
                }}>
                  {meta.name[0]}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#E5E7EE' }}>{meta.name}</div>
                  <div style={{ fontSize: '10px', color: '#6b7280' }}>
                    {sources.length} sources / {totalFiles.toLocaleString()} files / {fmtGb(totalGb)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Mini service badges */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {sources.map(src => {
                    const barPct = totalGb > 0 ? Math.max((src.sizeGb / totalGb) * 100, 2) : 0
                    return (
                      <div key={src.source} title={`${src.service}: ${fmtGb(src.sizeGb)}`} style={{
                        width: `${Math.max(barPct * 0.8, 4)}px`,
                        height: '16px',
                        background: meta.color,
                        opacity: 0.3 + (barPct / 100) * 0.7,
                        borderRadius: '2px',
                      }} />
                    )
                  })}
                </div>
                {isExpanded ? <ChevronDown size={14} color="#6b7280" /> : <ChevronRight size={14} color="#6b7280" />}
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sources.map(src => {
                  const Icon = SERVICE_ICONS[src.service] ?? Cloud
                  const content = perSourceContent[src.source] ?? []
                  const srcTotalGb = src.sizeGb

                  return (
                    <div key={src.source} style={{
                      background: '#0d1117',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      padding: '12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Icon size={14} color={meta.color} />
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#E5E7EE' }}>{src.service}</span>
                          <span style={{ fontSize: '10px', color: '#6b7280' }}>{src.source}</span>
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: meta.color }}>
                          {fmtGb(src.sizeGb)} / {src.files.toLocaleString()}
                        </div>
                      </div>

                      {/* Content category stacked bar */}
                      <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px', background: 'rgba(255,255,255,0.04)' }}>
                        {content.map(c => {
                          const pct = srcTotalGb > 0 ? (c.sizeGb / srcTotalGb) * 100 : 0
                          if (pct < 0.3) return null
                          return (
                            <div
                              key={c.category}
                              title={`${c.category}: ${fmtGb(c.sizeGb)}`}
                              style={{
                                width: `${pct}%`,
                                background: CATEGORY_COLORS[c.category] ?? '#475569',
                                minWidth: '2px',
                              }}
                            />
                          )
                        })}
                      </div>

                      {/* Category legend */}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {content.filter(c => c.sizeGb >= 0.01).map(c => (
                          <span key={c.category} style={{
                            fontSize: '10px', color: '#7f8793',
                            display: 'flex', alignItems: 'center', gap: '4px',
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: CATEGORY_COLORS[c.category] ?? '#475569', flexShrink: 0 }} />
                            {c.category} {fmtGb(c.sizeGb)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
