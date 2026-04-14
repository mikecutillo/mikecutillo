'use client'

import { useEffect, useState, useCallback } from 'react'
import TopNav from '@/components/top-nav'
import { ExternalLink, Sparkles, CheckCircle, XCircle, Clock, Zap } from 'lucide-react'

interface StepResult {
  index: number
  status: 'pending' | 'approved' | 'done' | 'error'
  output?: string
}

interface Step {
  capability: string
  params: Record<string, unknown>
  rationale: string
}

interface Capture {
  id: string
  createdAt: string
  source: { url: string; title: string }
  plan: {
    summary: string
    directive: string
    steps: Step[]
  }
  stepResults: StepResult[]
}

const DIRECTIVE_COLORS: Record<string, string> = {
  install: '#22c55e',
  update: '#3b82f6',
  build: '#f97316',
  configure: '#8b5cf6',
  download: '#06b6d4',
  learn: '#f59e0b',
  save: '#ec4899',
  other: '#6b7280',
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle size={14} style={{ color: '#22c55e' }} />
    case 'error':
      return <XCircle size={14} style={{ color: '#ef4444' }} />
    case 'approved':
      return <Zap size={14} style={{ color: '#f59e0b' }} />
    default:
      return <Clock size={14} style={{ color: '#6b7280' }} />
  }
}

export default function SpellBookPage() {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchCaptures = useCallback(async () => {
    try {
      const res = await fetch('/api/spellbook/capture')
      if (!res.ok) {
        setCaptures([])
        return
      }
      const data = await res.json()
      setCaptures(data.captures || [])
    } catch {
      setCaptures([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCaptures()
  }, [fetchCaptures])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopNav crumbs={[{ label: 'Control Center', href: '/office' }, { label: 'SpellBook', active: true }]} />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <Sparkles size={20} style={{ color: 'var(--accent)' }} />
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text)', margin: 0 }}>
              SpellBook
            </h1>
            <span style={{
              fontSize: '10px',
              fontWeight: '600',
              color: '#5E6AD2',
              background: 'rgba(94,106,210,0.15)',
              padding: '2px 8px',
              borderRadius: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Voice-to-Workflow
            </span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            Capture history — every page analyzed and every action taken.
          </p>
        </div>

        {/* Capture List */}
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: '14px', textAlign: 'center', padding: '40px' }}>
            Loading captures...
          </div>
        ) : captures.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--muted)',
          }}>
            <Sparkles size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', marginBottom: '6px' }}>No captures yet</div>
            <div style={{ fontSize: '12px' }}>
              Click the SpellCaster button in Chrome to capture your first page.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {captures.map((capture) => {
              const isExpanded = expanded === capture.id
              const doneCount = capture.stepResults.filter((r) => r.status === 'done').length
              const totalSteps = capture.stepResults.length
              const directiveColor = DIRECTIVE_COLORS[capture.plan.directive] || '#6b7280'

              return (
                <div
                  key={capture.id}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  {/* Header row */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : capture.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      color: directiveColor,
                      background: `${directiveColor}20`,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      flexShrink: 0,
                    }}>
                      {capture.plan.directive}
                    </span>
                    <span style={{
                      fontSize: '13px',
                      color: 'var(--text)',
                      fontWeight: '500',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {capture.source.title}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>
                      {doneCount}/{totalSteps} steps
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>
                      {formatDate(capture.createdAt)}
                    </span>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{
                      padding: '0 16px 16px',
                      borderTop: '1px solid var(--border)',
                    }}>
                      <p style={{
                        fontSize: '12px',
                        color: 'var(--muted)',
                        margin: '12px 0',
                        lineHeight: '1.5',
                      }}>
                        {capture.plan.summary}
                      </p>
                      <a
                        href={capture.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          color: 'var(--accent)',
                          textDecoration: 'none',
                          marginBottom: '12px',
                        }}
                      >
                        <ExternalLink size={11} />
                        {capture.source.url}
                      </a>

                      {/* Steps */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {capture.plan.steps.map((step, i) => {
                          const result = capture.stepResults.find((r) => r.index === i)
                          return (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                padding: '8px 10px',
                                background: 'rgba(255,255,255,0.02)',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.04)',
                              }}
                            >
                              <StatusIcon status={result?.status || 'pending'} />
                              <div style={{ flex: 1 }}>
                                <div style={{
                                  fontSize: '12px',
                                  color: 'var(--text)',
                                  fontWeight: '500',
                                }}>
                                  {step.capability.replace(/_/g, ' ')}
                                </div>
                                <div style={{
                                  fontSize: '11px',
                                  color: 'var(--muted)',
                                  marginTop: '2px',
                                }}>
                                  {step.rationale}
                                </div>
                                {result?.output && (
                                  <div style={{
                                    fontSize: '10px',
                                    color: result.status === 'error' ? '#ef4444' : '#22c55e',
                                    marginTop: '4px',
                                    fontFamily: 'monospace',
                                  }}>
                                    {result.output}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
