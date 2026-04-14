'use client'

import { useState } from 'react'
import {
  Image, Video, FileText, Gamepad2, File, Music, Mail, Archive, Settings,
  Database as DatabaseIcon, Monitor, BarChart3,
} from 'lucide-react'

type ContentItem = {
  category: string
  files: number
  sizeGb: number
}

type PerSourceContent = Record<string, ContentItem[]>

type Props = {
  contentBreakdown: ContentItem[]
  perSourceContent: PerSourceContent
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }> }> = {
  photo:             { label: 'Photos',       color: '#ec4899', icon: Image },
  video:             { label: 'Videos',        color: '#3b82f6', icon: Video },
  document:          { label: 'Documents',     color: '#10b981', icon: FileText },
  presentation:      { label: 'Presentations', color: '#f97316', icon: FileText },
  spreadsheet:       { label: 'Spreadsheets',  color: '#f59e0b', icon: FileText },
  game_asset:        { label: 'Game Assets',   color: '#8b5cf6', icon: Gamepad2 },
  metadata_sidecar:  { label: 'Metadata',      color: '#6b7280', icon: Settings },
  archive:           { label: 'Archives',       color: '#ef4444', icon: Archive },
  executable:        { label: 'Executables',    color: '#dc2626', icon: Monitor },
  audio:             { label: 'Audio',          color: '#14b8a6', icon: Music },
  email:             { label: 'Email',          color: '#0ea5e9', icon: Mail },
  config:            { label: 'Config',         color: '#64748b', icon: Settings },
  database:          { label: 'Databases',      color: '#a855f7', icon: DatabaseIcon },
  other:             { label: 'Other',          color: '#475569', icon: File },
  uncategorized:     { label: 'Uncategorized',  color: '#374151', icon: File },
}

function fmtGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  if (gb >= 100) return `${gb.toFixed(0)} GB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  if (gb >= 0.01) return `${(gb * 1000).toFixed(0)} MB`
  return `${(gb * 1e6).toFixed(0)} KB`
}

export default function ContentExplorer({ contentBreakdown, perSourceContent }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const totalGb = contentBreakdown.reduce((s, c) => s + c.sizeGb, 0)

  return (
    <div style={{ background: '#111318', borderRadius: '10px', padding: '16px', borderLeft: '3px solid #ec4899' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <BarChart3 size={14} color="#ec4899" />
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#E5E7EE', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Content Breakdown
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {contentBreakdown.map(item => {
          const meta = CATEGORY_META[item.category] ?? CATEGORY_META.other
          const Icon = meta.icon
          const pct = totalGb > 0 ? (item.sizeGb / totalGb) * 100 : 0
          const isExpanded = expanded === item.category

          // Find which sources contribute to this category
          const sourcesForCategory = isExpanded
            ? Object.entries(perSourceContent)
                .filter(([, cats]) => cats.some(c => c.category === item.category))
                .map(([source, cats]) => {
                  const match = cats.find(c => c.category === item.category)
                  return { source, files: match?.files ?? 0, sizeGb: match?.sizeGb ?? 0 }
                })
                .sort((a, b) => b.sizeGb - a.sizeGb)
            : []

          return (
            <div key={item.category}>
              <div
                onClick={() => setExpanded(isExpanded ? null : item.category)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 1fr 80px 70px',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <Icon size={13} color={meta.color} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#E5E7EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {meta.label}
                  </span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.04)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(pct, 0.5)}%`, background: meta.color, borderRadius: '3px' }} />
                </div>
                <span style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtGb(item.sizeGb)}
                </span>
                <span style={{ fontSize: '10px', color: '#6b7280', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {item.files.toLocaleString()} files
                </span>
              </div>

              {isExpanded && sourcesForCategory.length > 0 && (
                <div style={{ padding: '4px 10px 8px 36px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {sourcesForCategory.map(s => (
                    <div key={s.source} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#7f8793' }}>
                      <span>{s.source}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtGb(s.sizeGb)} / {s.files.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
