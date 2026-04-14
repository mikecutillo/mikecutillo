'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export interface TopNavCrumb {
  label: string
  href?: string
  onClick?: () => void
  active?: boolean
}

interface TopNavProps {
  crumbs: TopNavCrumb[]
  actions?: React.ReactNode
}

export default function TopNav({ crumbs, actions }: TopNavProps) {
  const [time, setTime] = useState<string>('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      borderBottom: '1px solid var(--topnav-border)',
      padding: '0 26px',
      background: 'var(--topnav-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
      height: '36px',
      gap: 12,
    }}>
      {/* Breadcrumb path */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 0, overflow: 'hidden' }}>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          const baseStyle: React.CSSProperties = {
            fontSize: 12,
            fontWeight: crumb.active ? 600 : 400,
            color: crumb.active ? '#7c8cff' : crumb.href ? 'var(--crumb-inactive)' : 'var(--crumb-ghost)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: crumb.href || crumb.onClick ? 'pointer' : 'default',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
            textDecoration: 'none',
            letterSpacing: '0.01em',
          }

          const crumbEl = crumb.href ? (
            <Link
              key={i}
              href={crumb.href}
              style={{ ...baseStyle, color: crumb.active ? '#7c8cff' : 'var(--crumb-inactive)' }}
            >
              {crumb.label}
            </Link>
          ) : crumb.onClick ? (
            <button
              key={i}
              onClick={crumb.onClick}
              style={baseStyle}
            >
              {crumb.label}
            </button>
          ) : (
            <span
              key={i}
              style={baseStyle}
            >
              {crumb.label}
            </span>
          )

          return (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {crumbEl}
              {!isLast && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--crumb-separator)',
                  margin: '0 5px',
                  userSelect: 'none',
                  fontWeight: 400,
                }}>/</span>
              )}
            </span>
          )
        })}
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {actions && <div style={{ display: 'flex', alignItems: 'center' }}>{actions}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <div style={{
            width: '4px', height: '4px', borderRadius: '50%',
            background: 'var(--success, #26C26E)',
            boxShadow: '0 0 5px rgba(38,194,110,0.55)',
          }} className="animate-pulse-glow" />
          <span style={{ fontSize: 8, color: 'var(--success, #26C26E)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>live</span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted, #4E5668)', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
          {time}
        </div>
      </div>
    </div>
  )
}
