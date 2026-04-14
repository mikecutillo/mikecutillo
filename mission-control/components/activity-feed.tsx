'use client'

import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ActivityEntry } from '@/lib/types'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function ActivityFeed() {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function fetchActivity() {
    try {
      const res = await fetch('/api/activity')
      const data = await res.json()
      // Reverse so oldest is at top, newest at bottom
      setActivity((data.activity as ActivityEntry[]).reverse())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchActivity()
    if (collapsed) return
    const interval = setInterval(fetchActivity, 60000)
    return () => clearInterval(interval)
  }, [collapsed])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activity])

  return (
    <div style={{
      width: collapsed ? '44px' : '300px',
      minWidth: collapsed ? '44px' : '300px',
      height: '100%',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease, min-width 0.2s ease',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        flexShrink: 0,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }} onClick={() => setCollapsed(v => !v)}>
        {collapsed ? (
          <ChevronDown size={14} style={{ color: 'var(--muted)' }} />
        ) : (
          <>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: '#26C26E', flexShrink: 0,
            }} className="animate-pulse-glow" />
            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text)', whiteSpace: 'nowrap' }}>Activity Feed</span>
            <span style={{
              marginLeft: 'auto',
              fontSize: '10px', color: 'var(--muted)',
              background: 'rgba(255,255,255,0.04)',
              padding: '2px 6px', borderRadius: '10px',
              whiteSpace: 'nowrap',
            }}>Live</span>
            <ChevronUp size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          </>
        )}
      </div>

      {/* Feed */}
      {!collapsed && <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            Loading…
          </div>
        ) : activity.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            No activity yet
          </div>
        ) : (
          activity.map((entry, i) => (
            <div
              key={entry.id}
              className="animate-fade-in"
              style={{
                display: 'flex',
                gap: '10px',
                padding: '8px 8px',
                borderRadius: '6px',
                marginBottom: '2px',
                position: 'relative',
              }}
            >
              {/* Timeline line */}
              {i < activity.length - 1 && (
                <div style={{
                  position: 'absolute',
                  left: '18px',
                  top: '28px',
                  bottom: '-4px',
                  width: '1px',
                  background: 'var(--border)',
                }} />
              )}

              {/* Icon */}
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: `${entry.color}20`,
                border: `1px solid ${entry.color}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                flexShrink: 0,
                zIndex: 1,
              }}>
                {entry.icon}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text)',
                  lineHeight: '1.4',
                  wordBreak: 'break-word',
                }}>
                  {entry.message}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '3px' }}>
                  {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>}
    </div>
  )
}
